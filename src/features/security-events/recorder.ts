import { isSecurityEventType, securityEventDefinition, type SecurityEventType } from "./catalog.ts";
import { evaluateAnomalies, type AnomalyFinding } from "./detection.ts";
import { isSourceFingerprint } from "./fingerprint.ts";
import {
  isSafeSecurityIdentifier,
  sanitizeSecurityMetadata,
  sanitizeSecurityMethod,
  sanitizeSecurityRequestId,
  sanitizeSecurityRoute,
  sanitizeSecurityStatus,
} from "./metadata.ts";
import { maybePurgeSecurityEvents } from "./retention.ts";
import {
  isSecurityActorType,
  isSecuritySeverity,
  isSecurityTargetType,
  type NewSecurityEvent,
  type SecurityActorType,
  type SecurityEvent,
  type SecurityEventStore,
  type SecuritySeverity,
  type SecurityTargetType,
} from "./types.ts";

/**
 * Entrée d'un événement. Les métadonnées sont filtrées par le catalogue :
 * une clé non déclarée pour ce type n'est jamais enregistrée.
 */
export interface SecurityEventInput {
  type: SecurityEventType;
  severity?: SecuritySeverity;
  actorType: SecurityActorType;
  actorId?: string | null;
  targetType?: SecurityTargetType | null;
  targetId?: string | null;
  route?: string | null;
  httpMethod?: string | null;
  httpStatus?: number | null;
  requestId?: string | null;
  sourceFingerprint?: string | null;
  metadata?: Record<string, unknown>;
  /** Fusionne les occurrences identiques vues dans cette fenêtre (bruit répétitif). */
  aggregateWindowMinutes?: number;
}

export interface SecurityRecorderDeps {
  store: SecurityEventStore;
  now?: () => Date;
  /** Log structuré parallèle (observabilité existante). */
  log?: (event: SecurityEvent) => void;
  onError?: (error: unknown, type: string) => void;
  onPurge?: (purged: number) => void;
}

export function buildSecurityEvent(input: SecurityEventInput, now: Date): NewSecurityEvent | null {
  if (!isSecurityEventType(input.type) || !isSecurityActorType(input.actorType)) return null;
  const definition = securityEventDefinition(input.type);
  const targetType = isSecurityTargetType(input.targetType) ? input.targetType : null;
  const targetId = targetType && isSafeSecurityIdentifier(input.targetId) ? input.targetId : null;
  return {
    occurredAt: now.toISOString(),
    eventType: input.type,
    category: definition.category,
    severity: isSecuritySeverity(input.severity) ? input.severity : definition.severity,
    actorType: input.actorType,
    actorId: input.actorType !== "ANONYMOUS" && isSafeSecurityIdentifier(input.actorId) ? input.actorId : null,
    targetType: targetId ? targetType : null,
    targetId,
    route: sanitizeSecurityRoute(input.route),
    httpMethod: sanitizeSecurityMethod(input.httpMethod),
    httpStatus: sanitizeSecurityStatus(input.httpStatus),
    requestId: sanitizeSecurityRequestId(input.requestId),
    sourceFingerprint: isSourceFingerprint(input.sourceFingerprint) ? input.sourceFingerprint : null,
    metadata: sanitizeSecurityMetadata(input.type, input.metadata),
    aggregationKey: null,
  };
}

/** Clé d'agrégation construite uniquement à partir de champs déjà assainis. */
export function securityAggregationKey(event: NewSecurityEvent, parts?: readonly string[]): string {
  const base = parts ?? [
    event.actorType,
    event.actorId ?? "-",
    event.targetId ?? "-",
    event.sourceFingerprint ?? "-",
    event.route ?? "-",
    JSON.stringify(event.metadata),
  ];
  return [event.eventType, event.severity, ...base].join("|");
}

async function persist(
  store: SecurityEventStore,
  event: NewSecurityEvent,
  now: Date,
  aggregateWindowMinutes: number | undefined,
  aggregationParts?: readonly string[],
): Promise<SecurityEvent> {
  if (!aggregateWindowMinutes || aggregateWindowMinutes <= 0) return store.append(event);
  const since = new Date(now.getTime() - aggregateWindowMinutes * 60_000).toISOString();
  return store.appendOrIncrement(
    { ...event, aggregationKey: securityAggregationKey(event, aggregationParts) },
    since,
  );
}

function anomalyEvent(source: SecurityEvent, finding: AnomalyFinding, now: Date): NewSecurityEvent {
  const definition = securityEventDefinition(finding.rule.anomalyType);
  return {
    occurredAt: now.toISOString(),
    eventType: finding.rule.anomalyType,
    category: definition.category,
    severity: definition.severity,
    actorType: source.actorType,
    actorId: source.actorId,
    targetType: source.targetType,
    targetId: source.targetId,
    route: source.route,
    httpMethod: source.httpMethod,
    httpStatus: source.httpStatus,
    requestId: source.requestId,
    sourceFingerprint: source.sourceFingerprint,
    metadata: sanitizeSecurityMetadata(finding.rule.anomalyType, {
      scope: finding.scope,
      observedCount: finding.observedCount,
      threshold: finding.threshold,
      windowMinutes: finding.rule.windowMinutes,
    }),
    aggregationKey: null,
  };
}

/**
 * Écrit un événement de sécurité, puis évalue les règles d'anomalie.
 * Ne lève jamais : une panne du journal ne doit pas rendre le service inutilisable.
 */
export async function recordSecurityEvent(
  deps: SecurityRecorderDeps,
  input: SecurityEventInput,
): Promise<SecurityEvent | null> {
  const now = deps.now?.() ?? new Date();
  try {
    const built = buildSecurityEvent(input, now);
    if (!built) {
      deps.onError?.(new Error("Événement de sécurité invalide."), String(input.type));
      return null;
    }
    const saved = await persist(deps.store, built, now, input.aggregateWindowMinutes);
    deps.log?.(saved);

    if (saved.category !== "ANOMALY") {
      for (const finding of await evaluateAnomalies(deps.store, saved, now)) {
        const anomaly = await persist(
          deps.store,
          anomalyEvent(saved, finding, now),
          now,
          finding.rule.windowMinutes,
          [finding.scope, finding.subjectId],
        );
        deps.log?.(anomaly);
      }
    }

    const purged = await maybePurgeSecurityEvents(deps.store, now);
    if (purged) deps.onPurge?.(purged);
    return saved;
  } catch (error) {
    deps.onError?.(error, String(input.type));
    return null;
  }
}

/** Alerte directe (volume de lectures) : agrégée par sujet sur la fenêtre de la règle. */
export async function recordSecurityAnomaly(
  deps: SecurityRecorderDeps,
  input: SecurityEventInput & { scope: "account" | "source"; subjectId: string; windowMinutes: number },
): Promise<SecurityEvent | null> {
  const now = deps.now?.() ?? new Date();
  try {
    const built = buildSecurityEvent(input, now);
    if (!built || built.category !== "ANOMALY") return null;
    const saved = await persist(deps.store, built, now, input.windowMinutes, [input.scope, input.subjectId]);
    deps.log?.(saved);
    return saved;
  } catch (error) {
    deps.onError?.(error, String(input.type));
    return null;
  }
}
