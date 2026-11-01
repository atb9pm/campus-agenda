import { SECURITY_EVENT_RETENTION_DAYS } from "../security-events/retention.ts";
import type { SecurityEvent } from "../security-events/types.ts";
import {
  SECURITY_SMS_MAX_PER_DAY,
  SECURITY_SMS_MAX_PER_HOUR,
  SECURITY_SMS_TEST_COOLDOWN_MINUTES,
  SECURITY_SMS_TIMEOUT_MS,
  shouldSendSecuritySms,
} from "./policy.ts";
import type { SecuritySmsConfig } from "./config.ts";
import type { SecuritySmsProvider, SecuritySmsSendResult } from "./provider.ts";
import { securitySmsText } from "./sms-message.ts";
import type {
  NewSecurityNotification,
  SecurityNotification,
  SecurityNotificationKind,
  SecurityNotificationLevel,
  SecurityNotificationStore,
  SecurityNotificationSuppressedStatus,
  SecuritySmsFailureCategory,
} from "./types.ts";

export type SecuritySmsLogName =
  | "security_sms_sent"
  | "security_sms_failed"
  | "security_sms_suppressed_cooldown"
  | "security_sms_suppressed_quota"
  | "security_sms_disabled";

export type SecuritySmsLogFields = Record<string, string | number | boolean>;

export interface SecuritySmsDeps {
  store: SecurityNotificationStore;
  config: SecuritySmsConfig;
  provider: SecuritySmsProvider | null;
  now?: () => Date;
  timeoutMs?: number;
  /** Ne reçoit jamais le numéro, le texte, la clé de déduplication ni une réponse fournisseur. */
  log?: (name: SecuritySmsLogName, fields: SecuritySmsLogFields) => void;
}

export type SecuritySmsOutcome =
  | { outcome: "not-eligible" }
  | { outcome: "disabled" }
  | { outcome: "suppressed-cooldown" }
  | { outcome: "suppressed-quota" }
  | { outcome: "sent"; notificationId: string }
  | { outcome: "failed"; failure: SecuritySmsFailureCategory };

const MINUTE_MS = 60_000;
const DAY_MINUTES = 24 * 60;
const SECURITY_SMS_TEST_KEY = "security-sms-test";
const PURGE_INTERVAL_MS = 6 * 60 * MINUTE_MS;

function minutesAgo(now: Date, minutes: number): string {
  return new Date(now.getTime() - minutes * MINUTE_MS).toISOString();
}

/** Clé stockée hachée : aucun identifiant de compte ni empreinte de source en clair. */
export async function hashSecuritySmsKey(logicalKey: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`campus-agenda:security-sms:v1:${logicalKey}`));
  return [...new Uint8Array(digest)].slice(0, 16).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Décision + réservation sérialisées dans le processus : deux événements
 * simultanés ne peuvent pas franchir ensemble le cooldown ou les plafonds.
 */
let reservationChain: Promise<unknown> = Promise.resolve();
function exclusive<T>(task: () => Promise<T>): Promise<T> {
  const run = reservationChain.then(task, task);
  reservationChain = run.then(() => undefined, () => undefined);
  return run;
}

let lastPurgeAt = 0;
async function maybePurgeNotifications(store: SecurityNotificationStore, now: Date) {
  if (now.getTime() - lastPurgeAt < PURGE_INTERVAL_MS) return;
  lastPurgeAt = now.getTime();
  await store.purgeOlderThan(minutesAgo(now, SECURITY_EVENT_RETENTION_DAYS * DAY_MINUTES));
}

export function resetSecuritySmsPurgeClock() {
  lastPurgeAt = 0;
}

function withTimeout(promise: Promise<SecuritySmsSendResult>, timeoutMs: number): Promise<SecuritySmsSendResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<SecuritySmsSendResult>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, failure: "timeout" }), timeoutMs);
  });
  return Promise.race([
    promise.catch((): SecuritySmsSendResult => ({ ok: false, failure: "unexpected" })),
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
}

type Reservation =
  | { type: "suppressed"; status: SecurityNotificationSuppressedStatus; row: SecurityNotification }
  | { type: "reserved"; row: SecurityNotification };

const SUPPRESSED_OUTCOME: Record<SecurityNotificationSuppressedStatus, SecuritySmsOutcome> = {
  DISABLED: { outcome: "disabled" },
  SUPPRESSED_COOLDOWN: { outcome: "suppressed-cooldown" },
  SUPPRESSED_RATE_LIMIT: { outcome: "suppressed-quota" },
};

const SUPPRESSED_LOG: Record<SecurityNotificationSuppressedStatus, SecuritySmsLogName> = {
  DISABLED: "security_sms_disabled",
  SUPPRESSED_COOLDOWN: "security_sms_suppressed_cooldown",
  SUPPRESSED_RATE_LIMIT: "security_sms_suppressed_quota",
};

function logFields(row: SecurityNotification): SecuritySmsLogFields {
  const fields: SecuritySmsLogFields = {
    notificationId: row.id,
    kind: row.kind,
    level: row.level,
    occurrenceCount: row.occurrenceCount,
  };
  if (row.eventType) fields.eventType = row.eventType;
  if (row.securityEventId) fields.securityEventId = row.securityEventId;
  return fields;
}

async function reserve(deps: SecuritySmsDeps, request: DispatchRequest, now: Date): Promise<Reservation> {
  const { store } = deps;
  const base: NewSecurityNotification = {
    securityEventId: request.securityEventId,
    eventType: request.eventType,
    channel: "SMS",
    kind: request.kind,
    level: request.level,
    status: "PENDING",
    deduplicationKey: request.deduplicationKey,
    createdAt: now.toISOString(),
  };
  const cooldownSince = minutesAgo(now, request.cooldownMinutes);
  const suppress = async (status: SecurityNotificationSuppressedStatus, since: string): Promise<Reservation> => ({
    type: "suppressed",
    status,
    row: await store.recordSuppressed({ ...base, status }, since),
  });

  if (deps.config.status !== "enabled" || !deps.provider) return suppress("DISABLED", cooldownSince);
  if (await store.lastAttempt(request.deduplicationKey, cooldownSince)) return suppress("SUPPRESSED_COOLDOWN", cooldownSince);
  const lastHour = await store.countAttempts(minutesAgo(now, 60));
  const lastDay = await store.countAttempts(minutesAgo(now, DAY_MINUTES));
  if (lastHour >= SECURITY_SMS_MAX_PER_HOUR || lastDay >= SECURITY_SMS_MAX_PER_DAY) {
    return suppress("SUPPRESSED_RATE_LIMIT", minutesAgo(now, 60));
  }
  return { type: "reserved", row: await store.insert(base) };
}

async function dispatch(deps: SecuritySmsDeps, request: DispatchRequest): Promise<SecuritySmsOutcome> {
  const now = deps.now?.() ?? new Date();
  const reservation = await exclusive(() => reserve(deps, request, now));
  if (reservation.type === "suppressed") {
    if (reservation.row.occurrenceCount === 1) deps.log?.(SUPPRESSED_LOG[reservation.status], logFields(reservation.row));
    return SUPPRESSED_OUTCOME[reservation.status];
  }

  const { row } = reservation;
  const config = deps.config;
  const provider = deps.provider;
  if (config.status !== "enabled" || !provider) return { outcome: "disabled" };
  const timeoutMs = deps.timeoutMs ?? SECURITY_SMS_TIMEOUT_MS;
  // Une seule tentative : pas de file ni de nouvel essai automatique.
  const result = await withTimeout(
    provider.sendSecurityAlert({ to: config.to, text: securitySmsText(request.level) }, { timeoutMs }),
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
    // La réservation PENDING reste comptée dans les plafonds : c'est le comportement sûr.
  }
  if (result.ok) {
    deps.log?.("security_sms_sent", logFields(row));
    void maybePurgeNotifications(deps.store, now).catch(() => undefined);
    return { outcome: "sent", notificationId: row.id };
  }
  deps.log?.("security_sms_failed", { ...logFields(row), failureCategory: result.failure });
  return { outcome: "failed", failure: result.failure };
}

/**
 * Point d'entrée appelé après l'écriture d'un SecurityEvent. Ne lève jamais :
 * une panne du stockage ou du fournisseur n'affecte pas la requête d'origine.
 */
export async function notifySecurityEvent(deps: SecuritySmsDeps, event: SecurityEvent): Promise<SecuritySmsOutcome> {
  try {
    const decision = shouldSendSecuritySms(event);
    if (!decision.eligible) return { outcome: "not-eligible" };
    return await dispatch(deps, {
      kind: "ALERT",
      level: decision.level,
      deduplicationKey: await hashSecuritySmsKey(decision.deduplicationKey),
      cooldownMinutes: decision.cooldownMinutes,
      securityEventId: event.id,
      eventType: event.eventType,
    });
  } catch {
    deps.log?.("security_sms_failed", { kind: "ALERT", eventType: event.eventType, failureCategory: "unexpected" });
    return { outcome: "failed", failure: "unexpected" };
  }
}

/** SMS de test administrateur : cooldown persistant de 10 minutes, compté dans les plafonds globaux. */
export async function sendSecuritySmsTest(deps: SecuritySmsDeps): Promise<SecuritySmsOutcome> {
  try {
    return await dispatch(deps, {
      kind: "TEST",
      level: "TEST",
      deduplicationKey: await hashSecuritySmsKey(SECURITY_SMS_TEST_KEY),
      cooldownMinutes: SECURITY_SMS_TEST_COOLDOWN_MINUTES,
      securityEventId: null,
      eventType: null,
    });
  } catch {
    deps.log?.("security_sms_failed", { kind: "TEST", failureCategory: "unexpected" });
    return { outcome: "failed", failure: "unexpected" };
  }
}

export interface SecuritySmsActivity {
  lastAlertSentAt: string | null;
  lastTestSentAt: string | null;
  testAvailableAt: string | null;
  last24h: { sent: number; failed: number; suppressed: number };
}

export async function readSecuritySmsActivity(store: SecurityNotificationStore, now: Date): Promise<SecuritySmsActivity> {
  const testKey = await hashSecuritySmsKey(SECURITY_SMS_TEST_KEY);
  const [lastAlert, lastTest, lastTestAttempt, counts] = await Promise.all([
    store.latestSent("ALERT"),
    store.latestSent("TEST"),
    store.lastAttempt(testKey, minutesAgo(now, SECURITY_SMS_TEST_COOLDOWN_MINUTES)),
    store.countByStatus(minutesAgo(now, DAY_MINUTES)),
  ]);
  const last24h = { sent: 0, failed: 0, suppressed: 0 };
  for (const entry of counts) {
    if (entry.status === "SENT") last24h.sent += entry.rows;
    else if (entry.status === "FAILED") last24h.failed += entry.rows;
    else if (entry.status === "SUPPRESSED_COOLDOWN" || entry.status === "SUPPRESSED_RATE_LIMIT") {
      last24h.suppressed += entry.occurrences;
    }
  }
  return {
    lastAlertSentAt: lastAlert?.sentAt ?? null,
    lastTestSentAt: lastTest?.sentAt ?? null,
    testAvailableAt: lastTestAttempt
      ? new Date(Date.parse(lastTestAttempt.createdAt) + SECURITY_SMS_TEST_COOLDOWN_MINUTES * MINUTE_MS).toISOString()
      : null,
    last24h,
  };
}
