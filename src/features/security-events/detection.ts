import type { SecurityEventType } from "./catalog.ts";
import type { SecurityEvent, SecurityEventStore } from "./types.ts";

/**
 * Règles d'anomalie volontairement simples et explicables.
 * Chaque règle compte, sur une fenêtre glissante, les occurrences de certains
 * événements pour un même compte et/ou une même source pseudonymisée.
 * Les seuils « source » sont plus hauts : une école partage souvent une IP (NAT).
 */
export interface AnomalyRule {
  id: string;
  anomalyType: SecurityEventType;
  triggers: readonly SecurityEventType[];
  windowMinutes: number;
  /** Compte : `targetId` (cible d'une connexion) sinon `actorId`. */
  accountThreshold: number | null;
  sourceThreshold: number | null;
}

export const ANOMALY_RULES: readonly AnomalyRule[] = [
  {
    id: "teacher-login-failures",
    anomalyType: "ANOMALY_REPEATED_LOGIN_FAILURES",
    triggers: ["TEACHER_LOGIN_FAILED", "TEACHER_LOGIN_ACCOUNT_BLOCKED"],
    windowMinutes: 15,
    accountThreshold: 5,
    sourceThreshold: 10,
  },
  {
    id: "student-login-failures",
    anomalyType: "ANOMALY_REPEATED_STUDENT_LOGIN_FAILURES",
    triggers: ["STUDENT_LOGIN_FAILED"],
    windowMinutes: 15,
    accountThreshold: null,
    sourceThreshold: 30,
  },
  {
    id: "mfa-failures",
    anomalyType: "ANOMALY_REPEATED_MFA_FAILURES",
    triggers: ["MFA_VERIFY_FAILED", "MFA_SENSITIVE_ACTION_DENIED"],
    windowMinutes: 15,
    accountThreshold: 3,
    sourceThreshold: 6,
  },
  {
    id: "admin-access-denied",
    anomalyType: "ANOMALY_REPEATED_ACCESS_DENIED",
    triggers: ["ADMIN_ACCESS_DENIED"],
    windowMinutes: 15,
    accountThreshold: 5,
    sourceThreshold: 10,
  },
];

/** Volume de lectures : compteur mémoire par compte enseignant, voir `read-volume.ts`. */
export const HIGH_READ_VOLUME_WINDOW_MINUTES = 5;
export const HIGH_READ_VOLUME_THRESHOLD = 600;

export interface AnomalyFinding {
  rule: AnomalyRule;
  scope: "account" | "source";
  subjectId: string;
  observedCount: number;
  threshold: number;
}

function accountOf(event: SecurityEvent): string | null {
  return event.targetType === "TEACHER" && event.targetId
    ? event.targetId
    : event.actorType === "TEACHER"
      ? event.actorId
      : null;
}

export function rulesTriggeredBy(eventType: string): AnomalyRule[] {
  return ANOMALY_RULES.filter((rule) => (rule.triggers as readonly string[]).includes(eventType));
}

export async function evaluateAnomalies(
  store: SecurityEventStore,
  event: SecurityEvent,
  now: Date,
): Promise<AnomalyFinding[]> {
  const findings: AnomalyFinding[] = [];
  for (const rule of rulesTriggeredBy(event.eventType)) {
    const since = new Date(now.getTime() - rule.windowMinutes * 60_000).toISOString();
    const account = accountOf(event);
    if (rule.accountThreshold !== null && account) {
      const filter = event.targetType === "TEACHER" && event.targetId
        ? { targetId: account }
        : { actorId: account };
      const observed = await store.sumOccurrences({ eventTypes: rule.triggers, since, ...filter });
      if (observed >= rule.accountThreshold) {
        findings.push({ rule, scope: "account", subjectId: account, observedCount: observed, threshold: rule.accountThreshold });
      }
    }
    if (rule.sourceThreshold !== null && event.sourceFingerprint) {
      const observed = await store.sumOccurrences({
        eventTypes: rule.triggers,
        since,
        sourceFingerprint: event.sourceFingerprint,
      });
      if (observed >= rule.sourceThreshold) {
        findings.push({
          rule,
          scope: "source",
          subjectId: event.sourceFingerprint,
          observedCount: observed,
          threshold: rule.sourceThreshold,
        });
      }
    }
  }
  return findings;
}
