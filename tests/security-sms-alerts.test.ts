import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  SECURITY_EVENT_CATALOG,
  SECURITY_EVENT_TYPES,
  recordSecurityEvent,
  type SecurityEvent,
  type SecurityEventType,
} from "../src/features/security-events/index.ts";
import {
  SECURITY_SMS_COOLDOWN_MINUTES,
  SECURITY_SMS_ENV,
  SECURITY_SMS_MAX_PER_DAY,
  SECURITY_SMS_MAX_PER_HOUR,
  SECURITY_SMS_TEST_COOLDOWN_MINUTES,
  SECURITY_SMS_TEXTS,
  SECURITY_SMS_TEXT_CRITICAL,
  SECURITY_SMS_TEXT_TEST,
  SECURITY_SMS_TEXT_WARNING,
  SECURITY_SMS_TIMEOUT_MS,
  SECURITY_SMS_WARNING_ELIGIBLE_TYPES,
  TwilioSecuritySmsProvider,
  createSecuritySmsProvider,
  isE164PhoneNumber,
  maskPhoneNumber,
  notifySecurityEvent,
  readSecuritySmsActivity,
  readSecuritySmsConfig,
  securitySmsConfigView,
  sendSecuritySmsTest,
  shouldSendSecuritySms,
  type SecuritySmsConfig,
  type SecuritySmsDeps,
  type SecuritySmsMessage,
  type SecuritySmsProvider,
  type SecuritySmsSendResult,
  type SecurityNotificationStore,
} from "../src/features/security-notifications/index.ts";
import * as smsUi from "../src/features/security-notifications/ui-text.ts";
import {
  CAMPUS_BACKUP_EXCLUDED_OPERATIONAL_TABLES,
  CAMPUS_BACKUP_INSERT_ORDER,
} from "../src/lib/persistence/campus-backup-tables.ts";
import { MemorySecurityEventStore } from "../src/lib/persistence/memory-security-event-store.ts";
import { MemorySecurityNotificationStore } from "../src/lib/persistence/memory-security-notification-store.ts";
import { createNodeSqliteDatabase } from "../src/lib/persistence/sql/adapters.ts";
import { SQL_MIGRATION_FILES, applyMigrations } from "../src/lib/persistence/sql/migrate.ts";
import { seedDemoDatabase } from "../src/lib/persistence/sql/seed.ts";
import {
  dumpCampusTables,
  restoreCampusTables,
  validateCampusTables,
} from "../src/lib/persistence/sql/sql-campus-backup.ts";
import { SqlSecurityNotificationStore } from "../src/lib/persistence/sql/sql-security-notification-store.ts";

const PHONE = "+41000000012";
const ACCOUNT_SID = `AC${"a1".repeat(16)}`;
const AUTH_TOKEN = "f0e1d2c3b4a5968778695a4b3c2d1e0f";
const FINGERPRINT = "7F2A1B3C4D5E91C4";
const BASE = new Date("2026-11-01T01:42:00.000Z");

const ENABLED_ENV = {
  NODE_ENV: "production",
  [SECURITY_SMS_ENV.enabled]: "true",
  [SECURITY_SMS_ENV.to]: PHONE,
  [SECURITY_SMS_ENV.provider]: "twilio",
  [SECURITY_SMS_ENV.twilioAccountSid]: ACCOUNT_SID,
  [SECURITY_SMS_ENV.twilioAuthToken]: AUTH_TOKEN,
  [SECURITY_SMS_ENV.twilioFrom]: "CampusAg",
};
const ENABLED = readSecuritySmsConfig(ENABLED_ENV);

class FakeSmsProvider implements SecuritySmsProvider {
  readonly id = "fake";
  readonly label = "Fake";
  readonly calls: SecuritySmsMessage[] = [];
  mode: "ok" | "error" | "hang" | "throw" = "ok";

  async sendSecurityAlert(message: SecuritySmsMessage): Promise<SecuritySmsSendResult> {
    this.calls.push({ ...message });
    if (this.mode === "error") return { ok: false, failure: "provider-error" };
    if (this.mode === "throw") throw new Error(`provider exploded ${AUTH_TOKEN}`);
    if (this.mode === "hang") return new Promise<SecuritySmsSendResult>(() => undefined);
    return { ok: true, providerMessageId: `SM${"0".repeat(32)}` };
  }
}

class Clock {
  current = BASE.getTime();
  now = () => new Date(this.current);
  advance(minutes: number) {
    this.current += minutes * 60_000;
  }
}

interface Harness {
  deps: SecuritySmsDeps;
  provider: FakeSmsProvider;
  clock: Clock;
  logs: { name: string; fields: Record<string, unknown> }[];
}

function harness(
  options: { config?: SecuritySmsConfig; store?: SecurityNotificationStore; clock?: Clock; timeoutMs?: number } = {},
): Harness {
  const provider = new FakeSmsProvider();
  const clock = options.clock ?? new Clock();
  const logs: Harness["logs"] = [];
  return {
    provider,
    clock,
    logs,
    deps: {
      store: options.store ?? new MemorySecurityNotificationStore(),
      config: options.config ?? ENABLED,
      provider,
      now: clock.now,
      timeoutMs: options.timeoutMs,
      log: (name, fields) => logs.push({ name, fields }),
    },
  };
}

let sequence = 0;
function securityEvent(eventType: SecurityEventType, overrides: Partial<SecurityEvent> = {}): SecurityEvent {
  const definition = SECURITY_EVENT_CATALOG[eventType];
  sequence += 1;
  return {
    id: `sev_test_${sequence}`,
    occurredAt: BASE.toISOString(),
    lastSeenAt: BASE.toISOString(),
    eventType,
    category: definition.category,
    severity: definition.severity,
    actorType: "ANONYMOUS",
    actorId: null,
    targetType: "TEACHER",
    targetId: "teacher-chf",
    route: "/api/auth/teacher",
    httpMethod: "POST",
    httpStatus: 429,
    requestId: "req_correlation_42",
    sourceFingerprint: FINGERPRINT,
    metadata: {},
    occurrenceCount: 1,
    aggregationKey: null,
    ...overrides,
  };
}

const criticalRateLimit = (overrides: Partial<SecurityEvent> = {}) =>
  securityEvent("RATE_LIMIT_TRIGGERED", {
    severity: "CRITICAL",
    metadata: { scope: "teacher-mfa", layer: "target", targetKnown: true },
    ...overrides,
  });

async function sqlStore(path = ":memory:") {
  const db = createNodeSqliteDatabase(path);
  await applyMigrations(db);
  return { db, store: new SqlSecurityNotificationStore(db) };
}

test("migration 0036 — table opérationnelle hors sauvegarde, sans numéro ni texte", async () => {
  assert.ok(SQL_MIGRATION_FILES.includes("0036_security_notifications.sql"));
  assert.equal(SQL_MIGRATION_FILES.at(-1), "0037_security_notification_email.sql");
  const sql = await readFile(new URL("../migrations/0036_security_notifications.sql", import.meta.url), "utf8");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS security_notifications/);
  assert.match(sql, /security_notifications_append_only/);
  assert.match(sql, /security_notifications_status_final/);
  const schema = sql.replace(/--.*$/gm, "");
  assert.doesNotMatch(schema, /phone|recipient|body|text_|message_text|\bto_number\b|\bto\b/i);
  assert.ok((CAMPUS_BACKUP_EXCLUDED_OPERATIONAL_TABLES as readonly string[]).includes("security_notifications"));
  assert.ok(!(CAMPUS_BACKUP_INSERT_ORDER as readonly string[]).includes("security_notifications"));
});

test("politique — INFO, WARNING non listé et événements isolés ne produisent jamais de SMS", () => {
  for (const type of [
    "TEACHER_LOGIN_SUCCEEDED",
    "TEACHER_LOGIN_FAILED",
    "MFA_VERIFY_FAILED",
    "SESSION_REJECTED",
    "BACKUP_DOWNLOADED",
    "DATA_EXPORTED",
  ] as const) {
    assert.equal(shouldSendSecuritySms(securityEvent(type)).eligible, false, type);
  }
  const isolated401 = securityEvent("ADMIN_ACCESS_DENIED", { severity: "INFO", metadata: { reason: "anonymous" } });
  const isolated403 = securityEvent("ADMIN_ACCESS_DENIED", { severity: "WARNING", metadata: { reason: "not-admin" } });
  assert.deepEqual(shouldSendSecuritySms(isolated401), { eligible: false, reason: "info" });
  assert.deepEqual(shouldSendSecuritySms(isolated403), { eligible: false, reason: "warning-not-listed" });
  assert.equal(shouldSendSecuritySms(securityEvent("RATE_LIMIT_TRIGGERED")).eligible, false, "rate limit WARNING ordinaire");
  assert.equal(shouldSendSecuritySms(securityEvent("ANOMALY_REPEATED_STUDENT_LOGIN_FAILURES")).eligible, false);

  const warningTypes = SECURITY_EVENT_TYPES.filter((type) => SECURITY_EVENT_CATALOG[type].severity === "WARNING");
  assert.ok(SECURITY_SMS_WARNING_ELIGIBLE_TYPES.length < warningTypes.length, "pas de règle severity >= WARNING");
  for (const type of SECURITY_SMS_WARNING_ELIGIBLE_TYPES) {
    assert.equal(SECURITY_EVENT_CATALOG[type].severity, "WARNING", type);
  }
});

test("politique — WARNING sensible et CRITICAL éligibles, clé de déduplication explicite", () => {
  const recovery = shouldSendSecuritySms(securityEvent("MFA_RECOVERY_CODE_USED", { actorType: "TEACHER", actorId: "teacher-chf" }));
  assert.equal(recovery.eligible, true);
  assert.equal(recovery.eligible && recovery.level, "WARNING");
  const critical = shouldSendSecuritySms(criticalRateLimit());
  assert.equal(critical.eligible && critical.level, "CRITICAL");
  assert.equal(critical.eligible && critical.cooldownMinutes, SECURITY_SMS_COOLDOWN_MINUTES);
  assert.equal(
    critical.eligible && critical.deduplicationKey,
    `RATE_LIMIT_TRIGGERED:teacher-mfa:ANONYMOUS:teacher-chf:${FINGERPRINT}`,
  );
  const restoreFailed = securityEvent("BACKUP_RESTORE_FAILED", { severity: "CRITICAL" });
  assert.equal(shouldSendSecuritySms(restoreFailed).eligible, true);

  const accountAnomaly = (source: string) =>
    shouldSendSecuritySms(securityEvent("ANOMALY_REPEATED_LOGIN_FAILURES", {
      sourceFingerprint: source,
      metadata: { scope: "account", observedCount: 5, threshold: 5, windowMinutes: 15 },
    }));
  const first = accountAnomaly("AAAAAAAAAAAAAAAA");
  const second = accountAnomaly("BBBBBBBBBBBBBBBB");
  assert.ok(first.eligible && second.eligible);
  assert.equal(first.eligible && first.deduplicationKey, second.eligible && second.deduplicationKey, "même compte visé");
});

test("politique — aucun événement de notification ne déclenche de SMS (pas de boucle)", () => {
  const smsEvent = securityEvent("SECURITY_SMS_TEST_REQUESTED", { severity: "CRITICAL" });
  assert.deepEqual(shouldSendSecuritySms(smsEvent), { eligible: false, reason: "notification-event" });
  assert.equal(
    shouldSendSecuritySms({ ...criticalRateLimit(), eventType: "SECURITY_SMS_SENT" }).eligible,
    false,
  );
});

test("envoi — INFO aucun appel, WARNING éligible et CRITICAL : un SMS au texte fixe", async () => {
  const { deps, provider } = harness();
  assert.deepEqual(await notifySecurityEvent(deps, securityEvent("TEACHER_LOGIN_SUCCEEDED")), { outcome: "not-eligible" });
  assert.deepEqual(
    await notifySecurityEvent(deps, securityEvent("ADMIN_ACCESS_DENIED", { severity: "WARNING" })),
    { outcome: "not-eligible" },
  );
  assert.equal(provider.calls.length, 0);

  const warning = await notifySecurityEvent(deps, securityEvent("MFA_RECOVERY_CODE_USED", { actorType: "TEACHER", actorId: "teacher-chf" }));
  assert.equal(warning.outcome, "sent");
  const critical = await notifySecurityEvent(deps, criticalRateLimit());
  assert.equal(critical.outcome, "sent");
  assert.deepEqual(provider.calls, [
    { to: PHONE, text: SECURITY_SMS_TEXT_WARNING },
    { to: PHONE, text: SECURITY_SMS_TEXT_CRITICAL },
  ]);
  const activity = await readSecuritySmsActivity(deps.store, BASE);
  assert.equal(activity.lastAlertSentAt, BASE.toISOString());
  assert.equal(activity.last24h.sent, 2);
});

test("cooldown — deux événements identiques : un seul SMS, nouveau SMS après expiration", async () => {
  const { deps, provider, clock } = harness();
  assert.equal((await notifySecurityEvent(deps, criticalRateLimit())).outcome, "sent");
  clock.advance(1);
  assert.equal((await notifySecurityEvent(deps, criticalRateLimit())).outcome, "suppressed-cooldown");
  clock.advance(SECURITY_SMS_COOLDOWN_MINUTES - 2);
  assert.equal((await notifySecurityEvent(deps, criticalRateLimit())).outcome, "suppressed-cooldown");
  assert.equal(provider.calls.length, 1);
  clock.advance(2);
  assert.equal((await notifySecurityEvent(deps, criticalRateLimit())).outcome, "sent");
  assert.equal(provider.calls.length, 2);
  const counts = await deps.store.countByStatus(new Date(BASE.getTime() - 60_000).toISOString());
  assert.equal(counts.find((entry) => entry.status === "SUPPRESSED_COOLDOWN")?.occurrences, 2, "suppressions agrégées");
});

test("quota horaire — le 4e SMS de l'heure est supprimé", async () => {
  const { deps, provider, clock } = harness();
  const outcomes: string[] = [];
  for (let index = 0; index < 4; index += 1) {
    outcomes.push((await notifySecurityEvent(deps, criticalRateLimit({ targetId: `teacher-${index}` }))).outcome);
    clock.advance(5);
  }
  assert.deepEqual(outcomes, ["sent", "sent", "sent", "suppressed-quota"]);
  assert.equal(provider.calls.length, SECURITY_SMS_MAX_PER_HOUR);
  clock.advance(60);
  assert.equal((await notifySecurityEvent(deps, criticalRateLimit({ targetId: "teacher-later" }))).outcome, "sent");
});

test("quota journalier — au-delà de 10 SMS sur 24 h, envois supprimés", async () => {
  const { deps, provider, clock } = harness();
  for (let index = 0; index < SECURITY_SMS_MAX_PER_DAY; index += 1) {
    assert.equal((await notifySecurityEvent(deps, criticalRateLimit({ targetId: `teacher-${index}` }))).outcome, "sent", `#${index}`);
    clock.advance(21);
  }
  assert.equal((await notifySecurityEvent(deps, criticalRateLimit({ targetId: "teacher-extra" }))).outcome, "suppressed-quota");
  assert.equal(provider.calls.length, SECURITY_SMS_MAX_PER_DAY);
  clock.advance(24 * 60);
  assert.equal((await notifySecurityEvent(deps, criticalRateLimit({ targetId: "teacher-next-day" }))).outcome, "sent");
});

test("persistance — cooldown et quotas respectés après redémarrage (SQLite fichier)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "campus-sms-"));
  const path = join(dir, "campus.sqlite");
  const clock = new Clock();
  try {
    const first = await sqlStore(path);
    const before = harness({ store: first.store, clock });
    for (let index = 0; index < 3; index += 1) {
      assert.equal((await notifySecurityEvent(before.deps, criticalRateLimit({ targetId: `teacher-${index}` }))).outcome, "sent");
    }
    first.db.close();

    clock.advance(2);
    const reopened = await sqlStore(path);
    const after = harness({ store: reopened.store, clock });
    assert.equal((await notifySecurityEvent(after.deps, criticalRateLimit({ targetId: "teacher-0" }))).outcome, "suppressed-cooldown");
    assert.equal((await notifySecurityEvent(after.deps, criticalRateLimit({ targetId: "teacher-new" }))).outcome, "suppressed-quota");
    assert.equal(after.provider.calls.length, 0, "aucun SMS après redémarrage");
    reopened.db.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("fournisseur en erreur — l'événement reste enregistré, l'application continue", async () => {
  const events = new MemorySecurityEventStore();
  const { deps, provider } = harness();
  provider.mode = "error";
  const pending: Promise<unknown>[] = [];
  const saved = await recordSecurityEvent(
    { store: events, notify: (event) => pending.push(notifySecurityEvent(deps, event)) },
    {
      type: "RATE_LIMIT_TRIGGERED",
      severity: "CRITICAL",
      actorType: "ANONYMOUS",
      httpStatus: 429,
      metadata: { scope: "teacher-mfa", layer: "target", targetKnown: true },
    },
  );
  assert.ok(saved, "SecurityEvent créé avant toute tentative SMS");
  const [result] = await Promise.all(pending);
  assert.deepEqual(result, { outcome: "failed", failure: "provider-error" });
  assert.equal((await events.list({ since: "2000-01-01T00:00:00.000Z", offset: 0, limit: 10 })).total, 1);

  provider.mode = "throw";
  const thrown = await notifySecurityEvent(deps, criticalRateLimit({ targetId: "teacher-throw" }));
  assert.deepEqual(thrown, { outcome: "failed", failure: "unexpected" });
  assert.doesNotMatch(JSON.stringify(harness().logs), new RegExp(AUTH_TOKEN));

  const throwingNotify = await recordSecurityEvent(
    { store: events, notify: () => { throw new Error("notify down"); } },
    { type: "MFA_RECOVERY_CODE_USED", actorType: "TEACHER", actorId: "teacher-chf" },
  );
  assert.ok(throwingNotify, "un notify défaillant n'empêche pas l'écriture");
});

test("timeout — un fournisseur qui ne répond pas ne bloque pas", async () => {
  const { deps, provider } = harness({ timeoutMs: 50 });
  provider.mode = "hang";
  const started = Date.now();
  const result = await notifySecurityEvent(deps, criticalRateLimit());
  assert.deepEqual(result, { outcome: "failed", failure: "timeout" });
  assert.ok(Date.now() - started < 2_000);
  assert.equal(SECURITY_SMS_TIMEOUT_MS, 5_000);
  const counts = await deps.store.countByStatus(new Date(BASE.getTime() - 60_000).toISOString());
  assert.equal(counts.find((entry) => entry.status === "FAILED")?.rows, 1, "l'échec compte dans les quotas");

  const slowFetch = (_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
  });
  const twilio = new TwilioSecuritySmsProvider({ accountSid: ACCOUNT_SID, authToken: AUTH_TOKEN, from: "CampusAg" }, slowFetch);
  assert.deepEqual(await twilio.sendSecurityAlert({ to: PHONE, text: SECURITY_SMS_TEXT_TEST }, { timeoutMs: 30 }), {
    ok: false,
    failure: "timeout",
  });
});

test("désactivé — aucun appel fournisseur, statut DISABLED tracé", async () => {
  const disabled = readSecuritySmsConfig({ NODE_ENV: "production" });
  const { deps, provider } = harness({ config: disabled });
  assert.deepEqual(await notifySecurityEvent(deps, criticalRateLimit()), { outcome: "disabled" });
  assert.deepEqual(await notifySecurityEvent(deps, criticalRateLimit()), { outcome: "disabled" });
  assert.deepEqual(await sendSecuritySmsTest(deps), { outcome: "disabled" });
  assert.equal(provider.calls.length, 0);
  const counts = await deps.store.countByStatus(new Date(BASE.getTime() - 60_000).toISOString());
  assert.equal(counts.find((entry) => entry.status === "DISABLED")?.occurrences, 3);
});

test("configuration — environnements, variables incomplètes et numéro invalide", () => {
  assert.deepEqual(readSecuritySmsConfig({}), { status: "disabled", reason: "not-enabled" });
  assert.deepEqual(readSecuritySmsConfig({ ...ENABLED_ENV, [SECURITY_SMS_ENV.enabled]: "false" }), {
    status: "disabled",
    reason: "not-enabled",
  });
  for (const nodeEnv of ["development", "test", undefined]) {
    assert.deepEqual(readSecuritySmsConfig({ ...ENABLED_ENV, NODE_ENV: nodeEnv }), { status: "disabled", reason: "non-production" });
  }
  assert.deepEqual(readSecuritySmsConfig({ ...ENABLED_ENV, CI: "true" }), { status: "disabled", reason: "non-production" });

  const incomplete = readSecuritySmsConfig({ NODE_ENV: "production", [SECURITY_SMS_ENV.enabled]: "true" });
  assert.equal(incomplete.status, "misconfigured");
  assert.deepEqual(incomplete.status === "misconfigured" && incomplete.invalid, [
    SECURITY_SMS_ENV.to,
    SECURITY_SMS_ENV.twilioAccountSid,
    SECURITY_SMS_ENV.twilioAuthToken,
    SECURITY_SMS_ENV.twilioFrom,
  ]);
  assert.equal(createSecuritySmsProvider(incomplete), null);

  for (const invalidNumber of ["0000000012", "+41 00 000 00 12", "41000000012", "+0000000012", "+41"]) {
    assert.equal(isE164PhoneNumber(invalidNumber), false, invalidNumber);
    const config = readSecuritySmsConfig({ ...ENABLED_ENV, [SECURITY_SMS_ENV.to]: invalidNumber });
    assert.equal(config.status, "misconfigured", invalidNumber);
  }
  assert.equal(readSecuritySmsConfig({ ...ENABLED_ENV, [SECURITY_SMS_ENV.provider]: "carrier-pigeon" }).status, "misconfigured");
  assert.equal(ENABLED.status, "enabled");
  assert.ok(createSecuritySmsProvider(ENABLED));

  assert.equal(maskPhoneNumber(PHONE), "+41 •• ••• •• 12");
  assert.equal(maskPhoneNumber("invalid"), null);
  const view = JSON.stringify(securitySmsConfigView(ENABLED));
  assert.match(view, /\+41 •• ••• •• 12/);
  assert.doesNotMatch(view, /791234512|a1a1a1|f0e1d2/);
  const incompleteView = JSON.stringify(securitySmsConfigView(readSecuritySmsConfig({
    ...ENABLED_ENV,
    [SECURITY_SMS_ENV.to]: "079",
  })));
  assert.doesNotMatch(incompleteView, /a1a1a1|f0e1d2/, "les valeurs ne sont jamais renvoyées");
});

test("contenu — SMS minimal, sans aucune donnée de l'événement", async () => {
  const { deps, provider, clock } = harness();
  const sensitive = criticalRateLimit({
    actorType: "TEACHER",
    actorId: "teacher-chf",
    targetId: "teacher-chf",
    route: "/api/auth/teacher/mfa/verify",
    requestId: "req_correlation_42",
  });
  await notifySecurityEvent(deps, sensitive);
  clock.advance(SECURITY_SMS_TEST_COOLDOWN_MINUTES + 1);
  await notifySecurityEvent(deps, securityEvent("ANOMALY_HIGH_READ_VOLUME", {
    actorType: "TEACHER",
    actorId: "teacher-xyz",
    metadata: { scope: "account", observedCount: 612, threshold: 600, windowMinutes: 5 },
  }));
  await sendSecuritySmsTest(deps);
  assert.equal(provider.calls.length, 3);
  for (const call of provider.calls) {
    assert.deepEqual(Object.keys(call).sort(), ["text", "to"]);
    assert.ok((SECURITY_SMS_TEXTS as readonly string[]).includes(call.text));
    assert.doesNotMatch(call.text, /teacher|ChF|\/api\/|req_|7F2A|91C4|612|\d{2}:\d{2}|\d+\.\d+\.\d+\.\d+/);
  }
  for (const text of SECURITY_SMS_TEXTS) {
    assert.ok(text.length <= 160, "un seul segment SMS");
    assert.doesNotMatch(text, /\d/);
    assert.match(text, /^Campus Agenda : /);
  }
});

test("logs — jamais le numéro complet, un secret fournisseur ou la clé de déduplication", async () => {
  const { deps, provider, logs, clock } = harness();
  await notifySecurityEvent(deps, criticalRateLimit());
  await notifySecurityEvent(deps, criticalRateLimit());
  provider.mode = "error";
  for (let index = 0; index < 4; index += 1) {
    await notifySecurityEvent(deps, criticalRateLimit({ targetId: `teacher-${index}` }));
    clock.advance(1);
  }
  const names = new Set(logs.map((entry) => entry.name));
  for (const expected of ["security_sms_sent", "security_sms_failed", "security_sms_suppressed_cooldown", "security_sms_suppressed_quota"]) {
    assert.ok(names.has(expected), expected);
  }
  const serialized = JSON.stringify(logs);
  assert.doesNotMatch(serialized, /791234512|\+41/);
  assert.doesNotMatch(serialized, new RegExp(`${AUTH_TOKEN}|${ACCOUNT_SID}`));
  assert.doesNotMatch(serialized, new RegExp(FINGERPRINT));
  assert.doesNotMatch(serialized, /teacher-chf|teacher-\d|deduplicationKey|Campus Agenda :/);
});

test("anti-abus — 100 événements critiques en quelques secondes : au plus 3 SMS", async () => {
  const events = new MemorySecurityEventStore();
  const { deps, provider, clock } = harness();
  const pending: Promise<{ outcome: string }>[] = [];
  const recorderDeps = { store: events, now: clock.now, notify: (event: SecurityEvent) => pending.push(notifySecurityEvent(deps, event)) };

  for (let index = 0; index < 100; index += 1) {
    await recordSecurityEvent(recorderDeps, {
      type: "RATE_LIMIT_TRIGGERED",
      severity: "CRITICAL",
      actorType: "ANONYMOUS",
      httpStatus: 429,
      sourceFingerprint: FINGERPRINT,
      metadata: { scope: "teacher-mfa", layer: "ip", targetKnown: false },
      aggregateWindowMinutes: 15,
    });
  }
  // Variante : l'attaquant change de source et de compte visé à chaque requête.
  const rotating = Array.from({ length: 100 }, (_, index) =>
    notifySecurityEvent(deps, criticalRateLimit({
      targetId: `teacher-${index}`,
      sourceFingerprint: index.toString(16).toUpperCase().padStart(16, "0"),
    })));
  const outcomes = [...await Promise.all(pending), ...await Promise.all(rotating)];

  const listed = await events.list({ since: "2000-01-01T00:00:00.000Z", offset: 0, limit: 10 });
  assert.equal(listed.total, 1, "événements agrégés normalement");
  assert.equal(listed.events[0]?.occurrenceCount, 100);
  assert.ok(provider.calls.length <= SECURITY_SMS_MAX_PER_HOUR, `${provider.calls.length} appels`);
  assert.equal(provider.calls.length, SECURITY_SMS_MAX_PER_HOUR);
  assert.equal(outcomes.filter((entry) => entry.outcome === "sent").length, SECURITY_SMS_MAX_PER_HOUR);
  assert.equal(outcomes.length, 200, "chaque événement a reçu une décision, rien n'est bloqué");
});

test("SMS de test — un toutes les 10 minutes, compté dans les plafonds", async () => {
  const { deps, provider, clock } = harness();
  assert.equal((await sendSecuritySmsTest(deps)).outcome, "sent");
  assert.deepEqual(provider.calls.at(-1), { to: PHONE, text: SECURITY_SMS_TEXT_TEST });
  clock.advance(SECURITY_SMS_TEST_COOLDOWN_MINUTES - 1);
  assert.equal((await sendSecuritySmsTest(deps)).outcome, "suppressed-cooldown");
  const activity = await readSecuritySmsActivity(deps.store, clock.now());
  assert.ok(activity.testAvailableAt);
  assert.equal(activity.lastTestSentAt, BASE.toISOString());
  assert.equal(activity.lastAlertSentAt, null, "un test n'est pas une alerte");
  clock.advance(2);
  assert.equal((await sendSecuritySmsTest(deps)).outcome, "sent");
  await notifySecurityEvent(deps, criticalRateLimit());
  assert.equal((await notifySecurityEvent(deps, criticalRateLimit({ targetId: "teacher-2" }))).outcome, "suppressed-quota");
  assert.equal(provider.calls.length, 3);
});

test("Twilio — HTTPS natif, seuls To / Body / From transmis, SID lu seul", async () => {
  const requests: { url: string; init: RequestInit }[] = [];
  let status = 201;
  const fakeFetch = async (url: string, init: RequestInit) => {
    requests.push({ url, init });
    return new Response(
      JSON.stringify({ sid: `SM${"b2".repeat(16)}`, to: PHONE, body: "echo", account_sid: ACCOUNT_SID }),
      { status },
    );
  };
  const provider = new TwilioSecuritySmsProvider({ accountSid: ACCOUNT_SID, authToken: AUTH_TOKEN, from: "CampusAg" }, fakeFetch);
  const ok = await provider.sendSecurityAlert({ to: PHONE, text: SECURITY_SMS_TEXT_CRITICAL }, { timeoutMs: 1_000 });
  assert.deepEqual(ok, { ok: true, providerMessageId: `SM${"b2".repeat(16)}` });
  const [{ url, init }] = requests;
  assert.equal(url, `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`);
  assert.equal(init.method, "POST");
  assert.equal(init.redirect, "error");
  assert.equal((init.headers as Record<string, string>).Authorization, `Basic ${btoa(`${ACCOUNT_SID}:${AUTH_TOKEN}`)}`);
  const form = new URLSearchParams(String(init.body));
  assert.deepEqual([...form.keys()].sort(), ["Body", "From", "To"]);
  assert.equal(form.get("Body"), SECURITY_SMS_TEXT_CRITICAL);

  const service = new TwilioSecuritySmsProvider({ accountSid: ACCOUNT_SID, authToken: AUTH_TOKEN, from: `MG${"c3".repeat(16)}` }, fakeFetch);
  await service.sendSecurityAlert({ to: PHONE, text: SECURITY_SMS_TEXT_TEST }, { timeoutMs: 1_000 });
  assert.ok(new URLSearchParams(String(requests.at(-1)!.init.body)).has("MessagingServiceSid"));

  for (const [code, failure] of [[401, "auth"], [403, "auth"], [429, "provider-rate-limited"], [400, "rejected"], [503, "provider-error"]] as const) {
    status = code;
    assert.deepEqual(await provider.sendSecurityAlert({ to: PHONE, text: SECURITY_SMS_TEXT_TEST }, { timeoutMs: 1_000 }), {
      ok: false,
      failure,
    });
  }
  const offline = new TwilioSecuritySmsProvider(
    { accountSid: ACCOUNT_SID, authToken: AUTH_TOKEN, from: "CampusAg" },
    async () => { throw new TypeError("fetch failed"); },
  );
  assert.deepEqual(await offline.sendSecurityAlert({ to: PHONE, text: SECURITY_SMS_TEXT_TEST }, { timeoutMs: 1_000 }), {
    ok: false,
    failure: "network",
  });
});

test("SQLite — statut définitif et colonnes immuables (trigger)", async () => {
  const { db, store } = await sqlStore();
  const deps = harness({ store }).deps;
  assert.equal((await notifySecurityEvent(deps, criticalRateLimit())).outcome, "sent");
  const row = await db.prepare("SELECT id, status FROM security_notifications").bind().first<{ id: string; status: string }>();
  assert.equal(row?.status, "SENT");
  await assert.rejects(db.prepare("UPDATE security_notifications SET status = 'PENDING' WHERE id = ?").bind(row!.id).run());
  await assert.rejects(db.prepare("UPDATE security_notifications SET deduplication_key = 'x' WHERE id = ?").bind(row!.id).run());
  const raw = JSON.stringify((await db.prepare("SELECT * FROM security_notifications").bind().all()).results);
  assert.doesNotMatch(raw, /791234512|Campus Agenda :|teacher-chf|7F2A1B3C/);
});

test("sauvegarde / restauration — compteurs SMS ni exportés ni remis à zéro", async () => {
  const { db, store } = await sqlStore();
  await seedDemoDatabase(db);
  const { deps } = harness({ store });
  for (let index = 0; index < 3; index += 1) {
    await notifySecurityEvent(deps, criticalRateLimit({ targetId: `teacher-${index}` }));
  }
  const dump = await dumpCampusTables(db);
  assert.ok(!("security_notifications" in dump));
  const validated = validateCampusTables({ ...dump, security_notifications: [] });
  assert.equal(validated.ok, true);
  assert.ok(validated.ok && !("security_notifications" in validated.tables), "clé injectée ignorée");
  await restoreCampusTables(db, validated.ok ? validated.tables : dump);
  assert.equal(await store.countAttempts(new Date(BASE.getTime() - 60_000).toISOString()), 3);
  assert.equal((await notifySecurityEvent(deps, criticalRateLimit({ targetId: "teacher-after-restore" }))).outcome, "suppressed-quota");
});

test("routes et interface — admin seulement, POST confirmé, aucun secret côté navigateur", async () => {
  const statusRoute = await readFile(new URL("../web/app/api/admin/security/sms/route.ts", import.meta.url), "utf8");
  const testRoute = await readFile(new URL("../web/app/api/admin/security/sms/test/route.ts", import.meta.url), "utf8");
  const panel = await readFile(new URL("../web/app/components/security-sms-panel.tsx", import.meta.url), "utf8");
  const admin = await readFile(new URL("../web/app/components/administration-panel.tsx", import.meta.url), "utf8");
  const health = await readFile(new URL("../web/app/api/health/route.ts", import.meta.url), "utf8");
  const glue = await readFile(new URL("../web/lib/server/security-events.ts", import.meta.url), "utf8");
  const env = await readFile(new URL("../.env.example", import.meta.url), "utf8");

  assert.match(statusRoute, /requireAdminSession/);
  assert.match(statusRoute, /securitySmsConfigView/);
  assert.match(statusRoute, /no-store/);
  assert.match(testRoute, /requireAdminSession/);
  assert.match(testRoute, /export const POST/);
  assert.doesNotMatch(testRoute, /export const GET/);
  assert.match(testRoute, /confirm === true/);
  assert.match(testRoute, /checkInMemoryRateLimit/);
  assert.match(glue, /notify: notifySecurityEventInBackground/);
  assert.doesNotMatch(health, /SMS|sms/);

  assert.match(admin, /<SecuritySmsPanel onNotice=\{onNotice\} \/>/);
  assert.match(admin, /sms: SECURITY_SMS_TITLE/);
  assert.match(panel, /SECURITY_SMS_TEST_CONFIRM_TITLE/);
  assert.match(panel, /<ConfirmDialog/);
  assert.match(panel, /method: "POST"/);
  assert.doesNotMatch(panel, /^import \{[^}]*\} from "@campus\/features\/security-notifications\/(config|notifier|twilio-provider)/m);
  for (const source of [panel, smsUi.SECURITY_SMS_SCOPE, smsUi.SECURITY_SMS_DESCRIPTION]) {
    for (const forbidden of smsUi.SECURITY_SMS_FORBIDDEN_CLAIMS) assert.doesNotMatch(source, forbidden);
  }
  assert.equal(smsUi.SECURITY_SMS_TITLE, "Alertes SMS");
  assert.equal(smsUi.SECURITY_SMS_STATE_ACTIVE, "Les alertes SMS critiques sont activées.");
  assert.equal(smsUi.SECURITY_SMS_STATE_INACTIVE, "Les alertes SMS ne sont pas configurées.");
  assert.equal(smsUi.SECURITY_SMS_PRIVACY, "Les SMS ne contiennent aucune donnée pédagogique ni information sensible.");
  assert.equal(smsUi.SECURITY_SMS_TEST_CONFIRM_TITLE, "Envoyer un SMS de test ?");

  assert.deepEqual(
    smsUi.SECURITY_SMS_SETUP_VARIABLES.map((variable) => variable.name),
    Object.values(SECURITY_SMS_ENV),
    "le guide d'activation liste exactement les variables lues par le serveur",
  );
  for (const variable of smsUi.SECURITY_SMS_SETUP_VARIABLES) {
    assert.doesNotMatch(variable.example, /\+\d{6,}|AC[0-9a-f]{8,}|[0-9a-f]{16,}/i, "exemples factices uniquement");
  }
  assert.match(panel, /state !== "active" \? \(\s*<section className="security-sms-setup"/);
  assert.match(smsUi.SECURITY_SMS_SETUP_STEPS.join(" "), /commande de lancement/);
  assert.doesNotMatch(panel, /<input|<form/, "aucune saisie du numéro ou des identifiants dans l'interface");

  for (const name of Object.values(SECURITY_SMS_ENV)) {
    assert.match(env, new RegExp(`^${name}=(false)?$`, "m"), `${name} sans valeur dans .env.example`);
  }
  assert.match(env, /^CAMPUS_SECURITY_SMS_ENABLED=false$/m);
});

test("isolation — aucune variable publique, MFA et sessions intacts", async () => {
  const roots = ["../web/app", "../web/lib", "../src"];
  const offenders: string[] = [];
  async function walk(url: URL) {
    for (const entry of await readdir(url, { withFileTypes: true })) {
      const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, url);
      if (entry.isDirectory()) await walk(child);
      else if (/\.(ts|tsx|mjs)$/.test(entry.name)) {
        const source = await readFile(child, "utf8");
        if (/NEXT_PUBLIC_[A-Z_]*SMS|NEXT_PUBLIC_CAMPUS_SMS/.test(source)) offenders.push(child.pathname);
        if (/features\/admin-mfa|lib\/auth\//.test(child.pathname) && /security-notifications|security-sms/.test(source)) {
          offenders.push(child.pathname);
        }
      }
    }
  }
  for (const root of roots) await walk(new URL(`${root}/`, import.meta.url));
  assert.deepEqual(offenders, []);
  const clientPanels = ["security-sms-panel.tsx", "admin-security-panel.tsx", "mfa-challenge-panel.tsx"];
  for (const file of clientPanels) {
    const source = await readFile(new URL(`../web/app/components/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /CAMPUS_SMS_TWILIO|CAMPUS_SECURITY_SMS_TO|AUTH_TOKEN/, file);
  }
});

test("documentation — objectif, quotas, configuration et limites", async () => {
  const doc = await readFile(new URL("../docs/SECURITY_SMS_ALERTS.md", import.meta.url), "utf8");
  assert.match(doc, /ne garantit pas la détection de toutes les attaques ou fuites de données/);
  assert.match(doc, /30 minutes/);
  assert.match(doc, /3 SMS par heure/);
  assert.match(doc, /10 SMS par 24 heures/);
  for (const name of Object.values(SECURITY_SMS_ENV)) assert.match(doc, new RegExp(name));
  assert.match(doc, /Twilio/);
  assert.doesNotMatch(doc, /\+41\d{9}/);
});
