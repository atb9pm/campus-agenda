import type {
  NewSecurityEvent,
  SecurityEvent,
  SecurityEventListFilter,
  SecurityEventOccurrenceFilter,
  SecurityEventStore,
  SecurityEventSummaryRow,
} from "../../features/security-events/types.ts";

function newSecurityEventId(): string {
  return `sev_${crypto.randomUUID()}`;
}

function clone(event: SecurityEvent): SecurityEvent {
  return { ...event, metadata: { ...event.metadata } };
}

/** Store mémoire (tests, CAMPUS_STORE=memory) : ne survit pas au redémarrage. */
export class MemorySecurityEventStore implements SecurityEventStore {
  private readonly rows: SecurityEvent[] = [];

  async append(event: NewSecurityEvent): Promise<SecurityEvent> {
    const row: SecurityEvent = {
      ...event,
      id: event.id ?? newSecurityEventId(),
      metadata: { ...event.metadata },
      lastSeenAt: event.occurredAt,
      occurrenceCount: 1,
    };
    this.rows.push(row);
    return clone(row);
  }

  async appendOrIncrement(event: NewSecurityEvent & { aggregationKey: string }, since: string): Promise<SecurityEvent> {
    const existing = this.rows
      .filter((row) => row.aggregationKey === event.aggregationKey && row.lastSeenAt >= since)
      .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt))[0];
    if (!existing) return this.append(event);
    existing.occurrenceCount += 1;
    existing.lastSeenAt = event.occurredAt;
    existing.metadata = { ...event.metadata };
    return clone(existing);
  }

  async sumOccurrences(filter: SecurityEventOccurrenceFilter): Promise<number> {
    return this.rows
      .filter((row) =>
        filter.eventTypes.includes(row.eventType)
        && row.lastSeenAt >= filter.since
        && (filter.actorId === undefined || row.actorId === filter.actorId)
        && (filter.targetId === undefined || row.targetId === filter.targetId)
        && (filter.sourceFingerprint === undefined || row.sourceFingerprint === filter.sourceFingerprint))
      .reduce((total, row) => total + row.occurrenceCount, 0);
  }

  async list(filter: SecurityEventListFilter): Promise<{ events: SecurityEvent[]; total: number }> {
    const matching = this.rows
      .filter((row) => row.lastSeenAt >= filter.since && (!filter.severity || row.severity === filter.severity))
      .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt) || right.id.localeCompare(left.id));
    return {
      events: matching.slice(filter.offset, filter.offset + filter.limit).map(clone),
      total: matching.length,
    };
  }

  async summarize(since: string): Promise<SecurityEventSummaryRow[]> {
    const grouped = new Map<string, SecurityEventSummaryRow>();
    for (const row of this.rows) {
      if (row.lastSeenAt < since) continue;
      const key = `${row.eventType}|${row.severity}`;
      const entry = grouped.get(key) ?? { eventType: row.eventType, severity: row.severity, rows: 0, occurrences: 0 };
      entry.rows += 1;
      entry.occurrences += row.occurrenceCount;
      grouped.set(key, entry);
    }
    return [...grouped.values()];
  }

  async purgeOlderThan(cutoff: string): Promise<number> {
    let removed = 0;
    for (let index = this.rows.length - 1; index >= 0; index -= 1) {
      if (this.rows[index]!.lastSeenAt < cutoff) {
        this.rows.splice(index, 1);
        removed += 1;
      }
    }
    return removed;
  }
}

let memorySecurityEventStore: MemorySecurityEventStore | null = null;

export function getMemorySecurityEventStore(): MemorySecurityEventStore {
  memorySecurityEventStore ??= new MemorySecurityEventStore();
  return memorySecurityEventStore;
}

export function resetMemorySecurityEventStore(): void {
  memorySecurityEventStore = null;
}
