export const AUTH_RATE_LIMIT_WINDOW_MS = 60_000;
export const AUTH_TEACHER_LIMIT = 10;
export const AUTH_STUDENT_LIMIT = 20;

const memoryBuckets = new Map<string, { count: number; resetAt: number }>();

export function readClientKey(request: Request): string {
  return request.headers.get("cf-connecting-ip")
    ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? "unknown";
}

export function buildAuthRateLimitKey(scope: "teacher" | "student", clientKey: string): string {
  return `auth:${scope}:${clientKey}`;
}

export function resolveAuthRateLimit(scope: "teacher" | "student"): number {
  const envKey = scope === "teacher" ? "CAMPUS_AUTH_RATE_LIMIT_TEACHER" : "CAMPUS_AUTH_RATE_LIMIT_STUDENT";
  const configured = Number(process.env[envKey]);
  if (Number.isFinite(configured) && configured > 0) {
    return configured;
  }
  return scope === "teacher" ? AUTH_TEACHER_LIMIT : AUTH_STUDENT_LIMIT;
}

export function checkInMemoryRateLimit(
  key: string,
  limit: number,
  windowMs = AUTH_RATE_LIMIT_WINDOW_MS,
): boolean {
  const now = Date.now();
  const bucket = memoryBuckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    memoryBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= limit) {
    return false;
  }
  bucket.count += 1;
  return true;
}

export function resetInMemoryRateLimits(): void {
  memoryBuckets.clear();
}
