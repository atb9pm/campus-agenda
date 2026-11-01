import {
  SECURITY_NOTIFICATION_ATTEMPT_STATUSES,
  type NewSecurityNotification,
  type SecurityNotification,
  type SecurityNotificationCompletion,
  type SecurityNotificationKind,
  type SecurityNotificationStatusCount,
  type SecurityNotificationStore,
  type SecurityNotificationSuppressedStatus,
} from "../../features/security-notifications/types.ts";

const ATTEMPT_STATUSES: readonly string[] = SECURITY_NOTIFICATION_ATTEMPT_STATUSES;

function newest<T extends { createdAt: string }>(rows: T[]): T | null {
  return [...rows].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null;
}

/** Store mémoire (tests, CAMPUS_STORE=memory) : ne survit pas au redémarrage. */
export class MemorySecurityNotificationStore implements SecurityNotificationStore {
  private readonly rows: SecurityNotification[] = [];

  async insert(notification: NewSecurityNotification): Promise<SecurityNotification> {
    const row: SecurityNotification = {
      ...notification,
      id: `snt_${crypto.randomUUID()}`,
      lastSeenAt: notification.createdAt,
      sentAt: null,
      occurrenceCount: 1,
      providerMessageId: null,
      failureCategory: null,
    };
    this.rows.push(row);
    return { ...row };
  }

  async complete(id: string, completion: SecurityNotificationCompletion): Promise<void> {
    const row = this.rows.find((entry) => entry.id === id && entry.status === "PENDING");
    if (!row) return;
    row.status = completion.status;
    row.lastSeenAt = completion.at;
    row.sentAt = completion.status === "SENT" ? completion.at : null;
    row.providerMessageId = completion.providerMessageId ?? null;
    row.failureCategory = completion.failureCategory ?? null;
  }

  async lastAttempt(deduplicationKey: string, since: string): Promise<SecurityNotification | null> {
    const row = newest(this.rows.filter((entry) =>
      entry.deduplicationKey === deduplicationKey
      && ATTEMPT_STATUSES.includes(entry.status)
      && entry.createdAt >= since));
    return row ? { ...row } : null;
  }

  async countAttempts(since: string): Promise<number> {
    return this.rows.filter((entry) => ATTEMPT_STATUSES.includes(entry.status) && entry.createdAt >= since).length;
  }

  async recordSuppressed(
    notification: NewSecurityNotification & { status: SecurityNotificationSuppressedStatus },
    since: string,
  ): Promise<SecurityNotification> {
    const existing = [...this.rows]
      .filter((entry) =>
        entry.deduplicationKey === notification.deduplicationKey
        && entry.status === notification.status
        && entry.lastSeenAt >= since)
      .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt))[0];
    if (!existing) return this.insert(notification);
    existing.occurrenceCount += 1;
    existing.lastSeenAt = notification.createdAt;
    return { ...existing };
  }

  async latestSent(kind: SecurityNotificationKind): Promise<SecurityNotification | null> {
    const row = [...this.rows]
      .filter((entry) => entry.kind === kind && entry.status === "SENT" && entry.sentAt)
      .sort((left, right) => (right.sentAt ?? "").localeCompare(left.sentAt ?? ""))[0];
    return row ? { ...row } : null;
  }

  async countByStatus(since: string): Promise<SecurityNotificationStatusCount[]> {
    const counts = new Map<SecurityNotificationStatusCount["status"], SecurityNotificationStatusCount>();
    for (const row of this.rows) {
      if (row.lastSeenAt < since) continue;
      const entry = counts.get(row.status) ?? { status: row.status, rows: 0, occurrences: 0 };
      entry.rows += 1;
      entry.occurrences += row.occurrenceCount;
      counts.set(row.status, entry);
    }
    return [...counts.values()];
  }

  async purgeOlderThan(cutoff: string): Promise<number> {
    let removed = 0;
    for (let index = this.rows.length - 1; index >= 0; index -= 1) {
      const row = this.rows[index]!;
      if (row.lastSeenAt < cutoff && row.status !== "PENDING") {
        this.rows.splice(index, 1);
        removed += 1;
      }
    }
    return removed;
  }
}

let memorySecurityNotificationStore: MemorySecurityNotificationStore | null = null;

export function getMemorySecurityNotificationStore(): MemorySecurityNotificationStore {
  memorySecurityNotificationStore ??= new MemorySecurityNotificationStore();
  return memorySecurityNotificationStore;
}

export function resetMemorySecurityNotificationStore(): void {
  memorySecurityNotificationStore = null;
}
