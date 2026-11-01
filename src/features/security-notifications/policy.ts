import type { SecurityEventType } from "../security-events/catalog.ts";
import type { SecurityEvent } from "../security-events/types.ts";

/** Délai minimal entre deux SMS pour un même problème (même clé de déduplication). */
export const SECURITY_SMS_COOLDOWN_MINUTES = 30;
/** Plafonds globaux, indépendants du cooldown : un attaquant ne peut pas déclencher des SMS en série. */
export const SECURITY_SMS_MAX_PER_HOUR = 3;
export const SECURITY_SMS_MAX_PER_DAY = 10;
/** SMS de test : au plus un toutes les 10 minutes (persisté, compté dans les plafonds globaux). */
export const SECURITY_SMS_TEST_COOLDOWN_MINUTES = 10;
/** Délai maximal d'un appel au fournisseur. */
export const SECURITY_SMS_TIMEOUT_MS = 5_000;

/**
 * WARNING explicitement sensibles. Un WARNING absent de cette liste ne produit
 * jamais de SMS (pas de règle « severity >= WARNING »).
 */
export const SECURITY_SMS_WARNING_ELIGIBLE_TYPES = [
  "ANOMALY_REPEATED_LOGIN_FAILURES",
  "ANOMALY_REPEATED_MFA_FAILURES",
  "ANOMALY_REPEATED_ACCESS_DENIED",
  "ANOMALY_HIGH_READ_VOLUME",
  "MFA_RECOVERY_CODE_USED",
  "MFA_RESET",
  "MFA_RECONFIGURED",
  "TEACHER_ADMIN_ROLE_GRANTED",
  "BACKUP_RESTORE_SUCCEEDED",
] as const satisfies readonly SecurityEventType[];

/**
 * Types qui ne déclenchent jamais de SMS, quelle que soit leur sévérité.
 * `SECURITY_SMS_TEST_REQUESTED` trace l'envoi d'un SMS : l'exclure évite toute boucle.
 * Les connexions apprentis restent hors SMS : une classe se trompe souvent de code.
 */
export const SECURITY_SMS_NEVER_ELIGIBLE_TYPES = [
  "SECURITY_SMS_TEST_REQUESTED",
  "SECURITY_EMAIL_TEST_REQUESTED",
  "TEACHER_LOGIN_SUCCEEDED",
  "MFA_VERIFY_SUCCEEDED",
  "STUDENT_LOGIN_FAILED",
  "ANOMALY_REPEATED_STUDENT_LOGIN_FAILURES",
  "SESSION_REJECTED",
  "BACKUP_DOWNLOADED",
  "DATA_EXPORTED",
] as const satisfies readonly SecurityEventType[];

export type SecuritySmsDecision =
  | { eligible: false; reason: "never-eligible" | "info" | "warning-not-listed" | "notification-event" }
  | {
      eligible: true;
      level: "WARNING" | "CRITICAL";
      /** Clé logique en clair — hachée avant stockage, jamais transmise au fournisseur. */
      deduplicationKey: string;
      cooldownMinutes: number;
    };

function includes(list: readonly string[], value: string): boolean {
  return list.includes(value);
}

/**
 * Clé du « même problème » :
 * - anomalie par compte : type + compte (la source peut tourner) ;
 * - anomalie par source : type + source ;
 * - autre : type + périmètre éventuel + compte visé / acteur + source.
 */
export function securitySmsDeduplicationKey(event: SecurityEvent): string {
  const scope = typeof event.metadata.scope === "string" ? event.metadata.scope : "-";
  const account = event.targetType === "TEACHER" && event.targetId ? event.targetId : event.actorId;
  if (event.category === "ANOMALY") {
    return scope === "source"
      ? [event.eventType, "source", event.sourceFingerprint ?? "-"].join(":")
      : [event.eventType, "account", account ?? "-"].join(":");
  }
  return [event.eventType, scope, event.actorType, account ?? "-", event.sourceFingerprint ?? "-"].join(":");
}

/** Politique centrale : la seule fonction qui décide si un événement peut produire un SMS. */
export function shouldSendSecuritySms(event: SecurityEvent): SecuritySmsDecision {
  if (event.eventType.startsWith("SECURITY_SMS_")) return { eligible: false, reason: "notification-event" };
  if (includes(SECURITY_SMS_NEVER_ELIGIBLE_TYPES, event.eventType)) return { eligible: false, reason: "never-eligible" };
  if (event.severity === "INFO") return { eligible: false, reason: "info" };
  if (event.severity === "WARNING" && !includes(SECURITY_SMS_WARNING_ELIGIBLE_TYPES, event.eventType)) {
    return { eligible: false, reason: "warning-not-listed" };
  }
  return {
    eligible: true,
    level: event.severity,
    deduplicationKey: securitySmsDeduplicationKey(event),
    cooldownMinutes: SECURITY_SMS_COOLDOWN_MINUTES,
  };
}
