import { attachRequestId, logApiEvent, readRequestId } from "@campus/lib/observability/index.ts";
import {
  buildAuthIpRateLimitKey,
  buildAuthTargetRateLimitKey,
  checkInMemoryRateLimit,
  isAuthRateLimitBypassAllowed,
  readClientKey,
  resolveAuthRateLimit,
  sanitizeRateLimitTarget,
  type AuthRateLimitScope,
} from "@campus/lib/security/rate-limit.ts";

import { jsonResponse } from "./api.ts";
import { recordRequestSecurityEvent } from "./security-events.ts";

interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

async function getAuthRateLimiter(): Promise<RateLimitBinding | null> {
  try {
    const { env } = await import("cloudflare:workers") as { env: { AUTH_RATE_LIMITER?: RateLimitBinding } };
    return env.AUTH_RATE_LIMITER ?? null;
  } catch {
    return null;
  }
}

const RATE_LIMIT_ROUTES: Record<AuthRateLimitScope, string> = {
  teacher: "/api/auth/teacher",
  student: "/api/auth/student",
  "teacher-password": "/api/auth/teacher/password",
  "teacher-mfa": "/api/auth/teacher/mfa",
};

/** Identité connue au moment du blocage — identifiants internes uniquement. */
export interface RateLimitSecurityActor {
  actorType: "TEACHER" | "ANONYMOUS";
  actorId?: string | null;
  /** Compte réellement visé (connexion enseignant sur un compte existant). */
  targetTeacherId?: string | null;
}

async function recordRateLimitTriggered(
  request: Request,
  scope: AuthRateLimitScope,
  layer: "ip" | "target",
  actor: RateLimitSecurityActor | undefined,
) {
  const targetKnown = Boolean(actor?.targetTeacherId);
  await recordRequestSecurityEvent(request, {
    type: "RATE_LIMIT_TRIGGERED",
    severity: scope === "teacher-mfa" || (scope === "teacher" && layer === "target" && targetKnown) ? "CRITICAL" : "WARNING",
    actorType: actor?.actorType ?? "ANONYMOUS",
    actorId: actor?.actorId ?? null,
    targetType: targetKnown ? "TEACHER" : null,
    targetId: actor?.targetTeacherId ?? null,
    httpStatus: 429,
    metadata: { scope, layer, targetKnown },
    aggregateWindowMinutes: 15,
  });
}

function rateLimitResponse(request: Request, scope: AuthRateLimitScope): Response {
  const requestId = readRequestId(request);
  const headers = new Headers({
    "Content-Type": "application/json",
    "Retry-After": "60",
  });
  attachRequestId(headers, requestId);
  logApiEvent({
    requestId,
    route: RATE_LIMIT_ROUTES[scope],
    method: "POST",
    status: 429,
    durationMs: 0,
  });
  return jsonResponse(
    { ok: false, reason: "Trop de tentatives. Réessayez dans une minute." },
    { status: 429, headers },
  );
}

async function consumeLimit(
  binding: RateLimitBinding | null,
  key: string,
  limit: number,
): Promise<boolean> {
  if (binding) {
    const { success } = await binding.limit({ key });
    return success;
  }
  return checkInMemoryRateLimit(key, limit);
}

export interface EnforceAuthRateLimitOptions {
  /** Identifiant / préfixe de classe — jamais un mot de passe, TOTP, recovery ou code élève. */
  targetKey?: string;
  /** `ip` : seau IP seulement. `target` : seau cible seulement. Défaut : les deux si targetKey. */
  layer?: "ip" | "target" | "both";
  securityActor?: RateLimitSecurityActor;
}

/**
 * Deux seaux indépendants : IP et cible.
 * Concaténer `IP:compte` permettrait de contourner la limite compte en changeant d’IP.
 */
export async function enforceAuthRateLimit(
  request: Request,
  scope: AuthRateLimitScope,
  targetKeyOrOptions?: string | EnforceAuthRateLimitOptions,
): Promise<Response | null> {
  if (isAuthRateLimitBypassAllowed()) {
    return null;
  }

  const options = typeof targetKeyOrOptions === "string"
    ? { targetKey: targetKeyOrOptions }
    : targetKeyOrOptions ?? {};
  const targetKey = options.targetKey ? sanitizeRateLimitTarget(options.targetKey) : undefined;
  const layer = options.layer ?? (targetKey ? "both" : "ip");
  const binding = await getAuthRateLimiter();
  // MFA et changement de mot de passe : la cible est toujours le teacherId de la session.
  const securityActor = options.securityActor ?? (
    options.targetKey && (scope === "teacher-mfa" || scope === "teacher-password")
      ? { actorType: "TEACHER" as const, actorId: options.targetKey }
      : undefined
  );

  if (layer !== "target") {
    const ipKey = buildAuthIpRateLimitKey(scope, readClientKey(request));
    const allowed = await consumeLimit(binding, ipKey, resolveAuthRateLimit(scope, "ip"));
    if (!allowed) {
      await recordRateLimitTriggered(request, scope, "ip", securityActor);
      return rateLimitResponse(request, scope);
    }
  }

  if (targetKey && layer !== "ip") {
    const targetBucket = buildAuthTargetRateLimitKey(scope, targetKey);
    const allowed = await consumeLimit(binding, targetBucket, resolveAuthRateLimit(scope, "target"));
    if (!allowed) {
      await recordRateLimitTriggered(request, scope, "target", securityActor);
      return rateLimitResponse(request, scope);
    }
  }

  return null;
}
