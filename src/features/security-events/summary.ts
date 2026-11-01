import { SECURITY_EVENT_CATALOG, isSecurityEventType } from "./catalog.ts";
import type { SecurityEventSummaryRow, SecuritySummaryBucket } from "./types.ts";

export type SecurityStatusLevel = "normal" | "warning" | "critical";

export const SECURITY_PERIODS = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
} as const;
export type SecurityPeriod = keyof typeof SECURITY_PERIODS;

export function parseSecurityPeriod(value: unknown): SecurityPeriod {
  return value === "7d" || value === "30d" ? value : "24h";
}

export function securityPeriodSince(period: SecurityPeriod, now: Date): string {
  return new Date(now.getTime() - SECURITY_PERIODS[period]).toISOString();
}

export interface SecuritySummary {
  cards: Record<SecuritySummaryBucket, number>;
  status: { level: SecurityStatusLevel; reviewCount: number; criticalCount: number };
}

/**
 * Cartes : somme des occurrences (un agrégat de 5 échecs compte 5).
 * Alertes et état : nombre de lignes (une alerte agrégée compte une fois).
 */
export function buildSecuritySummary(rows: readonly SecurityEventSummaryRow[]): SecuritySummary {
  const cards: Record<SecuritySummaryBucket, number> = {
    loginSucceeded: 0,
    loginFailed: 0,
    blocked: 0,
    denied: 0,
    sensitive: 0,
    alerts: 0,
  };
  let warningRows = 0;
  let criticalRows = 0;
  for (const row of rows) {
    if (!isSecurityEventType(row.eventType)) continue;
    const definition = SECURITY_EVENT_CATALOG[row.eventType];
    if (definition.bucket === "alerts") {
      cards.alerts += row.rows;
    } else if (definition.bucket) {
      cards[definition.bucket] += row.occurrences;
      if (row.severity === "CRITICAL") cards.alerts += row.rows;
    }
    if (row.severity === "WARNING") warningRows += row.rows;
    if (row.severity === "CRITICAL") criticalRows += row.rows;
  }
  const level: SecurityStatusLevel = criticalRows > 0 ? "critical" : warningRows > 0 ? "warning" : "normal";
  return { cards, status: { level, reviewCount: warningRows + criticalRows, criticalCount: criticalRows } };
}
