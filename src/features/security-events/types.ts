export const SECURITY_SEVERITIES = ["INFO", "WARNING", "CRITICAL"] as const;
export type SecuritySeverity = (typeof SECURITY_SEVERITIES)[number];

export const SECURITY_ACTOR_TYPES = ["TEACHER", "STUDENT", "ANONYMOUS", "SYSTEM"] as const;
export type SecurityActorType = (typeof SECURITY_ACTOR_TYPES)[number];

export const SECURITY_TARGET_TYPES = ["TEACHER", "SCHOOL_CLASS"] as const;
export type SecurityTargetType = (typeof SECURITY_TARGET_TYPES)[number];

export const SECURITY_CATEGORIES = [
  "AUTH",
  "MFA",
  "RATE_LIMIT",
  "AUTHZ",
  "ADMIN",
  "BACKUP",
  "EXPORT",
  "ANOMALY",
] as const;
export type SecurityCategory = (typeof SECURITY_CATEGORIES)[number];

/** Carte du tableau de bord 24 h à laquelle un événement contribue. */
export type SecuritySummaryBucket =
  | "loginSucceeded"
  | "loginFailed"
  | "blocked"
  | "denied"
  | "sensitive"
  | "alerts";

/** Valeur de métadonnée autorisée : jamais d'objet, jamais de texte libre non contrôlé. */
export type SecurityMetadataValue = string | number | boolean;
export type SecurityMetadata = Record<string, SecurityMetadataValue>;

export interface SecurityEvent {
  id: string;
  /** Première occurrence (UTC ISO 8601). */
  occurredAt: string;
  /** Dernière occurrence agrégée (UTC ISO 8601) ; égale à `occurredAt` sans agrégation. */
  lastSeenAt: string;
  eventType: string;
  category: SecurityCategory;
  severity: SecuritySeverity;
  actorType: SecurityActorType;
  actorId: string | null;
  targetType: SecurityTargetType | null;
  targetId: string | null;
  route: string | null;
  httpMethod: string | null;
  httpStatus: number | null;
  requestId: string | null;
  sourceFingerprint: string | null;
  metadata: SecurityMetadata;
  occurrenceCount: number;
  /** Clé technique d'agrégation (identifiants internes / empreintes uniquement). */
  aggregationKey: string | null;
}

export type NewSecurityEvent = Omit<SecurityEvent, "id" | "lastSeenAt" | "occurrenceCount"> & {
  id?: string;
};

export interface SecurityEventListFilter {
  since: string;
  severity?: SecuritySeverity;
  offset: number;
  limit: number;
}

export interface SecurityEventOccurrenceFilter {
  eventTypes: readonly string[];
  since: string;
  actorId?: string;
  targetId?: string;
  sourceFingerprint?: string;
}

export interface SecurityEventSummaryRow {
  eventType: string;
  severity: SecuritySeverity;
  rows: number;
  occurrences: number;
}

/**
 * Journal opérationnel append-only.
 * Aucune méthode de modification arbitraire ni de suppression unitaire :
 * seuls l'incrément d'un agrégat et la purge de rétention existent.
 */
export interface SecurityEventStore {
  append(event: NewSecurityEvent): Promise<SecurityEvent>;
  /**
   * Agrégat : si une ligne de même `aggregationKey` a été vue depuis `since`,
   * incrémente `occurrenceCount`, met à jour `lastSeenAt` et les métadonnées ;
   * sinon insère une nouvelle ligne.
   */
  appendOrIncrement(event: NewSecurityEvent & { aggregationKey: string }, since: string): Promise<SecurityEvent>;
  sumOccurrences(filter: SecurityEventOccurrenceFilter): Promise<number>;
  list(filter: SecurityEventListFilter): Promise<{ events: SecurityEvent[]; total: number }>;
  summarize(since: string): Promise<SecurityEventSummaryRow[]>;
  /** Purge de rétention uniquement : supprime les lignes dont `lastSeenAt` < cutoff. */
  purgeOlderThan(cutoff: string): Promise<number>;
}

export function isSecuritySeverity(value: unknown): value is SecuritySeverity {
  return typeof value === "string" && (SECURITY_SEVERITIES as readonly string[]).includes(value);
}

export function isSecurityActorType(value: unknown): value is SecurityActorType {
  return typeof value === "string" && (SECURITY_ACTOR_TYPES as readonly string[]).includes(value);
}

export function isSecurityTargetType(value: unknown): value is SecurityTargetType {
  return typeof value === "string" && (SECURITY_TARGET_TYPES as readonly string[]).includes(value);
}

export function isSecurityCategory(value: unknown): value is SecurityCategory {
  return typeof value === "string" && (SECURITY_CATEGORIES as readonly string[]).includes(value);
}
