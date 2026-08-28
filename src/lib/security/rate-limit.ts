export const AUTH_RATE_LIMIT_WINDOW_MS = 60_000;
export const AUTH_TEACHER_LIMIT = 10;
export const AUTH_STUDENT_LIMIT = 20;
export const AUTH_PASSWORD_CHANGE_LIMIT = 10;

/** Portées limitées : connexion enseignant, connexion élève, changement de mot de passe. */
export type AuthRateLimitScope = "teacher" | "student" | "teacher-password";

const memoryBuckets = new Map<string, { count: number; resetAt: number }>();

export function readClientKey(request: Request): string {
  return request.headers.get("cf-connecting-ip")
    ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? "unknown";
}

export function buildAuthRateLimitKey(scope: AuthRateLimitScope, clientKey: string): string {
  return `auth:${scope}:${clientKey}`;
}

const RATE_LIMIT_ENV_KEYS: Record<AuthRateLimitScope, string> = {
  teacher: "CAMPUS_AUTH_RATE_LIMIT_TEACHER",
  student: "CAMPUS_AUTH_RATE_LIMIT_STUDENT",
  "teacher-password": "CAMPUS_AUTH_RATE_LIMIT_TEACHER_PASSWORD",
};

const RATE_LIMIT_DEFAULTS: Record<AuthRateLimitScope, number> = {
  teacher: AUTH_TEACHER_LIMIT,
  student: AUTH_STUDENT_LIMIT,
  "teacher-password": AUTH_PASSWORD_CHANGE_LIMIT,
};

export function resolveAuthRateLimit(scope: AuthRateLimitScope): number {
  const configured = Number(process.env[RATE_LIMIT_ENV_KEYS[scope]]);
  if (Number.isFinite(configured) && configured > 0) {
    return configured;
  }
  return RATE_LIMIT_DEFAULTS[scope];
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
