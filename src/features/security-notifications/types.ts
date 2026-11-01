export const SECURITY_NOTIFICATION_CHANNELS = ["SMS", "EMAIL"] as const;
export type SecurityNotificationChannel = (typeof SECURITY_NOTIFICATION_CHANNELS)[number];

export const SECURITY_NOTIFICATION_KINDS = ["ALERT", "TEST"] as const;
export type SecurityNotificationKind = (typeof SECURITY_NOTIFICATION_KINDS)[number];

export const SECURITY_NOTIFICATION_LEVELS = ["WARNING", "CRITICAL", "TEST"] as const;
export type SecurityNotificationLevel = (typeof SECURITY_NOTIFICATION_LEVELS)[number];

/**
 * `PENDING` : envoi réservé (compte déjà dans les quotas) puis remplacé par
 * `SENT` ou `FAILED`. Les statuts `SUPPRESSED_*` et `DISABLED` expliquent
 * pourquoi un événement éligible n'a pas produit de notification.
 */
export const SECURITY_NOTIFICATION_STATUSES = [
  "PENDING",
  "SENT",
  "FAILED",
  "SUPPRESSED_COOLDOWN",
  "SUPPRESSED_RATE_LIMIT",
  "DISABLED",
] as const;
export type SecurityNotificationStatus = (typeof SECURITY_NOTIFICATION_STATUSES)[number];

/** Statuts qui comptent comme une tentative d'envoi (cooldown et quotas). */
export const SECURITY_NOTIFICATION_ATTEMPT_STATUSES = ["PENDING", "SENT", "FAILED"] as const satisfies readonly SecurityNotificationStatus[];

export type SecurityNotificationSuppressedStatus = "SUPPRESSED_COOLDOWN" | "SUPPRESSED_RATE_LIMIT" | "DISABLED";

export const SECURITY_SMS_FAILURE_CATEGORIES = [
  "timeout",
  "network",
  "auth",
  "rejected",
  "provider-rate-limited",
  "provider-error",
  "unexpected",
] as const;
export type SecuritySmsFailureCategory = (typeof SECURITY_SMS_FAILURE_CATEGORIES)[number];
export type SecurityNotificationFailureCategory = SecuritySmsFailureCategory;

/**
 * Trace d'une notification. Ne contient ni numéro, ni texte du SMS, ni réponse
 * du fournisseur : uniquement des statuts et une clé de déduplication hachée.
 */
export interface SecurityNotification {
  id: string;
  securityEventId: string | null;
  eventType: string | null;
  channel: SecurityNotificationChannel;
  kind: SecurityNotificationKind;
  level: SecurityNotificationLevel;
  status: SecurityNotificationStatus;
  deduplicationKey: string;
  createdAt: string;
  lastSeenAt: string;
  sentAt: string | null;
  occurrenceCount: number;
  providerMessageId: string | null;
  failureCategory: SecuritySmsFailureCategory | null;
}

export type NewSecurityNotification = Pick<
  SecurityNotification,
  "securityEventId" | "eventType" | "channel" | "kind" | "level" | "status" | "deduplicationKey" | "createdAt"
>;

export interface SecurityNotificationCompletion {
  status: "SENT" | "FAILED";
  at: string;
  providerMessageId?: string | null;
  failureCategory?: SecuritySmsFailureCategory | null;
}

export interface SecurityNotificationStatusCount {
  status: SecurityNotificationStatus;
  rows: number;
  occurrences: number;
}

/** Stockage persistant : survit au redémarrage (cooldown et quotas non contournables). */
export interface SecurityNotificationStore {
  insert(notification: NewSecurityNotification): Promise<SecurityNotification>;
  complete(id: string, completion: SecurityNotificationCompletion): Promise<void>;
  /** Dernière tentative (PENDING / SENT / FAILED) pour cette clé depuis `since`. */
  lastAttempt(
    deduplicationKey: string,
    since: string,
    channel?: SecurityNotificationChannel,
  ): Promise<SecurityNotification | null>;
  /** Tentatives toutes clés confondues depuis `since` (quota global, filtrable par canal). */
  countAttempts(since: string, channel?: SecurityNotificationChannel): Promise<number>;
  /** Agrège les suppressions identiques (même clé + statut) vues depuis `since`. */
  recordSuppressed(
    notification: NewSecurityNotification & { status: SecurityNotificationSuppressedStatus },
    since: string,
  ): Promise<SecurityNotification>;
  latestSent(kind: SecurityNotificationKind, channel?: SecurityNotificationChannel): Promise<SecurityNotification | null>;
  countByStatus(since: string, channel?: SecurityNotificationChannel): Promise<SecurityNotificationStatusCount[]>;
  purgeOlderThan(cutoff: string): Promise<number>;
}

export function isSecurityNotificationStatus(value: unknown): value is SecurityNotificationStatus {
  return typeof value === "string" && (SECURITY_NOTIFICATION_STATUSES as readonly string[]).includes(value);
}

export function isSecuritySmsFailureCategory(value: unknown): value is SecuritySmsFailureCategory {
  return typeof value === "string" && (SECURITY_SMS_FAILURE_CATEGORIES as readonly string[]).includes(value);
}

export function isSecurityNotificationChannel(value: unknown): value is SecurityNotificationChannel {
  return typeof value === "string" && (SECURITY_NOTIFICATION_CHANNELS as readonly string[]).includes(value);
}
