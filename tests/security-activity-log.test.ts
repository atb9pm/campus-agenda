import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ANOMALY_RULES,
  SECURITY_EVENT_CATALOG,
  SECURITY_EVENT_RETENTION_DAYS,
  SECURITY_EVENT_TYPES,
  accountSecurityChanges,
  buildSecurityEvent,
  buildSecuritySummary,
  computeSourceFingerprint,
  formatSourceFingerprint,
  isSourceFingerprint,
  looksLikeSecret,
  maybePurgeSecurityEvents,
  parseSecurityPeriod,
  presentSecurityEvent,
  recordSecurityAnomaly,
  recordSecurityEvent,
  resetApiReadVolume,
  resetSecurityEventPurgeClock,
  sanitizeSecurityMetadata,
  sanitizeSecurityRequestId,
  sanitizeSecurityRoute,
  securityEventLabel,
  securityPeriodSince,
  trackApiRead,
  type SecurityEvent,
  type SecurityEventInput,
  type SecurityEventStore,
} from "../src/features/security-events/index.ts";
import * as uiText from "../src/features/security-events/ui-text.ts";
import { readRequestId } from "../src/lib/observability/request-id.ts";
import {
  CAMPUS_BACKUP_EXCLUDED_OPERATIONAL_TABLES,
  CAMPUS_BACKUP_INSERT_ORDER,
} from "../src/lib/persistence/campus-backup-tables.ts";
import { MemorySecurityEventStore } from "../src/lib/persistence/memory-security-event-store.ts";
import {
  getMemoryTeacherAccountStore,
  resetMemoryTeacherAccountStore,
} from "../src/lib/persistence/memory-teacher-account-store.ts";
import { createNodeSqliteDatabase } from "../src/lib/persistence/sql/adapters.ts";
import { SQL_MIGRATION_FILES, applyMigrations } from "../src/lib/persistence/sql/migrate.ts";
import { seedDemoDatabase } from "../src/lib/persistence/sql/seed.ts";
import {
  dumpCampusTables,
  restoreCampusTables,
  validateCampusTables,
} from "../src/lib/persistence/sql/sql-campus-backup.ts";
import { SqlSecurityEventStore } from "../src/lib/persistence/sql/sql-security-event-store.ts";

const FP_SECRET = "test-fingerprint-secret-0123456789abcdef";
const BASE = new Date("2026-10-30T08:00:00.000Z");
const PLAIN_IP = "203.0.113.42";

function at(minutes: number): Date {
  return new Date(BASE.getTime() + minutes * 60_000);
}

function deps(store: SecurityEventStore, now: Date, extra: Partial<{ log: (event: SecurityEvent) => void }> = {}) {
  return { store, now: () => now, ...extra };
}

async function allEvents(store: SecurityEventStore, since = "2000-01-01T00:00:00.000Z"): Promise<SecurityEvent[]> {
  return (await store.list({ since, offset: 0, limit: 10_000 })).events;
}

async function sqlStore(path = ":memory:") {
  const db = createNodeSqliteDatabase(path);
  await applyMigrations(db);
  return { db, store: new SqlSecurityEventStore(db) };
}

function loginFailure(sourceFingerprint: string | null, targetId: string | null = "teacher-chf"): SecurityEventInput {
  return {
    type: "TEACHER_LOGIN_FAILED",
    actorType: "ANONYMOUS",
    targetType: targetId ? "TEACHER" : null,
    targetId,
    route: "/api/auth/teacher",
    httpMethod: "POST",
    httpStatus: 401,
    requestId: "req_test_1",
    sourceFingerprint,
    metadata: { reason: "invalid-credentials", accountKnown: Boolean(targetId) },
  };
}

test("migration 0035 — table append-only hors sauvegarde", async () => {
  assert.ok(SQL_MIGRATION_FILES.includes("0035_security_events.sql"));
  const sql = await readFile(new URL("../migrations/0035_security_events.sql", import.meta.url), "utf8");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS security_events/);
  assert.match(sql, /CREATE TRIGGER IF NOT EXISTS security_events_append_only/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_security_events_last_seen/);
  assert.doesNotMatch(sql, /ip_address|raw_ip|client_ip/i);

  assert.ok(!(CAMPUS_BACKUP_INSERT_ORDER as readonly string[]).includes("security_events"));
  assert.ok((CAMPUS_BACKUP_EXCLUDED_OPERATIONAL_TABLES as readonly string[]).includes("security_events"));

  const { db } = await sqlStore();
  await applyMigrations(db);
  const { results } = await db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .bind()
    .all<{ name: string }>();
  const covered = new Set<string>([...CAMPUS_BACKUP_INSERT_ORDER, ...CAMPUS_BACKUP_EXCLUDED_OPERATIONAL_TABLES]);
  for (const { name } of results ?? []) {
    assert.ok(covered.has(name), `table ${name} ni sauvegardée ni déclarée opérationnelle`);
  }
});

test("catalogue — chaque type a une catégorie, une sévérité et un libellé français", () => {
  assert.ok(SECURITY_EVENT_TYPES.length >= 30);
  for (const type of SECURITY_EVENT_TYPES) {
    const definition = SECURITY_EVENT_CATALOG[type];
    assert.ok(definition.label.length > 3, type);
    assert.ok(["INFO", "WARNING", "CRITICAL"].includes(definition.severity), type);
    for (const key of Object.keys(definition.metadata)) {
      assert.doesNotMatch(
        key,
        /^(password|passwordHash|secret|totp|totpSecret|token|cookie|ip|clientIp|payload|body|content|title|code|recoveryCode|accessCode)$/i,
        `${type}.${key}`,
      );
    }
  }
  assert.equal(SECURITY_EVENT_CATALOG.MFA_RECOVERY_CODE_USED.severity, "WARNING");
  assert.equal(SECURITY_EVENT_CATALOG.TEACHER_LOGIN_SUCCEEDED.severity, "INFO");
  assert.equal(SECURITY_EVENT_CATALOG.BACKUP_RESTORE_SUCCEEDED.category, "BACKUP");
  assert.equal(SECURITY_EVENT_RETENTION_DAYS, 180);
});

test("confidentialité — métadonnées en liste blanche, aucun secret ni charge utile", () => {
  const cleaned = sanitizeSecurityMetadata("TEACHER_LOGIN_FAILED", {
    reason: "invalid-credentials",
    accountKnown: true,
    password: "campus-demo",
    body: { initials: "ChF", password: "campus-demo" },
    cookie: "campus_session=abc",
  });
  assert.deepEqual(cleaned, { reason: "invalid-credentials", accountKnown: true });

  assert.deepEqual(sanitizeSecurityMetadata("TEACHER_LOGIN_FAILED", { reason: "anything-else" }), {});
  assert.deepEqual(
    sanitizeSecurityMetadata("STUDENT_LOGIN_FAILED", { classPrefix: "ABCD-EFGH", codeFormatValid: true }),
    { codeFormatValid: true },
  );
  assert.deepEqual(sanitizeSecurityMetadata("STUDENT_LOGIN_FAILED", { classPrefix: "MACAM" }), { classPrefix: "MACAM" });

  for (const secret of ["123456", "ABCD-EFGH", "campus-demo", "pbkdf2$abc", "a".repeat(40), "my-password"]) {
    assert.equal(looksLikeSecret(secret), true, secret);
  }
  assert.equal(looksLikeSecret("teacher-chf"), false);

  assert.equal(sanitizeSecurityRoute("/api/auth/teacher/password"), "/api/auth/teacher/password");
  assert.equal(sanitizeSecurityRoute("/api/auth/student?code=ABCD-EFGH"), "/api/auth/student");
  assert.equal(sanitizeSecurityRoute("/api/auth/student/ABCD-EFGH"), null);
  assert.equal(sanitizeSecurityRoute("/elsewhere"), null);
  assert.equal(sanitizeSecurityRequestId("req\nfake log line"), null);

  const built = buildSecurityEvent(
    {
      type: "MFA_VERIFY_FAILED",
      actorType: "TEACHER",
      actorId: "123456",
      targetType: "TEACHER",
      targetId: "ABCD-EFGH",
      metadata: { code: "123456", recoveryCode: "ABCD-EFGH" },
    },
    BASE,
  );
  assert.ok(built);
  assert.equal(built.actorId, null);
  assert.equal(built.targetId, null);
  const serialized = JSON.stringify(built);
  assert.doesNotMatch(serialized, /123456|ABCD-EFGH/);

  const anonymous = buildSecurityEvent({ ...loginFailure(null), actorId: "teacher-chf" }, BASE);
  assert.equal(anonymous?.actorId, null);
});

test("pseudonymisation — empreinte HMAC stable, jamais l'IP brute", async () => {
  const first = await computeSourceFingerprint(PLAIN_IP, FP_SECRET);
  const second = await computeSourceFingerprint(PLAIN_IP, FP_SECRET);
  const other = await computeSourceFingerprint("198.51.100.7", FP_SECRET);
  const otherKey = await computeSourceFingerprint(PLAIN_IP, `${FP_SECRET}-rotated`);
  assert.ok(first && isSourceFingerprint(first));
  assert.equal(first, second);
  assert.notEqual(first, other);
  assert.notEqual(first, otherKey);
  assert.doesNotMatch(first, /203|113|42\b/);
  assert.equal(first.length, 16);
  assert.equal(await computeSourceFingerprint(null, FP_SECRET), null);
  assert.equal(await computeSourceFingerprint("unknown", FP_SECRET), null);
  assert.match(formatSourceFingerprint(first) ?? "", /^[0-9A-F]{4}…[0-9A-F]{4}$/);
  assert.equal(buildSecurityEvent({ ...loginFailure(PLAIN_IP) }, BASE)?.sourceFingerprint, null);
});

test("auth — succès, échec, puis échecs répétés → alerte WARNING", async () => {
  const store = new MemorySecurityEventStore();
  const fp = await computeSourceFingerprint(PLAIN_IP, FP_SECRET);

  const success = await recordSecurityEvent(deps(store, BASE), {
    type: "TEACHER_LOGIN_SUCCEEDED",
    actorType: "TEACHER",
    actorId: "teacher-chf",
    sourceFingerprint: fp,
    metadata: { mfaRequired: true },
  });
  assert.equal(success?.severity, "INFO");

  for (let index = 0; index < 4; index += 1) {
    await recordSecurityEvent(deps(store, at(index)), { ...loginFailure(fp), aggregateWindowMinutes: 15 });
  }
  let events = await allEvents(store);
  assert.equal(events.filter((event) => event.eventType === "TEACHER_LOGIN_FAILED").length, 1, "agrégé");
  assert.equal(events.find((event) => event.eventType === "TEACHER_LOGIN_FAILED")?.occurrenceCount, 4);
  assert.equal(events.some((event) => event.category === "ANOMALY"), false, "4 échecs : sous le seuil");

  await recordSecurityEvent(deps(store, at(5)), { ...loginFailure(fp), aggregateWindowMinutes: 15 });
  events = await allEvents(store);
  const anomaly = events.find((event) => event.eventType === "ANOMALY_REPEATED_LOGIN_FAILURES");
  assert.ok(anomaly, "5 échecs sur un compte → alerte");
  assert.equal(anomaly.severity, "WARNING");
  assert.equal(anomaly.metadata.scope, "account");
  assert.equal(anomaly.metadata.observedCount, 5);
  assert.equal(securityEventLabel(anomaly), "5 tentatives de connexion incorrectes");

  await recordSecurityEvent(deps(store, at(6)), { ...loginFailure(fp), aggregateWindowMinutes: 15 });
  events = await allEvents(store);
  const anomalies = events.filter((event) => event.eventType === "ANOMALY_REPEATED_LOGIN_FAILURES");
  assert.equal(anomalies.length, 1, "l'alerte se met à jour au lieu de se dupliquer");
  assert.equal(anomalies[0].metadata.observedCount, 6);

  const later = new MemorySecurityEventStore();
  for (let index = 0; index < 5; index += 1) {
    await recordSecurityEvent(deps(later, at(index * 20)), { ...loginFailure(fp), aggregateWindowMinutes: 15 });
  }
  assert.equal((await allEvents(later)).some((event) => event.category === "ANOMALY"), false, "fenêtre glissante");
});

test("auth — échecs sur comptes différents : seuil source distinct (NAT école)", async () => {
  const store = new MemorySecurityEventStore();
  const fp = await computeSourceFingerprint(PLAIN_IP, FP_SECRET);
  for (let index = 0; index < 10; index += 1) {
    await recordSecurityEvent(deps(store, at(index / 2)), loginFailure(fp, `teacher-${index}`));
  }
  const events = await allEvents(store);
  const anomaly = events.find((event) => event.eventType === "ANOMALY_REPEATED_LOGIN_FAILURES");
  assert.ok(anomaly);
  assert.equal(anomaly.metadata.scope, "source");
  assert.equal(ANOMALY_RULES.find((rule) => rule.id === "teacher-login-failures")?.sourceThreshold, 10);
});

test("MFA — code erroné puis 3 échecs → alerte, code de récupération → WARNING", async () => {
  const store = new MemorySecurityEventStore();
  const mfaFailure: SecurityEventInput = {
    type: "MFA_VERIFY_FAILED",
    actorType: "TEACHER",
    actorId: "teacher-admin",
    route: "/api/auth/teacher/mfa/verify",
    metadata: { reason: "wrong-code" },
    aggregateWindowMinutes: 15,
  };
  await recordSecurityEvent(deps(store, BASE), mfaFailure);
  assert.equal((await allEvents(store)).some((event) => event.category === "ANOMALY"), false);
  await recordSecurityEvent(deps(store, at(1)), mfaFailure);
  await recordSecurityEvent(deps(store, at(2)), mfaFailure);
  const anomaly = (await allEvents(store)).find((event) => event.eventType === "ANOMALY_REPEATED_MFA_FAILURES");
  assert.ok(anomaly);
  assert.equal(securityEventLabel(anomaly), "3 codes MFA incorrects");

  const recovery = await recordSecurityEvent(deps(store, at(3)), {
    type: "MFA_RECOVERY_CODE_USED",
    actorType: "TEACHER",
    actorId: "teacher-admin",
    metadata: { context: "login-challenge", recoveryRemaining: 7, recoveryCode: "ABCD-EFGH" },
  });
  assert.equal(recovery?.severity, "WARNING");
  assert.deepEqual(recovery?.metadata, { context: "login-challenge", recoveryRemaining: 7 });
});

test("rate limit — blocage MFA critique et libellé dédié", async () => {
  const store = new MemorySecurityEventStore();
  const saved = await recordSecurityEvent(deps(store, BASE), {
    type: "RATE_LIMIT_TRIGGERED",
    severity: "CRITICAL",
    actorType: "TEACHER",
    actorId: "teacher-admin",
    httpStatus: 429,
    metadata: { scope: "teacher-mfa", layer: "target", targetKnown: true },
    aggregateWindowMinutes: 15,
  });
  assert.equal(saved?.severity, "CRITICAL");
  assert.equal(saved && securityEventLabel(saved), "Rate limit MFA déclenché");
  const summary = buildSecuritySummary(await store.summarize(BASE.toISOString()));
  assert.equal(summary.cards.blocked, 1);
  assert.equal(summary.cards.alerts, 1);
  assert.equal(summary.status.level, "critical");

  const rateLimit = await readFile(new URL("../web/lib/server/rate-limit.ts", import.meta.url), "utf8");
  assert.match(rateLimit, /RATE_LIMIT_TRIGGERED/);
  assert.match(rateLimit, /teacher-mfa/);
});

test("autorisation — refus répétés → alerte, l'admin légitime ne génère rien", async () => {
  const store = new MemorySecurityEventStore();
  const denied: SecurityEventInput = {
    type: "ADMIN_ACCESS_DENIED",
    actorType: "TEACHER",
    actorId: "teacher-staff",
    route: "/api/admin/teachers",
    httpStatus: 403,
    metadata: { reason: "not-admin" },
    aggregateWindowMinutes: 15,
  };
  for (let index = 0; index < 5; index += 1) await recordSecurityEvent(deps(store, at(index)), denied);
  const events = await allEvents(store);
  assert.equal(events.find((event) => event.eventType === "ADMIN_ACCESS_DENIED")?.occurrenceCount, 5);
  assert.ok(events.find((event) => event.eventType === "ANOMALY_REPEATED_ACCESS_DENIED"));

  const api = await readFile(new URL("../web/lib/server/api.ts", import.meta.url), "utf8");
  assert.match(api, /recordAdminAccessDenied/);
  const glue = await readFile(new URL("../web/lib/server/security-events.ts", import.meta.url), "utf8");
  assert.match(glue, /untrusted-origin/);
  assert.match(glue, /session-revoked/);
});

test("volume de lectures — une alerte par fenêtre et par compte", async () => {
  resetApiReadVolume();
  let crossing = null;
  for (let index = 0; index < 4; index += 1) crossing = trackApiRead("teacher-a", BASE.getTime() + index, 5);
  assert.equal(crossing, null);
  crossing = trackApiRead("teacher-a", BASE.getTime() + 5, 5);
  assert.equal(crossing?.observedCount, 5);
  assert.equal(trackApiRead("teacher-a", BASE.getTime() + 6, 5), null, "pas de doublon dans la fenêtre");
  assert.equal(trackApiRead("teacher-b", BASE.getTime() + 6, 5), null);
  assert.ok(trackApiRead("teacher-a", BASE.getTime() + 5 * 60_000 + 10, 1), "nouvelle fenêtre");
  resetApiReadVolume();

  const store = new MemorySecurityEventStore();
  const input = {
    type: "ANOMALY_HIGH_READ_VOLUME" as const,
    actorType: "TEACHER" as const,
    actorId: "teacher-a",
    metadata: { scope: "account", observedCount: 600, threshold: 600, windowMinutes: 5 },
    scope: "account" as const,
    subjectId: "teacher-a",
    windowMinutes: 5,
  };
  const saved = await recordSecurityAnomaly(deps(store, BASE), input);
  assert.equal(saved && securityEventLabel(saved), "600 lectures API en 5 minutes");
  assert.equal(await recordSecurityAnomaly(deps(store, BASE), { ...input, type: "TEACHER_LOGIN_FAILED" }), null);
});

test("enregistreur — une panne du journal ne lève jamais", async () => {
  const broken: SecurityEventStore = {
    append: async () => { throw new Error("disk full"); },
    appendOrIncrement: async () => { throw new Error("disk full"); },
    sumOccurrences: async () => 0,
    list: async () => ({ events: [], total: 0 }),
    summarize: async () => [],
    purgeOlderThan: async () => 0,
  };
  const errors: string[] = [];
  const result = await recordSecurityEvent(
    { store: broken, onError: (_error, type) => errors.push(type) },
    loginFailure(null),
  );
  assert.equal(result, null);
  assert.deepEqual(errors, ["TEACHER_LOGIN_FAILED"]);
  const invalid = await recordSecurityEvent(
    { store: new MemorySecurityEventStore(), onError: (_error, type) => errors.push(type) },
    { type: "NOT_A_TYPE" as never, actorType: "ANONYMOUS" },
  );
  assert.equal(invalid, null);
});

test("sauvegarde / restauration — événements journalisés", async () => {
  const store = new MemorySecurityEventStore();
  for (const type of ["BACKUP_DOWNLOADED", "BACKUP_RESTORE_STARTED", "BACKUP_RESTORE_SUCCEEDED"] as const) {
    await recordSecurityEvent(deps(store, BASE), { type, actorType: "TEACHER", actorId: "teacher-admin" });
  }
  const failed = await recordSecurityEvent(deps(store, BASE), {
    type: "BACKUP_RESTORE_FAILED",
    severity: "CRITICAL",
    actorType: "TEACHER",
    actorId: "teacher-admin",
    metadata: { failure: "unexpected-error", snapshot: { tables: {} } },
  });
  assert.deepEqual(failed?.metadata, { failure: "unexpected-error" });
  const summary = buildSecuritySummary(await store.summarize(BASE.toISOString()));
  assert.equal(summary.cards.sensitive, 4);

  const backup = await readFile(new URL("../web/app/api/admin/backup/route.ts", import.meta.url), "utf8");
  const restore = await readFile(new URL("../web/app/api/admin/restore/route.ts", import.meta.url), "utf8");
  assert.match(backup, /BACKUP_DOWNLOADED/);
  assert.match(restore, /BACKUP_RESTORE_STARTED/);
  assert.match(restore, /BACKUP_RESTORE_SUCCEEDED/);
  assert.match(restore, /BACKUP_RESTORE_FAILED/);
});

test("SQLite — persistance après réouverture, ordre et pagination", async () => {
  const dir = await mkdtemp(join(tmpdir(), "campus-security-"));
  const path = join(dir, "campus.sqlite");
  try {
    const first = await sqlStore(path);
    for (let index = 0; index < 30; index += 1) {
      await recordSecurityEvent(deps(first.store, at(index)), {
        type: "TEACHER_LOGIN_SUCCEEDED",
        actorType: "TEACHER",
        actorId: `teacher-${index}`,
      });
    }
    first.db.close();

    const reopened = await sqlStore(path);
    const page1 = await reopened.store.list({ since: BASE.toISOString(), offset: 0, limit: 25 });
    const page2 = await reopened.store.list({ since: BASE.toISOString(), offset: 25, limit: 25 });
    assert.equal(page1.total, 30);
    assert.equal(page1.events.length, 25);
    assert.equal(page2.events.length, 5);
    assert.equal(page1.events[0].actorId, "teacher-29", "plus récent d'abord");
    assert.equal(new Set([...page1.events, ...page2.events].map((event) => event.id)).size, 30);
    reopened.db.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("SQLite — agrégation, filtre de sévérité et trigger append-only", async () => {
  const { db, store } = await sqlStore();
  const fp = await computeSourceFingerprint(PLAIN_IP, FP_SECRET);
  for (let index = 0; index < 5; index += 1) {
    await recordSecurityEvent(deps(store, at(index)), { ...loginFailure(fp), aggregateWindowMinutes: 15 });
  }
  const events = await allEvents(store);
  const failure = events.find((event) => event.eventType === "TEACHER_LOGIN_FAILED");
  assert.equal(failure?.occurrenceCount, 5);
  assert.equal(failure?.lastSeenAt, at(4).toISOString());
  const warnings = await store.list({ since: BASE.toISOString(), severity: "WARNING", offset: 0, limit: 10 });
  assert.deepEqual(warnings.events.map((event) => event.eventType), ["ANOMALY_REPEATED_LOGIN_FAILURES"]);

  await assert.rejects(
    db.prepare("UPDATE security_events SET event_type = 'TEACHER_LOGIN_SUCCEEDED' WHERE id = ?").bind(failure!.id).run(),
  );
  await assert.rejects(
    db.prepare("UPDATE security_events SET actor_id = 'someone' WHERE id = ?").bind(failure!.id).run(),
  );
  await assert.rejects(
    db.prepare("UPDATE security_events SET severity = 'INFO' WHERE id = ?").bind(failure!.id).run(),
  );
  const raw = await db.prepare("SELECT * FROM security_events").bind().all<Record<string, unknown>>();
  assert.doesNotMatch(JSON.stringify(raw.results), new RegExp(PLAIN_IP.replaceAll(".", "\\.")));
});

test("rétention — purge > 180 jours, limitée dans le temps, récent conservé", async () => {
  resetSecurityEventPurgeClock();
  const { store } = await sqlStore();
  const old = new Date(BASE.getTime() - 181 * 24 * 60 * 60 * 1000);
  const recent = new Date(BASE.getTime() - 10 * 24 * 60 * 60 * 1000);
  await recordSecurityEvent(deps(store, old), { type: "TEACHER_LOGIN_SUCCEEDED", actorType: "TEACHER", actorId: "old" });
  resetSecurityEventPurgeClock();
  await recordSecurityEvent(deps(store, recent), { type: "TEACHER_LOGIN_SUCCEEDED", actorType: "TEACHER", actorId: "recent" });
  resetSecurityEventPurgeClock();
  assert.equal(await maybePurgeSecurityEvents(store, BASE), 1);
  assert.equal(await maybePurgeSecurityEvents(store, at(1)), null, "purge limitée à une fois par intervalle");
  assert.deepEqual((await allEvents(store)).map((event) => event.actorId), ["recent"]);
  resetSecurityEventPurgeClock();
});

test("restauration — le journal n'est ni effacé ni ramené en arrière", async () => {
  const { db, store } = await sqlStore();
  await seedDemoDatabase(db);
  await recordSecurityEvent(deps(store, BASE), { type: "TEACHER_LOGIN_SUCCEEDED", actorType: "TEACHER", actorId: "before" });
  const dump = await dumpCampusTables(db);
  assert.ok(!("security_events" in dump), "le journal ne fait pas partie de la sauvegarde");

  await recordSecurityEvent(deps(store, at(5)), { type: "BACKUP_RESTORE_STARTED", actorType: "TEACHER", actorId: "admin" });
  const crafted = {
    ...dump,
    security_events: [{ id: "sev_forged", event_type: "TEACHER_LOGIN_SUCCEEDED", severity: "INFO" }],
  };
  const validated = validateCampusTables(crafted);
  assert.equal(validated.ok, true);
  assert.ok(validated.ok && !("security_events" in validated.tables), "clé injectée ignorée");
  await restoreCampusTables(db, validated.ok ? validated.tables : dump);
  await recordSecurityEvent(deps(store, at(6)), { type: "BACKUP_RESTORE_SUCCEEDED", actorType: "TEACHER", actorId: "admin" });

  const types = (await allEvents(store)).map((event) => event.eventType).sort();
  assert.deepEqual(types, ["BACKUP_RESTORE_STARTED", "BACKUP_RESTORE_SUCCEEDED", "TEACHER_LOGIN_SUCCEEDED"]);
  assert.equal((await allEvents(store)).some((event) => event.id === "sev_forged"), false);
});

test("résumé 24 h — cartes, état normal / orange / rouge", () => {
  assert.equal(buildSecuritySummary([]).status.level, "normal");
  const warning = buildSecuritySummary([
    { eventType: "TEACHER_LOGIN_SUCCEEDED", severity: "INFO", rows: 3, occurrences: 3 },
    { eventType: "TEACHER_LOGIN_FAILED", severity: "INFO", rows: 1, occurrences: 6 },
    { eventType: "ANOMALY_REPEATED_LOGIN_FAILURES", severity: "WARNING", rows: 1, occurrences: 2 },
    { eventType: "MFA_RECOVERY_CODE_USED", severity: "WARNING", rows: 1, occurrences: 1 },
  ]);
  assert.equal(warning.cards.loginSucceeded, 3);
  assert.equal(warning.cards.loginFailed, 6);
  assert.equal(warning.cards.alerts, 1);
  assert.equal(warning.cards.sensitive, 1);
  assert.equal(warning.status.level, "warning");
  assert.equal(warning.status.reviewCount, 2);
  assert.equal(uiText.securityReviewCountText(2), "2 événements nécessitent une vérification.");
  assert.equal(parseSecurityPeriod("7d"), "7d");
  assert.equal(parseSecurityPeriod("365d"), "24h");
  assert.equal(securityPeriodSince("24h", BASE), new Date(BASE.getTime() - 86_400_000).toISOString());
});

test("présentation — vue navigateur sans clé d'agrégation ni empreinte complète", async () => {
  const store = new MemorySecurityEventStore();
  const fp = await computeSourceFingerprint(PLAIN_IP, FP_SECRET);
  const saved = await recordSecurityEvent(deps(store, BASE), { ...loginFailure(fp), aggregateWindowMinutes: 15 });
  assert.ok(saved?.aggregationKey);
  const view = presentSecurityEvent(saved, { teacherLabel: (id) => (id === "teacher-chf" ? "ChF" : null) });
  assert.equal(view.actorLabel, "Compte ChF");
  assert.match(view.source ?? "", /^[0-9A-F]{4}…[0-9A-F]{4}$/);
  assert.ok(!("aggregationKey" in view));
  assert.doesNotMatch(JSON.stringify(view), new RegExp(fp!));
});

test("textes UI — formulations exigées, aucune promesse d'absence de fuite", async () => {
  assert.equal(uiText.SECURITY_ACTIVITY_TITLE, "Activité de sécurité");
  assert.equal(uiText.SECURITY_ACTIVITY_SUBTITLE, "Surveillance des connexions, accès refusés et opérations sensibles.");
  assert.equal(uiText.SECURITY_ACTIVITY_STATUS_NORMAL, "Aucune activité suspecte détectée sur les dernières 24 heures.");
  assert.equal(
    uiText.SECURITY_ACTIVITY_STATUS_WARNING_DETAIL,
    "Une activité inhabituelle a été détectée. Consultez les événements ci-dessous.",
  );
  assert.equal(uiText.SECURITY_ACTIVITY_STATUS_CRITICAL, "Une activité inhabituelle importante a été détectée.");
  assert.match(uiText.SECURITY_ACTIVITY_DISCLAIMER, /ne constitue pas à lui seul une preuve absolue/);

  const panel = await readFile(new URL("../web/app/components/security-activity-panel.tsx", import.meta.url), "utf8");
  const admin = await readFile(new URL("../web/app/components/administration-panel.tsx", import.meta.url), "utf8");
  const uiSource = await readFile(new URL("../src/features/security-events/ui-text.ts", import.meta.url), "utf8");
  for (const source of [panel, admin, uiSource.replace(/\/\*\*[\s\S]*?\*\/|\/\/.*$/gm, "")]) {
    for (const forbidden of uiText.SECURITY_FORBIDDEN_CLAIMS.filter((claim) => claim.source !== "garanti[rte]")) {
      assert.doesNotMatch(source.replace(/SECURITY_FORBIDDEN_CLAIMS[\s\S]*?\] as const;/, ""), forbidden);
    }
  }
  assert.doesNotMatch(panel, /Aucune fuite|aucune donnée n.a été volée/i);

  assert.match(admin, /<SecurityActivityPanel \/>/);
  assert.match(admin, /<AdminSecurityPanel onNotice=\{onNotice\} \/>/);
  assert.match(panel, /SECURITY_ACTIVITY_SUMMARY_TITLE/);
  assert.match(panel, /SECURITY_ACTIVITY_DISCLAIMER/);
  assert.match(panel, /security-pagination/);
  assert.match(panel, /SECURITY_PERIOD_LABELS/);
  assert.match(panel, /"ALL", "INFO", "WARNING", "CRITICAL"/);
  for (const column of ["Date/heure", "Niveau", "Événement", "Compte/acteur", "Source", "Détail"]) {
    assert.match(panel, new RegExp(`>${column}<`));
  }
  assert.doesNotMatch(panel, /JSON\.stringify/, "le détail n'affiche jamais de charge utile brute");
});

test("API journal — admin seulement, paginée, sans cache", async () => {
  const route = await readFile(new URL("../web/app/api/admin/security/activity/route.ts", import.meta.url), "utf8");
  assert.match(route, /requireAdminSession/);
  assert.match(route, /withApiObservability\("\/api\/admin\/security\/activity"/);
  assert.match(route, /SECURITY_ACTIVITY_MAX_PAGE_SIZE = 100/);
  assert.match(route, /no-store/);
  assert.match(route, /presentSecurityEvent/);
  const e2e = await readFile(new URL("../web/tests/e2e-api.test.mjs", import.meta.url), "utf8");
  assert.match(e2e, /\/api\/admin\/security\/activity/);
});

test("instrumentation — routes sensibles câblées, jamais de secret transmis", async () => {
  const routes: Record<string, RegExp[]> = {
    "auth/teacher/route.ts": [/TEACHER_LOGIN_SUCCEEDED/, /TEACHER_LOGIN_FAILED/, /TEACHER_LOGIN_ACCOUNT_BLOCKED/],
    "auth/student/route.ts": [/STUDENT_LOGIN_FAILED/],
    "auth/teacher/password/route.ts": [/TEACHER_PASSWORD_CHANGED/],
    "auth/teacher/mfa/verify/route.ts": [/MFA_VERIFY_FAILED/, /MFA_RECOVERY_CODE_USED/],
    "auth/teacher/mfa/confirm/route.ts": [/MFA_ENABLED/],
    "admin/security/mfa/recovery/route.ts": [/MFA_RECOVERY_CODES_REGENERATED/],
    "admin/security/mfa/reconfigure/confirm/route.ts": [/MFA_RECONFIGURED/],
    "admin/teachers/route.ts": [/TEACHER_ACCOUNT_CREATED/],
    "admin/teachers/[id]/route.ts": [/accountSecurityChanges/, /TEACHER_ACCOUNT_DELETED/],
    "admin/teachers/[id]/password/route.ts": [/TEACHER_PASSWORD_RESET/],
    "admin/student-access/route.ts": [/STUDENT_ACCESS_ROTATED/, /STUDENT_ACCESS_REVOKED/],
    "admin/school-year/[id]/export/route.ts": [/DATA_EXPORTED/],
  };
  for (const [path, patterns] of Object.entries(routes)) {
    const source = await readFile(new URL(`../web/app/api/${path}`, import.meta.url), "utf8");
    for (const pattern of patterns) assert.match(source, pattern, `${path} ${pattern}`);
    const calls = source.match(/recordRequestSecurityEvent\([\s\S]*?\n\s{0,6}\}\);/g) ?? [];
    for (const call of calls) {
      assert.doesNotMatch(call, /password:|totp:|recoveryCode:|code:|cookie|body[,}]/i, `${path} transmet un secret`);
    }
  }
  const scripts = await readFile(new URL("../scripts/reset-admin-2fa.ts", import.meta.url), "utf8");
  assert.match(scripts, /MFA_RESET/);
});

test("comptes — changements de sécurité et codes d'échec d'authentification", async () => {
  const base = { initials: "ChF", isAdmin: false, isActive: true, isArchived: false };
  assert.deepEqual(accountSecurityChanges(base, { ...base, isAdmin: true }), ["TEACHER_ADMIN_ROLE_GRANTED"]);
  assert.deepEqual(accountSecurityChanges(base, { ...base, isActive: false, initials: "CF" }), [
    "TEACHER_ACCOUNT_DISABLED",
    "TEACHER_LOGIN_IDENTIFIER_CHANGED",
  ]);
  assert.deepEqual(accountSecurityChanges(base, base), []);

  resetMemoryTeacherAccountStore();
  const accounts = getMemoryTeacherAccountStore();
  const wrong = await accounts.authenticate("ChF", "not-the-password");
  assert.equal(wrong.ok, false);
  assert.equal(!wrong.ok && wrong.failure, "invalid-credentials");
  const unknown = await accounts.authenticate("ZZZ", "whatever");
  assert.equal(!unknown.ok && unknown.failure, "invalid-credentials");
  resetMemoryTeacherAccountStore();
});

test("requestId — stable par requête, en-tête client validé", () => {
  const request = new Request("https://campus.test/api/x");
  assert.equal(readRequestId(request), readRequestId(request));
  const forwarded = new Request("https://campus.test/api/x", { headers: { "x-request-id": "abc-123" } });
  assert.equal(readRequestId(forwarded), "abc-123");
  const injected = new Request("https://campus.test/api/x", { headers: { "x-request-id": "a b\"}{" } });
  assert.notEqual(readRequestId(injected), "a b\"}{");
  assert.match(readRequestId(injected), /^req_/);
});

test("documentation — journal, rétention, sauvegarde et évolutions futures", async () => {
  const doc = await readFile(new URL("../docs/SECURITY_ACTIVITY_LOG.md", import.meta.url), "utf8");
  assert.match(doc, /180 jours/);
  assert.match(doc, /hors sauvegarde/i);
  assert.match(doc, /HMAC/);
  assert.match(doc, /Évolutions futures/);
});
