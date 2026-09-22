import { attachRequestId, logApiEvent, readRequestId } from "@campus/lib/observability/index.ts";
import {
  buildAuthIpRateLimitKey,
  buildAuthTargetRateLimitKey,
  checkInMemoryRateLimit,
  readClientKey,
  resolveAuthRateLimit,
  sanitizeRateLimitTarget,
  type AuthRateLimitScope,
} from "@campus/lib/security/rate-limit.ts";

import { jsonResponse } from "./api.ts";

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
  if (process.env.CAMPUS_DISABLE_RATE_LIMIT === "1") {
    return null;
  }

  const options = typeof targetKeyOrOptions === "string"
    ? { targetKey: targetKeyOrOptions }
    : targetKeyOrOptions ?? {};
  const targetKey = options.targetKey ? sanitizeRateLimitTarget(options.targetKey) : undefined;
  const layer = options.layer ?? (targetKey ? "both" : "ip");
  const binding = await getAuthRateLimiter();

  if (layer !== "target") {
    const ipKey = buildAuthIpRateLimitKey(scope, readClientKey(request));
    const allowed = await consumeLimit(binding, ipKey, resolveAuthRateLimit(scope, "ip"));
    if (!allowed) return rateLimitResponse(request, scope);
  }

  if (targetKey && layer !== "ip") {
    const targetBucket = buildAuthTargetRateLimitKey(scope, targetKey);
    const allowed = await consumeLimit(binding, targetBucket, resolveAuthRateLimit(scope, "target"));
    if (!allowed) return rateLimitResponse(request, scope);
  }

  return null;
}
