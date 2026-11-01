import type {
  NewSecurityEvent,
  SecurityEvent,
  SecurityEventListFilter,
  SecurityEventOccurrenceFilter,
  SecurityEventStore,
  SecurityEventSummaryRow,
  SecurityMetadata,
} from "../../../features/security-events/types.ts";
import {
  isSecurityActorType,
  isSecurityCategory,
  isSecuritySeverity,
  isSecurityTargetType,
} from "../../../features/security-events/types.ts";
import type { SqlDatabase } from "./types.ts";

interface SecurityEventRow {
  id: string;
  occurred_at: string;
  last_seen_at: string;
  event_type: string;
  category: string;
  severity: string;
  actor_type: string;
  actor_id: string | null;
  target_type: string | null;
  target_id: string | null;
  route: string | null;
  http_method: string | null;
  http_status: number | null;
  request_id: string | null;
  source_fingerprint: string | null;
  metadata_json: string | null;
  occurrence_count: number;
  aggregation_key: string | null;
}

const COLUMNS = [
  "id",
  "occurred_at",
  "last_seen_at",
  "event_type",
  "category",
  "severity",
  "actor_type",
  "actor_id",
  "target_type",
  "target_id",
  "route",
  "http_method",
  "http_status",
  "request_id",
  "source_fingerprint",
  "metadata_json",
  "occurrence_count",
  "aggregation_key",
].join(", ");

function parseMetadata(value: string | null): SecurityMetadata {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const output: SecurityMetadata = {};
    for (const [key, entry] of Object.entries(parsed)) {
      if (typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") output[key] = entry;
    }
    return output;
  } catch {
    return {};
  }
}

function toEvent(row: SecurityEventRow): SecurityEvent | null {
  if (!isSecuritySeverity(row.severity) || !isSecurityActorType(row.actor_type) || !isSecurityCategory(row.category)) {
    return null;
  }
  return {
    id: row.id,
    occurredAt: row.occurred_at,
    lastSeenAt: row.last_seen_at,
    eventType: row.event_type,
    category: row.category,
    severity: row.severity,
    actorType: row.actor_type,
    actorId: row.actor_id,
    targetType: isSecurityTargetType(row.target_type) ? row.target_type : null,
    targetId: row.target_id,
    route: row.route,
    httpMethod: row.http_method,
    httpStatus: row.http_status === null ? null : Number(row.http_status),
    requestId: row.request_id,
    sourceFingerprint: row.source_fingerprint,
    metadata: parseMetadata(row.metadata_json),
    occurrenceCount: Number(row.occurrence_count) || 1,
    aggregationKey: row.aggregation_key,
  };
}

export class SqlSecurityEventStore implements SecurityEventStore {
  private readonly db: SqlDatabase;

  constructor(db: SqlDatabase) {
    this.db = db;
  }

  async append(event: NewSecurityEvent): Promise<SecurityEvent> {
    const id = event.id ?? `sev_${crypto.randomUUID()}`;
    await this.db
      .prepare(`INSERT INTO security_events (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`)
      .bind(
        id,
        event.occurredAt,
        event.occurredAt,
        event.eventType,
        event.category,
        event.severity,
        event.actorType,
        event.actorId,
        event.targetType,
        event.targetId,
        event.route,
        event.httpMethod,
        event.httpStatus,
        event.requestId,
        event.sourceFingerprint,
        JSON.stringify(event.metadata),
        event.aggregationKey,
      )
      .run();
    return { ...event, id, lastSeenAt: event.occurredAt, occurrenceCount: 1, metadata: { ...event.metadata } };
  }

  async appendOrIncrement(event: NewSecurityEvent & { aggregationKey: string }, since: string): Promise<SecurityEvent> {
    const existing = await this.db
      .prepare(
        `SELECT ${COLUMNS} FROM security_events
         WHERE aggregation_key = ? AND last_seen_at >= ?
         ORDER BY last_seen_at DESC LIMIT 1`,
      )
      .bind(event.aggregationKey, since)
      .first<SecurityEventRow>();
    if (!existing) return this.append(event);
    const metadataJson = JSON.stringify(event.metadata);
    await this.db
      .prepare(
        `UPDATE security_events
         SET occurrence_count = occurrence_count + 1, last_seen_at = ?, metadata_json = ?
         WHERE id = ?`,
      )
      .bind(event.occurredAt, metadataJson, existing.id)
      .run();
    const updated = toEvent({
      ...existing,
      occurrence_count: Number(existing.occurrence_count) + 1,
      last_seen_at: event.occurredAt,
      metadata_json: metadataJson,
    });
    return updated ?? this.append(event);
  }

  async sumOccurrences(filter: SecurityEventOccurrenceFilter): Promise<number> {
    if (filter.eventTypes.length === 0) return 0;
    const clauses = [`event_type IN (${filter.eventTypes.map(() => "?").join(", ")})`, "last_seen_at >= ?"];
    const values: unknown[] = [...filter.eventTypes, filter.since];
    if (filter.actorId !== undefined) {
      clauses.push("actor_id = ?");
      values.push(filter.actorId);
    }
    if (filter.targetId !== undefined) {
      clauses.push("target_id = ?");
      values.push(filter.targetId);
    }
    if (filter.sourceFingerprint !== undefined) {
      clauses.push("source_fingerprint = ?");
      values.push(filter.sourceFingerprint);
    }
    const row = await this.db
      .prepare(`SELECT COALESCE(SUM(occurrence_count), 0) AS total FROM security_events WHERE ${clauses.join(" AND ")}`)
      .bind(...values)
      .first<{ total: number }>();
    return Number(row?.total ?? 0);
  }

  async list(filter: SecurityEventListFilter): Promise<{ events: SecurityEvent[]; total: number }> {
    const clauses = ["last_seen_at >= ?"];
    const values: unknown[] = [filter.since];
    if (filter.severity) {
      clauses.push("severity = ?");
      values.push(filter.severity);
    }
    const where = clauses.join(" AND ");
    const count = await this.db
      .prepare(`SELECT COUNT(*) AS total FROM security_events WHERE ${where}`)
      .bind(...values)
      .first<{ total: number }>();
    const { results } = await this.db
      .prepare(
        `SELECT ${COLUMNS} FROM security_events WHERE ${where}
         ORDER BY last_seen_at DESC, id DESC LIMIT ? OFFSET ?`,
      )
      .bind(...values, filter.limit, filter.offset)
      .all<SecurityEventRow>();
    return {
      events: results.map(toEvent).filter((event): event is SecurityEvent => event !== null),
      total: Number(count?.total ?? 0),
    };
  }

  async summarize(since: string): Promise<SecurityEventSummaryRow[]> {
    const { results } = await this.db
      .prepare(
        `SELECT event_type, severity, COUNT(*) AS row_count, COALESCE(SUM(occurrence_count), 0) AS occurrences
         FROM security_events WHERE last_seen_at >= ?
         GROUP BY event_type, severity`,
      )
      .bind(since)
      .all<{ event_type: string; severity: string; row_count: number; occurrences: number }>();
    return results
      .filter((row) => isSecuritySeverity(row.severity))
      .map((row) => ({
        eventType: row.event_type,
        severity: row.severity as SecurityEventSummaryRow["severity"],
        rows: Number(row.row_count),
        occurrences: Number(row.occurrences),
      }));
  }

  async purgeOlderThan(cutoff: string): Promise<number> {
    const result = await this.db
      .prepare("DELETE FROM security_events WHERE last_seen_at < ?")
      .bind(cutoff)
      .run();
    return Number(result.meta?.changes ?? 0);
  }
}
