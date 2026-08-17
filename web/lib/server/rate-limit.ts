import { attachRequestId, logApiEvent, readRequestId } from "@campus/lib/observability/index.ts";
import {
  buildAuthRateLimitKey,
  checkInMemoryRateLimit,
  readClientKey,
  resolveAuthRateLimit,
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

function rateLimitResponse(request: Request, scope: "teacher" | "student"): Response {
  const requestId = readRequestId(request);
  const headers = new Headers({
    "Content-Type": "application/json",
    "Retry-After": "60",
  });
  attachRequestId(headers, requestId);
  logApiEvent({
    requestId,
    route: `/api/auth/${scope}`,
    method: "POST",
    status: 429,
    durationMs: 0,
  });
  return jsonResponse(
    { ok: false, reason: "Trop de tentatives. Réessayez dans une minute." },
    { status: 429, headers },
  );
}

export async function enforceAuthRateLimit(
  request: Request,
  scope: "teacher" | "student",
): Promise<Response | null> {
  if (process.env.CAMPUS_DISABLE_RATE_LIMIT === "1") {
    return null;
  }

  const clientKey = readClientKey(request);
  const key = buildAuthRateLimitKey(scope, clientKey);
  const limit = resolveAuthRateLimit(scope);
  const binding = await getAuthRateLimiter();

  if (binding) {
    const { success } = await binding.limit({ key });
    return success ? null : rateLimitResponse(request, scope);
  }

  return checkInMemoryRateLimit(key, limit) ? null : rateLimitResponse(request, scope);
}
