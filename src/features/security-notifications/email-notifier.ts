import { SECURITY_EVENT_RETENTION_DAYS } from "../security-events/retention.ts";
import type { SecurityEvent } from "../security-events/types.ts";
import type { SecurityEmailConfig } from "./email-config.ts";
import {
  formatSecurityAlertEmail,
  formatSecurityTestEmail,
  securityEmailActorLabel,
} from "./email-message.ts";
import {
  SECURITY_EMAIL_TEST_COOLDOWN_MINUTES,
  SECURITY_EMAIL_TIMEOUT_MS,
  shouldSendSecurityEmail,
} from "./email-policy.ts";
import type { SecurityEmailSendResult, SecurityEmailTransport } from "./email-transport.ts";
import type {
  NewSecurityNotification,
  SecurityNotification,
  SecurityNotificationFailureCategory,
  SecurityNotificationKind,
  SecurityNotificationLevel,
  SecurityNotificationStore,
  SecurityNotificationSuppressedStatus,
} from "./types.ts";

export type SecurityEmailLogName =
  | "security_email_sent"
  | "security_email_delivery_failed"
  | "security_email_suppressed_cooldown"
  | "security_email_disabled"
  | "security_email_configuration_invalid";

export type SecurityEmailLogFields = Record<string, string | number | boolean>;

export interface SecurityEmailDeps {
  store: SecurityNotificationStore;
  config: SecurityEmailConfig;
  transport: SecurityEmailTransport | null;
  now?: () => Date;
  timeoutMs?: number;
  teacherInitials?: (teacherId: string) => string | null | Promise<string | null>;
  /** Ne reçoit jamais l'adresse, le mot de passe SMTP, ni le corps du message. */
  log?: (name: SecurityEmailLogName, fields: SecurityEmailLogFields) => void;
}

export type SecurityEmailOutcome =
  | { outcome: "not-eligible" }
  | { outcome: "disabled" }
  | { outcome: "suppressed-cooldown" }
  | { outcome: "sent"; notificationId: string }
  | { outcome: "failed"; failure: SecurityNotificationFailureCategory };

const MINUTE_MS = 60_000;
const DAY_MINUTES = 24 * 60;
const SECURITY_EMAIL_TEST_KEY = "security-email-test";
const PURGE_INTERVAL_MS = 6 * 60 * MINUTE_MS;

function minutesAgo(now: Date, minutes: number): string {
  return new Date(now.getTime() - minutes * MINUTE_MS).toISOString();
}

/** Clé stockée hachée : aucun identifiant de compte ni empreinte de source en clair. */
export async function hashSecurityEmailKey(logicalKey: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`campus-agenda:security-email:v1:${logicalKey}`),
  );
  return [...new Uint8Array(digest)].slice(0, 16).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

let emailReservationChain: Promise<unknown> = Promise.resolve();
function exclusiveEmail<T>(task: () => Promise<T>): Promise<T> {
  const run = emailReservationChain.then(task, task);
  emailReservationChain = run.then(() => undefined, () => undefined);
  return run;
}

let lastPurgeAt = 0;
async function maybePurgeNotifications(store: SecurityNotificationStore, now: Date) {
  if (now.getTime() - lastPurgeAt < PURGE_INTERVAL_MS) return;
  lastPurgeAt = now.getTime();
  await store.purgeOlderThan(minutesAgo(now, SECURITY_EVENT_RETENTION_DAYS * DAY_MINUTES));
}

export function resetSecurityEmailPurgeClock() {
  lastPurgeAt = 0;
}

function withTimeout(promise: Promise<SecurityEmailSendResult>, timeoutMs: number): Promise<SecurityEmailSendResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<SecurityEmailSendResult>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, failure: "timeout" }), timeoutMs);
  });
  return Promise.race([
    promise.catch((): SecurityEmailSendResult => ({ ok: false, failure: "unexpected" })),
    timeout,
  ]).finally(() => clearTimeout(timer));
}

interface DispatchRequest {
  kind: SecurityNotificationKind;
  level: SecurityNotificationLevel;
  deduplicationKey: string;
  cooldownMinutes: number;
  securityEventId: string | null;
  eventType: string | null;
  event?: SecurityEvent;
}

type Reservation =
  | { type: "suppressed"; status: SecurityNotificationSuppressedStatus; row: SecurityNotification }
  | { type: "reserved"; row: SecurityNotification };

function logFields(row: SecurityNotification, extra: SecurityEmailLogFields = {}): SecurityEmailLogFields {
  const fields: SecurityEmailLogFields = {
    notificationId: row.id,
    kind: row.kind,
    level: row.level,
    occurrenceCount: row.occurrenceCount,
    ...extra,
  };
  if (row.eventType) fields.eventType = row.eventType;
  if (row.securityEventId) fields.eventId = row.securityEventId;
  return fields;
}

async function reserve(deps: SecurityEmailDeps, request: DispatchRequest, now: Date): Promise<Reservation> {
  const { store } = deps;
  const base: NewSecurityNotification = {
    securityEventId: request.securityEventId,
    eventType: request.eventType,
    channel: "EMAIL",
    kind: request.kind,
    level: request.level,
    status: "PENDING",
    deduplicationKey: request.deduplicationKey,
    createdAt: now.toISOString(),
  };
  const cooldownSince = minutesAgo(now, request.cooldownMinutes);
  const suppress = async (status: SecurityNotificationSuppressedStatus): Promise<Reservation> => ({
    type: "suppressed",
    status,
    row: await store.recordSuppressed({ ...base, status }, cooldownSince),
  });

  if (deps.config.status !== "enabled" || !deps.transport) return suppress("DISABLED");
  if (await store.lastAttempt(request.deduplicationKey, cooldownSince, "EMAIL")) {
    return suppress("SUPPRESSED_COOLDOWN");
  }
  return { type: "reserved", row: await store.insert(base) };
}

async function resolveActorLabel(deps: SecurityEmailDeps, event: SecurityEvent): Promise<string> {
  let initials: string | null = null;
  if (event.actorType === "TEACHER" && event.actorId) {
    try {
      initials = (await deps.teacherInitials?.(event.actorId)) ?? null;
    } catch {
      initials = null;
    }
  }
  return securityEmailActorLabel(event, initials);
}

async function dispatch(deps: SecurityEmailDeps, request: DispatchRequest): Promise<SecurityEmailOutcome> {
  const now = deps.now?.() ?? new Date();
  const reservation = await exclusiveEmail(() => reserve(deps, request, now));
  if (reservation.type === "suppressed") {
    if (reservation.row.occurrenceCount === 1) {
      const name = reservation.status === "DISABLED" ? "security_email_disabled" : "security_email_suppressed_cooldown";
      deps.log?.(name, logFields(reservation.row));
    }
    if (reservation.status === "DISABLED") return { outcome: "disabled" };
    return { outcome: "suppressed-cooldown" };
  }

  const { row } = reservation;
  const config = deps.config;
  const transport = deps.transport;
  if (config.status !== "enabled" || !transport) return { outcome: "disabled" };

  const content = request.event
    ? formatSecurityAlertEmail(request.event, { actorLabel: await resolveActorLabel(deps, request.event) })
    : formatSecurityTestEmail();
  const timeoutMs = deps.timeoutMs ?? SECURITY_EMAIL_TIMEOUT_MS;
  const result = await withTimeout(
    transport.sendSecurityAlert(
      { to: config.to, from: config.from, subject: content.subject, text: content.text, html: content.html },
      { timeoutMs },
    ),
    timeoutMs,
  );
  const completedAt = (deps.now?.() ?? new Date()).toISOString();
  try {
    if (result.ok) {
      await deps.store.complete(row.id, { status: "SENT", at: completedAt, providerMessageId: result.providerMessageId });
    } else {
      await deps.store.complete(row.id, { status: "FAILED", at: completedAt, failureCategory: result.failure });
    }
  } catch {
    // La réservation PENDING reste comptée dans le cooldown.
  }
  if (result.ok) {
    deps.log?.("security_email_sent", logFields(row, request.event ? { severity: request.event.severity } : {}));
    void maybePurgeNotifications(deps.store, now).catch(() => undefined);
    return { outcome: "sent", notificationId: row.id };
  }
  deps.log?.("security_email_delivery_failed", logFields(row, { failure: result.failure }));
  return { outcome: "failed", failure: result.failure };
}

/**
 * Point d'entrée appelé après l'écriture d'un SecurityEvent. Ne lève jamais :
 * une panne SMTP n'affecte pas la requête d'origine ni l'événement déjà enregistré.
 */
export async function notifySecurityEmail(deps: SecurityEmailDeps, event: SecurityEvent): Promise<SecurityEmailOutcome> {
  try {
    const decision = shouldSendSecurityEmail(event);
    if (!decision.eligible) return { outcome: "not-eligible" };
    return await dispatch(deps, {
      kind: "ALERT",
      level: decision.level,
      deduplicationKey: await hashSecurityEmailKey(decision.deduplicationKey),
      cooldownMinutes: decision.cooldownMinutes,
      securityEventId: event.id,
      eventType: event.eventType,
      event,
    });
  } catch {
    deps.log?.("security_email_delivery_failed", {
      kind: "ALERT",
      eventType: event.eventType,
      failure: "unexpected",
    });
    return { outcome: "failed", failure: "unexpected" };
  }
}

/** E-mail de test administrateur : ne crée pas d'événement CRITICAL. */
export async function sendSecurityEmailTest(deps: SecurityEmailDeps): Promise<SecurityEmailOutcome> {
  try {
    return await dispatch(deps, {
      kind: "TEST",
      level: "TEST",
      deduplicationKey: await hashSecurityEmailKey(SECURITY_EMAIL_TEST_KEY),
      cooldownMinutes: SECURITY_EMAIL_TEST_COOLDOWN_MINUTES,
      securityEventId: null,
      eventType: null,
    });
  } catch {
    deps.log?.("security_email_delivery_failed", { kind: "TEST", failure: "unexpected" });
    return { outcome: "failed", failure: "unexpected" };
  }
}

export interface SecurityEmailActivity {
  lastAlertSentAt: string | null;
  lastTestSentAt: string | null;
  testAvailableAt: string | null;
}

export async function readSecurityEmailActivity(store: SecurityNotificationStore, now: Date): Promise<SecurityEmailActivity> {
  const testKey = await hashSecurityEmailKey(SECURITY_EMAIL_TEST_KEY);
  const [lastAlert, lastTest, lastTestAttempt] = await Promise.all([
    store.latestSent("ALERT", "EMAIL"),
    store.latestSent("TEST", "EMAIL"),
    store.lastAttempt(testKey, minutesAgo(now, SECURITY_EMAIL_TEST_COOLDOWN_MINUTES), "EMAIL"),
  ]);
  return {
    lastAlertSentAt: lastAlert?.sentAt ?? null,
    lastTestSentAt: lastTest?.sentAt ?? null,
    testAvailableAt: lastTestAttempt
      ? new Date(Date.parse(lastTestAttempt.createdAt) + SECURITY_EMAIL_TEST_COOLDOWN_MINUTES * MINUTE_MS).toISOString()
      : null,
  };
}
