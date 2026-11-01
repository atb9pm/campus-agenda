import type {
  NewSecurityNotification,
  SecurityNotification,
  SecurityNotificationCompletion,
  SecurityNotificationKind,
  SecurityNotificationStatusCount,
  SecurityNotificationStore,
  SecurityNotificationSuppressedStatus,
} from "../../../features/security-notifications/types.ts";
import {
  SECURITY_NOTIFICATION_ATTEMPT_STATUSES,
  isSecurityNotificationStatus,
  isSecuritySmsFailureCategory,
} from "../../../features/security-notifications/types.ts";
import type { SqlDatabase } from "./types.ts";

interface SecurityNotificationRow {
  id: string;
  security_event_id: string | null;
  event_type: string | null;
  channel: string;
  kind: string;
  level: string;
  status: string;
  deduplication_key: string;
  created_at: string;
  last_seen_at: string;
  sent_at: string | null;
  occurrence_count: number;
  provider_message_id: string | null;
  failure_category: string | null;
}

const COLUMNS = [
  "id",
  "security_event_id",
  "event_type",
  "channel",
  "kind",
  "level",
  "status",
  "deduplication_key",
  "created_at",
  "last_seen_at",
  "sent_at",
  "occurrence_count",
  "provider_message_id",
  "failure_category",
].join(", ");

const ATTEMPT_PLACEHOLDERS = SECURITY_NOTIFICATION_ATTEMPT_STATUSES.map(() => "?").join(", ");

function toNotification(row: SecurityNotificationRow): SecurityNotification | null {
  if (!isSecurityNotificationStatus(row.status)) return null;
  if (row.kind !== "ALERT" && row.kind !== "TEST") return null;
  if (row.level !== "WARNING" && row.level !== "CRITICAL" && row.level !== "TEST") return null;
  return {
    id: row.id,
    securityEventId: row.security_event_id,
    eventType: row.event_type,
    channel: "SMS",
    kind: row.kind,
    level: row.level,
    status: row.status,
    deduplicationKey: row.deduplication_key,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    sentAt: row.sent_at,
    occurrenceCount: Number(row.occurrence_count) || 1,
    providerMessageId: row.provider_message_id,
    failureCategory: isSecuritySmsFailureCategory(row.failure_category) ? row.failure_category : null,
  };
}

export class SqlSecurityNotificationStore implements SecurityNotificationStore {
  private readonly db: SqlDatabase;

  constructor(db: SqlDatabase) {
    this.db = db;
  }

  async insert(notification: NewSecurityNotification): Promise<SecurityNotification> {
    const id = `snt_${crypto.randomUUID()}`;
    await this.db
      .prepare(
        `INSERT INTO security_notifications (${COLUMNS})
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, NULL, NULL)`,
      )
      .bind(
        id,
        notification.securityEventId,
        notification.eventType,
        notification.channel,
        notification.kind,
        notification.level,
        notification.status,
        notification.deduplicationKey,
        notification.createdAt,
        notification.createdAt,
      )
      .run();
    return {
      ...notification,
      id,
      lastSeenAt: notification.createdAt,
      sentAt: null,
      occurrenceCount: 1,
      providerMessageId: null,
      failureCategory: null,
    };
  }

  async complete(id: string, completion: SecurityNotificationCompletion): Promise<void> {
    await this.db
      .prepare(
        `UPDATE security_notifications
         SET status = ?, last_seen_at = ?, sent_at = ?, provider_message_id = ?, failure_category = ?
         WHERE id = ? AND status = 'PENDING'`,
      )
      .bind(
        completion.status,
        completion.at,
        completion.status === "SENT" ? completion.at : null,
        completion.providerMessageId ?? null,
        completion.failureCategory ?? null,
        id,
      )
      .run();
  }

  async lastAttempt(deduplicationKey: string, since: string): Promise<SecurityNotification | null> {
    const row = await this.db
      .prepare(
        `SELECT ${COLUMNS} FROM security_notifications
         WHERE deduplication_key = ? AND status IN (${ATTEMPT_PLACEHOLDERS}) AND created_at >= ?
         ORDER BY created_at DESC LIMIT 1`,
      )
      .bind(deduplicationKey, ...SECURITY_NOTIFICATION_ATTEMPT_STATUSES, since)
      .first<SecurityNotificationRow>();
    return row ? toNotification(row) : null;
  }

  async countAttempts(since: string): Promise<number> {
    const row = await this.db
      .prepare(
        `SELECT COUNT(*) AS total FROM security_notifications
         WHERE status IN (${ATTEMPT_PLACEHOLDERS}) AND created_at >= ?`,
      )
      .bind(...SECURITY_NOTIFICATION_ATTEMPT_STATUSES, since)
      .first<{ total: number }>();
    return Number(row?.total ?? 0);
  }

  async recordSuppressed(
    notification: NewSecurityNotification & { status: SecurityNotificationSuppressedStatus },
    since: string,
  ): Promise<SecurityNotification> {
    const existing = await this.db
      .prepare(
        `SELECT ${COLUMNS} FROM security_notifications
         WHERE deduplication_key = ? AND status = ? AND last_seen_at >= ?
         ORDER BY last_seen_at DESC LIMIT 1`,
      )
      .bind(notification.deduplicationKey, notification.status, since)
      .first<SecurityNotificationRow>();
    if (!existing) return this.insert(notification);
    await this.db
      .prepare(
        `UPDATE security_notifications
         SET occurrence_count = occurrence_count + 1, last_seen_at = ?
         WHERE id = ?`,
      )
      .bind(notification.createdAt, existing.id)
      .run();
    const updated = toNotification({
      ...existing,
      occurrence_count: Number(existing.occurrence_count) + 1,
      last_seen_at: notification.createdAt,
    });
    return updated ?? this.insert(notification);
  }

  async latestSent(kind: SecurityNotificationKind): Promise<SecurityNotification | null> {
    const row = await this.db
      .prepare(
        `SELECT ${COLUMNS} FROM security_notifications
         WHERE kind = ? AND status = 'SENT'
         ORDER BY sent_at DESC LIMIT 1`,
      )
      .bind(kind)
      .first<SecurityNotificationRow>();
    return row ? toNotification(row) : null;
  }

  async countByStatus(since: string): Promise<SecurityNotificationStatusCount[]> {
    const { results } = await this.db
      .prepare(
        `SELECT status, COUNT(*) AS rows_count, COALESCE(SUM(occurrence_count), 0) AS occurrences
         FROM security_notifications WHERE last_seen_at >= ?
         GROUP BY status`,
      )
      .bind(since)
      .all<{ status: string; rows_count: number; occurrences: number }>();
    return (results ?? []).flatMap((row) =>
      isSecurityNotificationStatus(row.status)
        ? [{ status: row.status, rows: Number(row.rows_count), occurrences: Number(row.occurrences) }]
        : []);
  }

  async purgeOlderThan(cutoff: string): Promise<number> {
    const result = await this.db
      .prepare("DELETE FROM security_notifications WHERE last_seen_at < ? AND status <> 'PENDING'")
      .bind(cutoff)
      .run();
    return Number(result.meta?.changes ?? 0);
  }
}
