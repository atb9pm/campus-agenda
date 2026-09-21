export const AUTH_RATE_LIMIT_WINDOW_MS = 60_000;
export const AUTH_TEACHER_LIMIT = 10;
/** 20/min : une classe sur IP partagée peut se connecter ; un script ne peut pas tester des milliers de codes. */
export const AUTH_STUDENT_LIMIT = 20;
export const AUTH_PASSWORD_CHANGE_LIMIT = 10;
export const AUTH_MFA_LIMIT = 8;

/** Portées limitées : connexion enseignant, connexion élève, changement de mot de passe, MFA. */
export type AuthRateLimitScope = "teacher" | "student" | "teacher-password" | "teacher-mfa";

const memoryBuckets = new Map<string, { count: number; resetAt: number }>();

const IPV4 =
  /^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const IPV6 = /^[0-9a-f:]{2,39}$/i;

export function parseClientIp(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/^\[|\]$/g, "");
  if (!trimmed || trimmed.length > 45) return null;
  if (IPV4.test(trimmed)) return trimmed;
  if (trimmed.includes(":") && IPV6.test(trimmed)) return trimmed.toLowerCase();
  return null;
}

function lastForwardedIp(header: string | null): string | null {
  if (!header) return null;
  const parts = header.split(",");
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const ip = parseClientIp(parts[index]);
    if (ip) return ip;
  }
  return null;
}

/**
 * Identifiant de client pour le rate limit.
 * `cf-connecting-ip` n’est crédible que derrière Cloudflare (`cf-ray`).
 * Sinon : `x-real-ip`, puis le *dernier* saut `X-Forwarded-For` (ajouté par le proxy).
 * Un `X-Forwarded-For` forgé en tête de liste ne crée pas un nouveau seau.
 * Sans IP valide : seau partagé `unknown` (fail closed contre le spoof).
 */
export function readClientKey(request: Request): string {
  const cfRay = request.headers.get("cf-ray")?.trim();
  if (cfRay) {
    const cfIp = parseClientIp(request.headers.get("cf-connecting-ip"));
    if (cfIp) return cfIp;
  }
  const realIp = parseClientIp(request.headers.get("x-real-ip"));
  if (realIp) return realIp;
  const forwarded = lastForwardedIp(request.headers.get("x-forwarded-for"));
  if (forwarded) return forwarded;
  return "unknown";
}

export function buildAuthRateLimitKey(scope: AuthRateLimitScope, clientKey: string): string {
  return `auth:${scope}:${clientKey}`;
}

const RATE_LIMIT_ENV_KEYS: Record<AuthRateLimitScope, string> = {
  teacher: "CAMPUS_AUTH_RATE_LIMIT_TEACHER",
  student: "CAMPUS_AUTH_RATE_LIMIT_STUDENT",
  "teacher-password": "CAMPUS_AUTH_RATE_LIMIT_TEACHER_PASSWORD",
  "teacher-mfa": "CAMPUS_AUTH_RATE_LIMIT_TEACHER_MFA",
};

const RATE_LIMIT_DEFAULTS: Record<AuthRateLimitScope, number> = {
  teacher: AUTH_TEACHER_LIMIT,
  student: AUTH_STUDENT_LIMIT,
  "teacher-password": AUTH_PASSWORD_CHANGE_LIMIT,
  "teacher-mfa": AUTH_MFA_LIMIT,
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
