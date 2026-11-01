import { SECURITY_EVENT_CATALOG, isSecurityEventType } from "./catalog.ts";
import { formatSourceFingerprint } from "./fingerprint.ts";
import { sanitizeSecurityMetadata } from "./metadata.ts";
import type { SecurityCategory, SecurityEvent, SecurityMetadata, SecuritySeverity } from "./types.ts";

/** Vue envoyée au navigateur : jamais la clé d'agrégation ni une empreinte complète. */
export interface SecurityEventView {
  id: string;
  occurredAt: string;
  lastSeenAt: string;
  eventType: string;
  category: SecurityCategory;
  severity: SecuritySeverity;
  label: string;
  actorLabel: string;
  targetLabel: string | null;
  source: string | null;
  route: string | null;
  httpMethod: string | null;
  httpStatus: number | null;
  requestId: string | null;
  occurrenceCount: number;
  metadata: SecurityMetadata;
}

export interface SecurityLabelLookup {
  teacherLabel(teacherId: string): string | null;
}

function intMeta(metadata: SecurityMetadata, key: string): number | null {
  const value = metadata[key];
  return typeof value === "number" ? value : null;
}

function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count > 1 ? pluralForm : singular}`;
}

export function securityEventLabel(event: Pick<SecurityEvent, "eventType" | "metadata" | "occurrenceCount">): string {
  if (!isSecurityEventType(event.eventType)) return "Événement inconnu";
  const base = SECURITY_EVENT_CATALOG[event.eventType].label;
  const observed = intMeta(event.metadata, "observedCount");
  const minutes = intMeta(event.metadata, "windowMinutes");
  const count = event.occurrenceCount;
  switch (event.eventType) {
    case "ANOMALY_REPEATED_LOGIN_FAILURES":
      return observed ? `${plural(observed, "tentative", "tentatives")} de connexion incorrectes` : base;
    case "ANOMALY_REPEATED_STUDENT_LOGIN_FAILURES":
      return observed ? `${plural(observed, "code apprentis incorrect", "codes apprentis incorrects")}` : base;
    case "ANOMALY_REPEATED_MFA_FAILURES":
      return observed ? `${plural(observed, "code MFA incorrect", "codes MFA incorrects")}` : base;
    case "ANOMALY_REPEATED_ACCESS_DENIED":
      return observed ? `${plural(observed, "accès refusé", "accès refusés")} sur des routes sensibles` : base;
    case "ANOMALY_HIGH_READ_VOLUME":
      return observed && minutes ? `${observed} lectures API en ${minutes} minutes` : base;
    case "TEACHER_LOGIN_FAILED":
      return count > 1 ? `${count} tentatives de connexion incorrectes` : base;
    case "MFA_VERIFY_FAILED":
      return count > 1 ? `${count} codes de double authentification incorrects` : base;
    case "RATE_LIMIT_TRIGGERED":
      return event.metadata.scope === "teacher-mfa" ? "Rate limit MFA déclenché" : base;
    default:
      return base;
  }
}

function actorLabel(event: SecurityEvent, lookup: SecurityLabelLookup): string {
  switch (event.actorType) {
    case "TEACHER":
      return event.actorId ? lookup.teacherLabel(event.actorId) ?? event.actorId : "Enseignant";
    case "STUDENT": {
      const prefix = event.metadata.classPrefix;
      return typeof prefix === "string" ? `Apprenti ${prefix}` : "Apprenti";
    }
    case "SYSTEM":
      return "Système (serveur)";
    default:
      return event.targetType === "TEACHER" && event.targetId
        ? `Compte ${lookup.teacherLabel(event.targetId) ?? event.targetId}`
        : typeof event.metadata.classPrefix === "string"
          ? `Classe ${event.metadata.classPrefix}`
          : "Anonyme";
  }
}

function targetLabel(event: SecurityEvent, lookup: SecurityLabelLookup): string | null {
  if (!event.targetId || event.actorType === "ANONYMOUS") return null;
  if (event.targetType === "TEACHER") return lookup.teacherLabel(event.targetId) ?? event.targetId;
  return event.targetId;
}

export function presentSecurityEvent(event: SecurityEvent, lookup: SecurityLabelLookup): SecurityEventView {
  const metadata = isSecurityEventType(event.eventType)
    ? sanitizeSecurityMetadata(event.eventType, event.metadata)
    : {};
  return {
    id: event.id,
    occurredAt: event.occurredAt,
    lastSeenAt: event.lastSeenAt,
    eventType: event.eventType,
    category: event.category,
    severity: event.severity,
    label: securityEventLabel({ ...event, metadata }),
    actorLabel: actorLabel({ ...event, metadata }, lookup),
    targetLabel: targetLabel(event, lookup),
    source: formatSourceFingerprint(event.sourceFingerprint),
    route: event.route,
    httpMethod: event.httpMethod,
    httpStatus: event.httpStatus,
    requestId: event.requestId,
    occurrenceCount: event.occurrenceCount,
    metadata,
  };
}
