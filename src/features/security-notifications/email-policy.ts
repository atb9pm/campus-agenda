import type { SecurityEvent } from "../security-events/types.ts";

/** Premier WARNING : e-mail immédiat. Même problème : pas de nouvel e-mail pendant 30 min. */
export const SECURITY_WARNING_EMAIL_COOLDOWN_MINUTES = 30;
/** CRITICAL : rappel plus rapide si l'activité continue (indépendant du cooldown WARNING). */
export const SECURITY_CRITICAL_EMAIL_COOLDOWN_MINUTES = 15;
/** E-mail de test administrateur. */
export const SECURITY_EMAIL_TEST_COOLDOWN_MINUTES = 10;
/** Délai maximal d'un envoi SMTP. */
export const SECURITY_EMAIL_TIMEOUT_MS = 5_000;

export type SecurityEmailDecision =
  | { eligible: false; reason: "info" | "notification-event" }
  | {
      eligible: true;
      level: "WARNING" | "CRITICAL";
      /** Clé logique en clair — hachée avant stockage, jamais mise dans l'e-mail. */
      deduplicationKey: string;
      cooldownMinutes: number;
    };

/**
 * Clé du « même problème » : type + sévérité + compte + source.
 * Deux types distincts, ou un WARNING puis un CRITICAL, restent indépendants.
 */
export function securityEmailDeduplicationKey(event: SecurityEvent): string {
  const account = event.targetType === "TEACHER" && event.targetId ? event.targetId : event.actorId;
  return [event.eventType, event.severity, account ?? "-", event.sourceFingerprint ?? "-"].join(":");
}

/**
 * Politique e-mail : la sévérité du SecurityEvent est la source de vérité.
 * INFO → aucun e-mail. WARNING et CRITICAL → e-mail (sous cooldown).
 * Les événements de notification (`SECURITY_EMAIL_*`, `SECURITY_SMS_*`) sont exclus
 * pour éviter toute boucle.
 */
export function shouldSendSecurityEmail(event: SecurityEvent): SecurityEmailDecision {
  if (event.eventType.startsWith("SECURITY_EMAIL_") || event.eventType.startsWith("SECURITY_SMS_")) {
    return { eligible: false, reason: "notification-event" };
  }
  if (event.severity === "INFO") return { eligible: false, reason: "info" };
  return {
    eligible: true,
    level: event.severity,
    deduplicationKey: securityEmailDeduplicationKey(event),
    cooldownMinutes:
      event.severity === "CRITICAL"
        ? SECURITY_CRITICAL_EMAIL_COOLDOWN_MINUTES
        : SECURITY_WARNING_EMAIL_COOLDOWN_MINUTES,
  };
}
