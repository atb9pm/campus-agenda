import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  SECURITY_EVENT_CATALOG,
  recordSecurityEvent,
  type SecurityEvent,
  type SecurityEventType,
} from "../src/features/security-events/index.ts";
import { SECURITY_SEVERITY_LABELS } from "../src/features/security-events/ui-text.ts";
import {
  SECURITY_CRITICAL_EMAIL_COOLDOWN_MINUTES,
  SECURITY_EMAIL_CRITICAL_FOLLOW_UP,
  SECURITY_EMAIL_DEFAULT_HOST,
  SECURITY_EMAIL_DISCLAIMER,
  SECURITY_EMAIL_ENV,
  SECURITY_EMAIL_FOLLOW_UP,
  SECURITY_EMAIL_FORBIDDEN_CLAIMS,
  SECURITY_EMAIL_INTRO_CRITICAL,
  SECURITY_EMAIL_INTRO_WARNING,
  SECURITY_EMAIL_SUBJECT_CRITICAL,
  SECURITY_EMAIL_SUBJECT_TEST,
  SECURITY_EMAIL_SUBJECT_WARNING,
  SECURITY_EMAIL_TEST_BODY,
  SECURITY_EMAIL_TIMEOUT_MS,
  SECURITY_WARNING_EMAIL_COOLDOWN_MINUTES,
  createSecurityEmailTransport,
  formatSecurityAlertEmail,
  formatSecurityTestEmail,
  hashSecurityEmailKey,
  isSecurityEmailAddress,
  maskEmailAddress,
  notifySecurityEmail,
  readSecurityEmailConfig,
  securityEmailActorLabel,
  securityEmailConfigView,
  sendSecurityEmailTest,
  shouldSendSecurityEmail,
  type SecurityEmailConfig,
  type SecurityEmailDeps,
  type SecurityEmailMessage,
  type SecurityEmailSendResult,
  type SecurityEmailTransport,
  type SecurityNotificationStore,
} from "../src/features/security-notifications/index.ts";
import * as emailUi from "../src/features/security-notifications/ui-text.ts";
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

const TO = "security@example.ch";
const FROM = "alerts@example.ch";
const SMTP_USER = "security@example.ch";
const SMTP_PASSWORD = "device-password-infomaniak";
const FINGERPRINT = "B4A100000000069B";
const BASE = new Date("2026-11-01T11:36:00.000Z");

const ENABLED_ENV = {
  NODE_ENV: "production",
  [SECURITY_EMAIL_ENV.enabled]: "true",
  [SECURITY_EMAIL_ENV.to]: TO,
  [SECURITY_EMAIL_ENV.from]: FROM,
  [SECURITY_EMAIL_ENV.host]: "mail.infomaniak.com",
  [SECURITY_EMAIL_ENV.port]: "587",
  [SECURITY_EMAIL_ENV.user]: SMTP_USER,
  [SECURITY_EMAIL_ENV.password]: SMTP_PASSWORD,
};
const ENABLED = readSecurityEmailConfig(ENABLED_ENV);

class FakeEmailTransport implements SecurityEmailTransport {
  readonly messages: SecurityEmailMessage[] = [];
  mode: "ok" | "error" | "hang" | "throw" = "ok";

  async sendSecurityAlert(message: SecurityEmailMessage): Promise<SecurityEmailSendResult> {
    this.messages.push({ ...message });
    if (this.mode === "error") return { ok: false, failure: "network" };
    if (this.mode === "throw") throw new Error(`smtp exploded ${SMTP_PASSWORD}`);
    if (this.mode === "hang") return new Promise<SecurityEmailSendResult>(() => undefined);
    return { ok: true, providerMessageId: "<test@campus>" };
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
  deps: SecurityEmailDeps;
  transport: FakeEmailTransport;
  clock: Clock;
  logs: { name: string; fields: Record<string, unknown> }[];
}

function harness(
  options: { config?: SecurityEmailConfig; store?: SecurityNotificationStore; clock?: Clock; timeoutMs?: number } = {},
): Harness {
  const transport = new FakeEmailTransport();
  const clock = options.clock ?? new Clock();
  const logs: Harness["logs"] = [];
  return {
    transport,
    clock,
    logs,
    deps: {
      store: options.store ?? new MemorySecurityNotificationStore(),
      config: options.config ?? ENABLED,
      transport,
      now: clock.now,
      timeoutMs: options.timeoutMs,
      teacherInitials: (id) => (id === "teacher-chf" ? "ChF" : null),
      log: (name, fields) => logs.push({ name, fields }),
    },
  };
}

function securityEvent(type: SecurityEventType, overrides: Partial<SecurityEvent> = {}): SecurityEvent {
  const definition = SECURITY_EVENT_CATALOG[type];
  return {
    id: overrides.id ?? `sev_${type.toLowerCase()}`,
    occurredAt: BASE.toISOString(),
    lastSeenAt: BASE.toISOString(),
    eventType: type,
    category: definition.category,
    severity: definition.severity,
    actorType: "TEACHER",
    actorId: "teacher-chf",
    targetType: "TEACHER",
    targetId: "teacher-chf",
    route: "/api/auth/teacher",
    httpMethod: "POST",
    httpStatus: 429,
    requestId: "req-e2e-security-1",
    sourceFingerprint: FINGERPRINT,
    metadata: {},
    aggregationKey: null,
    occurrenceCount: 1,
    ...overrides,
  };
}

async function sqlStore(path = ":memory:") {
  const db = createNodeSqliteDatabase(path);
  await applyMigrations(db);
  return { db, store: new SqlSecurityNotificationStore(db) };
}

test("migration 0037 — canal EMAIL, hors sauvegarde, sans adresse ni corps", async () => {
  assert.equal(SQL_MIGRATION_FILES.at(-1), "0038_student_daily_visits.sql");
  const sql = await readFile(new URL("../migrations/0037_security_notification_email.sql", import.meta.url), "utf8");
  assert.match(sql, /channel IN \('SMS', 'EMAIL'\)/);
  const schema = sql.replace(/--.*$/gm, "");
  assert.doesNotMatch(schema, /email_to|recipient|body_text|smtp_password|message_html/i);
  assert.ok((CAMPUS_BACKUP_EXCLUDED_OPERATIONAL_TABLES as readonly string[]).includes("security_notifications"));
  assert.ok(!(CAMPUS_BACKUP_INSERT_ORDER as readonly string[]).includes("security_notifications"));
});

test("politique — INFO aucun e-mail, WARNING et CRITICAL un e-mail, badge À surveiller = WARNING", () => {
  assert.equal(SECURITY_SEVERITY_LABELS.WARNING, "À surveiller");
  assert.equal(SECURITY_SEVERITY_LABELS.CRITICAL, "Critique");
  assert.equal(SECURITY_EVENT_CATALOG.RATE_LIMIT_TRIGGERED.severity, "WARNING");
  assert.equal(SECURITY_EVENT_CATALOG.RATE_LIMIT_TRIGGERED.label, "Blocage automatique (trop de tentatives)");
  assert.equal(shouldSendSecurityEmail(securityEvent("TEACHER_LOGIN_SUCCEEDED")).eligible, false);
  assert.equal(shouldSendSecurityEmail(securityEvent("RATE_LIMIT_TRIGGERED")).eligible, true);
  const warning = shouldSendSecurityEmail(securityEvent("RATE_LIMIT_TRIGGERED"));
  assert.ok(warning.eligible);
  if (warning.eligible) {
    assert.equal(warning.level, "WARNING");
    assert.equal(warning.cooldownMinutes, SECURITY_WARNING_EMAIL_COOLDOWN_MINUTES);
  }
  const critical = shouldSendSecurityEmail(securityEvent("BACKUP_RESTORE_FAILED", { severity: "CRITICAL" }));
  assert.ok(critical.eligible);
  if (critical.eligible) {
    assert.equal(critical.level, "CRITICAL");
    assert.equal(critical.cooldownMinutes, SECURITY_CRITICAL_EMAIL_COOLDOWN_MINUTES);
  }
  assert.equal(shouldSendSecurityEmail(securityEvent("SECURITY_EMAIL_TEST_REQUESTED", { severity: "CRITICAL" })).eligible, false);
  assert.equal(shouldSendSecurityEmail(securityEvent("SECURITY_SMS_TEST_REQUESTED", { severity: "CRITICAL" })).eligible, false);
});

test("envoi — INFO silencieux, WARNING et CRITICAL envoyés", async () => {
  const { deps, transport } = harness();
  assert.deepEqual(await notifySecurityEmail(deps, securityEvent("TEACHER_LOGIN_SUCCEEDED")), { outcome: "not-eligible" });
  const warning = await notifySecurityEmail(deps, securityEvent("RATE_LIMIT_TRIGGERED"));
  assert.equal(warning.outcome, "sent");
  const critical = await notifySecurityEmail(deps, securityEvent("BACKUP_RESTORE_FAILED", { severity: "CRITICAL" }));
  assert.equal(critical.outcome, "sent");
  assert.equal(transport.messages.length, 2);
  assert.equal(transport.messages[0]?.subject, SECURITY_EMAIL_SUBJECT_WARNING);
  assert.equal(transport.messages[1]?.subject, SECURITY_EMAIL_SUBJECT_CRITICAL);
});

test("cooldown WARNING 30 min — un seul e-mail, puis un nouveau après expiration", async () => {
  const clock = new Clock();
  const { deps, transport } = harness({ clock });
  const event = securityEvent("RATE_LIMIT_TRIGGERED");
  assert.equal((await notifySecurityEmail(deps, event)).outcome, "sent");
  assert.equal((await notifySecurityEmail(deps, event)).outcome, "suppressed-cooldown");
  clock.advance(SECURITY_WARNING_EMAIL_COOLDOWN_MINUTES - 1);
  assert.equal((await notifySecurityEmail(deps, event)).outcome, "suppressed-cooldown");
  clock.advance(2);
  assert.equal((await notifySecurityEmail(deps, event)).outcome, "sent");
  assert.equal(transport.messages.length, 2);
});

test("cooldown CRITICAL 15 min — un seul e-mail, puis un nouveau après expiration", async () => {
  const clock = new Clock();
  const { deps, transport } = harness({ clock });
  const event = securityEvent("BACKUP_RESTORE_FAILED", { severity: "CRITICAL" });
  assert.equal((await notifySecurityEmail(deps, event)).outcome, "sent");
  assert.equal((await notifySecurityEmail(deps, event)).outcome, "suppressed-cooldown");
  clock.advance(SECURITY_CRITICAL_EMAIL_COOLDOWN_MINUTES - 1);
  assert.equal((await notifySecurityEmail(deps, event)).outcome, "suppressed-cooldown");
  clock.advance(2);
  assert.equal((await notifySecurityEmail(deps, event)).outcome, "sent");
  assert.equal(transport.messages.length, 2);
});

test("WARNING puis CRITICAL — le CRITICAL n'est pas retenu par le cooldown WARNING", async () => {
  const { deps, transport } = harness();
  assert.equal((await notifySecurityEmail(deps, securityEvent("ANOMALY_REPEATED_LOGIN_FAILURES"))).outcome, "sent");
  assert.equal(
    (await notifySecurityEmail(deps, securityEvent("BACKUP_RESTORE_FAILED", { severity: "CRITICAL" }))).outcome,
    "sent",
  );
  assert.equal(transport.messages.length, 2);
});

test("deux WARNING de types distincts — deux e-mails", async () => {
  const { deps, transport } = harness();
  assert.equal((await notifySecurityEmail(deps, securityEvent("ANOMALY_REPEATED_LOGIN_FAILURES"))).outcome, "sent");
  assert.equal((await notifySecurityEmail(deps, securityEvent("MFA_RECOVERY_CODE_USED"))).outcome, "sent");
  assert.equal(transport.messages.length, 2);
});

test("redémarrage SQLite — le cooldown survit", async () => {
  const dir = await mkdtemp(join(tmpdir(), "campus-email-"));
  const path = join(dir, "campus.sqlite");
  const clock = new Clock();
  try {
    const first = await sqlStore(path);
    const before = harness({ store: first.store, clock });
    const event = securityEvent("RATE_LIMIT_TRIGGERED");
    assert.equal((await notifySecurityEmail(before.deps, event)).outcome, "sent");
    first.db.close();
    const reopened = await sqlStore(path);
    const after = harness({ store: reopened.store, clock });
    assert.equal((await notifySecurityEmail(after.deps, event)).outcome, "suppressed-cooldown");
    assert.equal(after.transport.messages.length, 0);
    reopened.db.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("panne SMTP — l'événement reste, l'application continue", async () => {
  const events = new MemorySecurityEventStore();
  const { deps, transport, logs } = harness();
  transport.mode = "error";
  const pending: Promise<unknown>[] = [];
  const saved = await recordSecurityEvent(
    { store: events, notify: (event) => pending.push(notifySecurityEmail(deps, event)) },
    { type: "RATE_LIMIT_TRIGGERED", actorType: "TEACHER", actorId: "teacher-chf" },
  );
  assert.ok(saved, "SecurityEvent créé avant toute tentative SMTP");
  const [result] = await Promise.all(pending);
  assert.deepEqual(result, { outcome: "failed", failure: "network" });
  assert.equal((await events.list({ since: "2000-01-01T00:00:00.000Z", offset: 0, limit: 10 })).total, 1);
  transport.mode = "throw";
  const thrown = await notifySecurityEmail(deps, securityEvent("MFA_RESET", { id: "sev_reset" }));
  assert.equal(thrown.outcome, "failed");
  assert.ok(logs.some((entry) => entry.name === "security_email_delivery_failed"));
  assert.doesNotMatch(JSON.stringify(logs), new RegExp(SMTP_PASSWORD));
});

test("timeout SMTP — pas de blocage", async () => {
  const { deps, transport } = harness({ timeoutMs: 50 });
  transport.mode = "hang";
  const started = Date.now();
  const result = await notifySecurityEmail(deps, securityEvent("RATE_LIMIT_TRIGGERED"));
  assert.deepEqual(result, { outcome: "failed", failure: "timeout" });
  assert.ok(Date.now() - started < 2_000);
  assert.equal(SECURITY_EMAIL_TIMEOUT_MS, 5_000);
});

test("désactivé ou incomplet — aucun envoi, aucun crash", async () => {
  const disabled = readSecurityEmailConfig({ NODE_ENV: "production" });
  const { deps, transport } = harness({ config: disabled });
  assert.deepEqual(await notifySecurityEmail(deps, securityEvent("RATE_LIMIT_TRIGGERED")), { outcome: "disabled" });
  assert.equal(transport.messages.length, 0);
  assert.deepEqual(readSecurityEmailConfig({}), { status: "disabled", reason: "not-enabled" });
  const incomplete = readSecurityEmailConfig({
    NODE_ENV: "production",
    [SECURITY_EMAIL_ENV.enabled]: "true",
  });
  assert.equal(incomplete.status, "misconfigured");
  if (incomplete.status === "misconfigured") {
    assert.ok(incomplete.invalid.includes(SECURITY_EMAIL_ENV.to));
    assert.ok(incomplete.invalid.includes(SECURITY_EMAIL_ENV.password));
  }
  assert.equal(createSecurityEmailTransport(incomplete), null);
  assert.equal(readSecurityEmailConfig({ ...ENABLED_ENV, NODE_ENV: "test" }).status, "disabled");
  assert.equal(SECURITY_EMAIL_DEFAULT_HOST, "mail.infomaniak.com");
});

test("contenu — WARNING / CRITICAL, source masquée, initiales, Zurich, sans secret", () => {
  const warning = formatSecurityAlertEmail(securityEvent("RATE_LIMIT_TRIGGERED"), { actorLabel: "ChF" });
  assert.equal(warning.subject, SECURITY_EMAIL_SUBJECT_WARNING);
  assert.match(warning.text, new RegExp(SECURITY_EMAIL_INTRO_WARNING));
  assert.match(warning.text, /Niveau : À surveiller/);
  assert.match(warning.text, /Événement : Blocage automatique \(trop de tentatives\)/);
  assert.match(warning.text, /01\.11\.2026/);
  assert.match(warning.text, /12:36|12\.36/);
  assert.match(warning.text, /Compte\/acteur : ChF/);
  assert.match(warning.text, /Source : B4A1…069B/);
  assert.match(warning.text, /Route : POST \/api\/auth\/teacher/);
  assert.match(warning.text, /Statut HTTP : 429/);
  assert.match(warning.text, /Référence : req-e2e-security-1/);
  assert.doesNotMatch(warning.text, /Occurrences :/);
  assert.match(warning.text, new RegExp(SECURITY_EMAIL_FOLLOW_UP));
  assert.match(warning.text, new RegExp(SECURITY_EMAIL_DISCLAIMER));
  assert.match(warning.html, /<p>/);
  assert.doesNotMatch(warning.html, /<script|http:\/\/|cid:/i);

  const many = formatSecurityAlertEmail(
    securityEvent("RATE_LIMIT_TRIGGERED", { occurrenceCount: 5 }),
    { actorLabel: "ChF" },
  );
  assert.match(many.text, /Occurrences : 5/);

  const critical = formatSecurityAlertEmail(
    securityEvent("BACKUP_RESTORE_FAILED", { severity: "CRITICAL", actorType: "ANONYMOUS", actorId: null }),
    { actorLabel: securityEmailActorLabel(securityEvent("BACKUP_RESTORE_FAILED", { actorType: "ANONYMOUS", actorId: null }), null) },
  );
  assert.equal(critical.subject, SECURITY_EMAIL_SUBJECT_CRITICAL);
  assert.match(critical.text, new RegExp(SECURITY_EMAIL_INTRO_CRITICAL));
  assert.match(critical.text, /Niveau : Critique/);
  assert.match(critical.text, /Compte\/acteur : Anonyme/);
  assert.match(critical.text, new RegExp(SECURITY_EMAIL_CRITICAL_FOLLOW_UP));

  assert.equal(securityEmailActorLabel(securityEvent("RATE_LIMIT_TRIGGERED", { actorId: "teacher-unknown" }), null), "Non identifié");
  const testMail = formatSecurityTestEmail();
  assert.equal(testMail.subject, SECURITY_EMAIL_SUBJECT_TEST);
  assert.equal(testMail.text, SECURITY_EMAIL_TEST_BODY);

  const forbidden = `${warning.text}\n${critical.text}\n${testMail.text}`;
  for (const claim of SECURITY_EMAIL_FORBIDDEN_CLAIMS) assert.doesNotMatch(forbidden, claim);
  assert.doesNotMatch(forbidden, /campus-demo|TOTP|recovery|AUTH_SECRET|198\.51\.100|Set-Cookie|devoir|contrôle/i);
});

test("logs et masquage — jamais le mot de passe SMTP ni l'adresse complète", async () => {
  const { deps, logs } = harness();
  await notifySecurityEmail(deps, securityEvent("RATE_LIMIT_TRIGGERED"));
  const serialized = JSON.stringify(logs);
  assert.doesNotMatch(serialized, new RegExp(SMTP_PASSWORD));
  assert.doesNotMatch(serialized, /security@example\.ch/);
  assert.doesNotMatch(serialized, /B4A1069B7F2A1C4D/);
  assert.equal(maskEmailAddress(TO), "se••••@example.ch");
  assert.ok(isSecurityEmailAddress(TO));
  assert.equal(isSecurityEmailAddress("pas-un-email"), false);
  assert.equal(securityEmailConfigView(ENABLED).destination, "se••••@example.ch");
  assert.ok(logs.some((entry) => entry.name === "security_email_sent"));
});

test("anti-abus — 100 WARNING identiques : un seul envoi", async () => {
  const { deps, transport } = harness();
  const event = securityEvent("RATE_LIMIT_TRIGGERED");
  const results = await Promise.all(Array.from({ length: 100 }, () => notifySecurityEmail(deps, event)));
  assert.equal(results.filter((entry) => entry.outcome === "sent").length, 1);
  assert.equal(transport.messages.length, 1);
});

test("e-mail de test — pas d'événement CRITICAL artificiel", async () => {
  const { deps, transport } = harness();
  assert.equal((await sendSecurityEmailTest(deps)).outcome, "sent");
  assert.equal((await sendSecurityEmailTest(deps)).outcome, "suppressed-cooldown");
  assert.equal(transport.messages[0]?.subject, SECURITY_EMAIL_SUBJECT_TEST);
  assert.equal(transport.messages[0]?.text, SECURITY_EMAIL_TEST_BODY);
});

test("sauvegarde / restauration — compteurs e-mail ni exportés ni remis à zéro", async () => {
  const { db, store } = await sqlStore();
  await seedDemoDatabase(db);
  const { deps } = harness({ store });
  await notifySecurityEmail(deps, securityEvent("RATE_LIMIT_TRIGGERED"));
  const dump = await dumpCampusTables(db);
  assert.ok(!("security_notifications" in dump));
  const validated = validateCampusTables({ ...dump, security_notifications: [] });
  assert.equal(validated.ok, true);
  assert.ok(validated.ok && !("security_notifications" in validated.tables), "clé injectée ignorée");
  await restoreCampusTables(db, validated.ok ? validated.tables : dump);
  assert.equal((await notifySecurityEmail(deps, securityEvent("RATE_LIMIT_TRIGGERED"))).outcome, "suppressed-cooldown");
  db.close();
});

test("canaux indépendants — un e-mail n'épuise pas le quota SMS", async () => {
  const store = new MemorySecurityNotificationStore();
  const { deps } = harness({ store });
  await notifySecurityEmail(deps, securityEvent("RATE_LIMIT_TRIGGERED"));
  assert.equal(await store.countAttempts(new Date(BASE.getTime() - 60_000).toISOString(), "SMS"), 0);
  assert.equal(await store.countAttempts(new Date(BASE.getTime() - 60_000).toISOString(), "EMAIL"), 1);
  const hashed = await hashSecurityEmailKey("x");
  assert.equal(hashed.length, 32);
  assert.doesNotMatch(hashed, /teacher/);
});

test("routes et interface — admin seulement, destinataire imposé, pas de Twilio", async () => {
  const statusRoute = await readFile(new URL("../web/app/api/admin/security/email/route.ts", import.meta.url), "utf8");
  const testRoute = await readFile(new URL("../web/app/api/admin/security/email/test/route.ts", import.meta.url), "utf8");
  const card = await readFile(new URL("../web/app/components/security-email-status.tsx", import.meta.url), "utf8");
  const activity = await readFile(new URL("../web/app/components/security-activity-panel.tsx", import.meta.url), "utf8");
  const protection = await readFile(new URL("../web/app/components/admin-security-panel.tsx", import.meta.url), "utf8");
  const glue = await readFile(new URL("../web/lib/server/security-notifications.ts", import.meta.url), "utf8");
  const health = await readFile(new URL("../web/app/api/health/route.ts", import.meta.url), "utf8");
  const env = await readFile(new URL("../.env.example", import.meta.url), "utf8");
  const smtp = await readFile(new URL("../src/features/security-notifications/smtp-transport.ts", import.meta.url), "utf8");

  assert.match(statusRoute, /requireAdminSession/);
  assert.match(testRoute, /requireAdminSession/);
  assert.match(testRoute, /export const POST/);
  assert.doesNotMatch(testRoute, /export const GET/);
  assert.match(testRoute, /confirm === true/);
  assert.match(testRoute, /checkInMemoryRateLimit/);
  assert.doesNotMatch(testRoute, /request\.json\(\)[\s\S]*to\b/);
  assert.match(glue, /dispatchSecurityEmail/);
  assert.match(glue, /notifySecurityEvent/);
  assert.doesNotMatch(health, /SMTP|EMAIL_TO|smtp/);
  assert.match(activity, /<SecurityEmailStatus/);
  assert.match(protection, /<SecurityEmailStatus/);
  assert.match(card, /SECURITY_EMAIL_TEST_CONFIRM_TITLE/);
  assert.doesNotMatch(card, /<input|<form/);
  assert.doesNotMatch(smtp, /twilio/i);
  assert.match(smtp, /requireTLS/);
  assert.match(smtp, /nodemailer/);
  assert.equal(emailUi.SECURITY_EMAIL_TITLE, "Alertes e-mail");
  assert.equal(emailUi.SECURITY_EMAIL_STATE_ACTIVE, "Alertes activées pour À surveiller et Critique.");
  assert.equal(emailUi.SECURITY_EMAIL_STATE_INACTIVE, "Alertes e-mail désactivées.");
  for (const name of Object.values(SECURITY_EMAIL_ENV)) {
    assert.match(env, new RegExp(`^${name}=(false)?$`, "m"), name);
  }
  assert.match(env, /^CAMPUS_SECURITY_EMAIL_ENABLED=false$/m);
});

test("isolation — aucune variable publique, MFA intact, pas de Twilio dans le canal e-mail", async () => {
  const roots = ["../web/app/api/admin/security/email", "../src/features/security-notifications"];
  const offenders: string[] = [];
  async function walk(url: URL) {
    for (const entry of await readdir(url, { withFileTypes: true })) {
      const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, url);
      if (entry.isDirectory()) await walk(child);
      else if (/\.(ts|tsx)$/.test(entry.name) && /email|smtp/.test(entry.name)) {
        const source = await readFile(child, "utf8");
        if (/NEXT_PUBLIC_[A-Z0-9_]+/.test(source)) offenders.push(child.pathname);
        if (/\btwilio\b/i.test(source)) offenders.push(child.pathname);
      }
    }
  }
  for (const root of roots) await walk(new URL(`${root}/`, import.meta.url));
  assert.deepEqual(offenders, []);
});

test("documentation — politique, SMTP, cooldown et canal SMS futur", async () => {
  const doc = await readFile(new URL("../docs/SECURITY_EMAIL_ALERTS.md", import.meta.url), "utf8");
  assert.match(doc, /ne signifie pas nécessairement qu'une intrusion ou une fuite de données a eu lieu/);
  assert.match(doc, /30 minutes/);
  assert.match(doc, /15 minutes/);
  assert.match(doc, /mail\.infomaniak\.com/);
  assert.match(doc, /STARTTLS/);
  assert.match(doc, /Nodemailer|nodemailer/);
  for (const name of Object.values(SECURITY_EMAIL_ENV)) assert.match(doc, new RegExp(name));
  assert.match(doc, /canal SMS|SMS plus/);
  assert.doesNotMatch(doc, /security@campusagenda|CHANGE_ME|device-password/);
});
