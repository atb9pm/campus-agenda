import { MFA_INVALID_CODE_REASON, MFA_INVALID_PASSWORD_REASON } from "@campus/features/admin-mfa/types.ts";
import { getAuthSecret, parseSessionToken, readSessionTokenFromRequest } from "@campus/lib/auth/index.ts";
import {
  logOperationalError,
  logOperationalEvent,
  logOperationalWarning,
  readRequestId,
} from "@campus/lib/observability/index.ts";
import { getSecurityEventStore, getTeacherAccountStore } from "@campus/lib/persistence/store-factory.ts";
import { isTrustedSensitiveRead, isTrustedWriteOrigin } from "@campus/lib/security/csrf.ts";
import { readClientKey } from "@campus/lib/security/rate-limit.ts";
import { notifySecurityEventInBackground } from "./security-sms.ts";
import {
  computeSourceFingerprint,
  formatSourceFingerprint,
  recordSecurityAnomaly,
  recordSecurityEvent,
  trackApiRead,
  type SecurityEvent,
  type SecurityEventInput,
  type SecurityRecorderDeps,
} from "@campus/features/security-events/index.ts";

/** Seuls les codes ou mots de passe incorrects sont des échecs de sécurité ; le reste est un état. */
export function classifyMfaFailure(reason: string | undefined): "wrong-code" | "wrong-password" | null {
  if (reason === MFA_INVALID_CODE_REASON) return "wrong-code";
  if (reason === MFA_INVALID_PASSWORD_REASON) return "wrong-password";
  return null;
}

/** Clé dédiée possible ; sinon AUTH_SECRET (changer la clé change toutes les empreintes). */
function fingerprintSecret(): string {
  return process.env.CAMPUS_SECURITY_FINGERPRINT_KEY?.trim() || getAuthSecret();
}

export async function requestSourceFingerprint(request: Request): Promise<string | null> {
  try {
    return await computeSourceFingerprint(readClientKey(request), fingerprintSecret());
  } catch {
    return null;
  }
}

function requestPath(request: Request): string | null {
  try {
    return new URL(request.url).pathname;
  } catch {
    return null;
  }
}

/** Log structuré parallèle : mêmes identifiants que le journal, jamais de métadonnée libre. */
function logSecurityEvent(event: SecurityEvent) {
  const fields: Record<string, string | number | boolean> = {
    eventId: event.id,
    eventType: event.eventType,
    severity: event.severity,
    actorType: event.actorType,
    occurrenceCount: event.occurrenceCount,
  };
  if (event.actorId) fields.actorId = event.actorId;
  if (event.targetId) fields.targetId = event.targetId;
  if (event.requestId) fields.requestId = event.requestId;
  if (event.route) fields.route = event.route;
  if (event.httpStatus !== null) fields.status = event.httpStatus;
  const source = formatSourceFingerprint(event.sourceFingerprint);
  if (source) fields.source = source;
  if (event.severity === "CRITICAL") logOperationalError("security_event", fields);
  else if (event.severity === "WARNING") logOperationalWarning("security_event", fields);
  else logOperationalEvent("security_event", fields);
}

async function recorderDeps(requestId: string | null): Promise<SecurityRecorderDeps> {
  return {
    store: await getSecurityEventStore(),
    log: logSecurityEvent,
    onError: (error, eventType) => {
      logOperationalError("security_event_write_failed", {
        eventType,
        ...(requestId ? { requestId } : {}),
        error: error instanceof Error ? error.name : "unknown",
      });
    },
    onPurge: (purged) => logOperationalEvent("security_event_retention_purge", { purged }),
    notify: notifySecurityEventInBackground,
  };
}

export type RequestSecurityEventInput = Omit<SecurityEventInput, "requestId" | "sourceFingerprint" | "httpMethod" | "route"> & {
  route?: string | null;
};

/**
 * Journalise un événement lié à une requête : requestId, source pseudonymisée,
 * route et méthode sont dérivés du Request. Ne lève jamais.
 */
export async function recordRequestSecurityEvent(
  request: Request,
  input: RequestSecurityEventInput,
): Promise<SecurityEvent | null> {
  const requestId = readRequestId(request);
  try {
    return await recordSecurityEvent(await recorderDeps(requestId), {
      ...input,
      route: input.route ?? requestPath(request),
      httpMethod: request.method,
      requestId,
      sourceFingerprint: await requestSourceFingerprint(request),
    });
  } catch (error) {
    logOperationalError("security_event_write_failed", {
      eventType: input.type,
      requestId,
      error: error instanceof Error ? error.name : "unknown",
    });
    return null;
  }
}

/**
 * Refus d'une route admin. Les étapes normales (MFA en attente, mot de passe
 * provisoire d'un administrateur) ne sont pas journalisées : elles sont déjà
 * tracées par les événements MFA / connexion et ne sont pas des tentatives.
 */
export async function recordAdminAccessDenied(request: Request, status: number): Promise<void> {
  try {
    if (!isTrustedWriteOrigin(request) || !isTrustedSensitiveRead(request)) {
      const session = await parseSessionToken(readSessionTokenFromRequest(request));
      await recordRequestSecurityEvent(request, {
        type: "ADMIN_ACCESS_DENIED",
        severity: "WARNING",
        actorType: session?.kind === "teacher" ? "TEACHER" : session?.kind === "student" ? "STUDENT" : "ANONYMOUS",
        actorId: session?.kind === "teacher" ? session.teacherId : session?.kind === "student" ? session.accessId : null,
        httpStatus: status,
        metadata: { reason: "untrusted-origin" },
        aggregateWindowMinutes: 15,
      });
      return;
    }
    const session = await parseSessionToken(readSessionTokenFromRequest(request));
    if (!session) {
      await recordRequestSecurityEvent(request, {
        type: "ADMIN_ACCESS_DENIED",
        severity: "INFO",
        actorType: "ANONYMOUS",
        httpStatus: status,
        metadata: { reason: "anonymous" },
        aggregateWindowMinutes: 15,
      });
      return;
    }
    if (session.kind === "student") {
      await recordRequestSecurityEvent(request, {
        type: "ADMIN_ACCESS_DENIED",
        severity: "WARNING",
        actorType: "STUDENT",
        actorId: session.accessId,
        httpStatus: status,
        metadata: { reason: "student" },
        aggregateWindowMinutes: 15,
      });
      return;
    }
    if (status === 401) {
      await recordRequestSecurityEvent(request, {
        type: "ADMIN_ACCESS_DENIED",
        severity: "INFO",
        actorType: "TEACHER",
        actorId: session.teacherId,
        httpStatus: status,
        metadata: { reason: "session-revoked" },
        aggregateWindowMinutes: 15,
      });
      return;
    }
    const account = await (await getTeacherAccountStore()).findAccount(session.teacherId);
    if (account?.isAdmin) return;
    await recordRequestSecurityEvent(request, {
      type: "ADMIN_ACCESS_DENIED",
      severity: "WARNING",
      actorType: "TEACHER",
      actorId: session.teacherId,
      httpStatus: status,
      metadata: { reason: "not-admin" },
      aggregateWindowMinutes: 15,
    });
  } catch {
    // Journal indisponible : le refus HTTP reste appliqué.
  }
}

/** Session signée valide mais révoquée (compte désactivé, mot de passe changé, accès apprentis renouvelé). */
export async function recordRejectedSession(
  request: Request,
  session: { kind: "teacher"; teacherId: string } | { kind: "student"; accessId: string },
): Promise<void> {
  await recordRequestSecurityEvent(request, {
    type: "SESSION_REJECTED",
    actorType: session.kind === "teacher" ? "TEACHER" : "STUDENT",
    actorId: session.kind === "teacher" ? session.teacherId : session.accessId,
    httpStatus: 401,
    metadata: { sessionKind: session.kind },
    aggregateWindowMinutes: 60,
  });
}

/** Lectures GET par compte enseignant : alerte unique au franchissement du seuil. */
export async function trackRequestReadVolume(request: Request): Promise<void> {
  if (request.method.toUpperCase() !== "GET") return;
  try {
    const session = await parseSessionToken(readSessionTokenFromRequest(request));
    if (session?.kind !== "teacher") return;
    const crossing = trackApiRead(session.teacherId);
    if (!crossing) return;
    const requestId = readRequestId(request);
    await recordSecurityAnomaly(await recorderDeps(requestId), {
      type: "ANOMALY_HIGH_READ_VOLUME",
      actorType: "TEACHER",
      actorId: session.teacherId,
      route: requestPath(request),
      httpMethod: request.method,
      requestId,
      sourceFingerprint: await requestSourceFingerprint(request),
      metadata: {
        scope: "account",
        observedCount: crossing.observedCount,
        threshold: crossing.threshold,
        windowMinutes: crossing.windowMinutes,
      },
      scope: "account",
      subjectId: session.teacherId,
      windowMinutes: crossing.windowMinutes,
    });
  } catch {
    // Détection best effort.
  }
}
