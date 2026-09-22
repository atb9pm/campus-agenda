import { initialsKey } from "../../features/teacher-accounts/rules.ts";
import { parseStudentAccessCode } from "../../features/student-access/code.ts";

export const AUTH_RATE_LIMIT_WINDOW_MS = 60_000;
export const AUTH_TEACHER_LIMIT = 10;
/** 20/min : une classe sur IP partagée peut se connecter ; un script ne peut pas tester des milliers de codes. */
export const AUTH_STUDENT_LIMIT = 20;
export const AUTH_PASSWORD_CHANGE_LIMIT = 10;
export const AUTH_MFA_LIMIT = 8;
/** Cible partagée si le code élève n’est pas parsable — évite un contournement. */
export const STUDENT_UNPARSED_RATE_LIMIT_TARGET = "unparsed";

/** Portées limitées : connexion enseignant, connexion élève, changement de mot de passe, MFA. */
export type AuthRateLimitScope = "teacher" | "student" | "teacher-password" | "teacher-mfa";
export type AuthRateLimitLayer = "ip" | "target";

/** Plafond fail-closed : au-delà, une nouvelle clé est refusée. Aucun seau actif n’est évincé. */
export const MEMORY_RATE_LIMIT_MAX_BUCKETS = 8_000;
/** Évite un parcours complet à chaque requête. */
const MEMORY_RATE_LIMIT_CLEANUP_EVERY_CHECKS = 32;
const MEMORY_RATE_LIMIT_CLEANUP_EVERY_MS = 15_000;

interface MemoryRateLimitBucket {
  count: number;
  resetAt: number;
}

const memoryBuckets = new Map<string, MemoryRateLimitBucket>();
let lastCleanupAt = 0;
let checksSinceCleanup = 0;

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
 * Infomaniak n’est pas garanti d’écraser ces en-têtes : d’où le seau cible indépendant.
 * Sans IP valide : seau partagé `unknown`.
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

/** Normalise une cible (identifiant, préfixe de classe) : jamais un secret. */
export function sanitizeRateLimitTarget(value: string): string {
  const compact = value.trim().toUpperCase().replace(/[^A-Z0-9._:-]/g, "").slice(0, 64);
  return compact || "empty";
}

export function buildAuthRateLimitKey(scope: AuthRateLimitScope, clientKey: string): string {
  return `auth:${scope}:${clientKey}`;
}

export function buildAuthIpRateLimitKey(scope: AuthRateLimitScope, clientKey: string): string {
  return `auth:${scope}:ip:${clientKey}`;
}

export function buildAuthTargetRateLimitKey(scope: AuthRateLimitScope, targetKey: string): string {
  return `auth:${scope}:target:${sanitizeRateLimitTarget(targetKey)}`;
}

/** Identifiant enseignant / initiales — jamais le mot de passe. */
export function authRateLimitTargetFromTeacherIdentifier(identifier: string): string {
  return authRateLimitTargetFromUnknownTeacherIdentifier(identifier);
}

/**
 * Cible si le compte n’existe pas : casse et espaces ne créent pas un nouveau seau.
 * `teacher-…` reste un identifiant ; le reste est traité comme initiales.
 */
export function authRateLimitTargetFromUnknownTeacherIdentifier(identifier: string): string {
  const trimmed = identifier.trim();
  if (!trimmed) return "empty";
  const compact = trimmed.toLowerCase().replace(/\s+/g, "");
  if (compact.startsWith("teacher-")) {
    return sanitizeRateLimitTarget(compact);
  }
  const key = initialsKey(trimmed);
  if (key) return sanitizeRateLimitTarget(key);
  return sanitizeRateLimitTarget(trimmed);
}

export interface TeacherRateLimitAccountLookup {
  findAccount(teacherId: string): Promise<{ id: string } | null>;
  findAccountByInitials(initials: string): Promise<{ id: string } | null>;
}

/**
 * Compte existant → teacherId interne canonique.
 * Inconnu → identifiant normalisé (anti-bypass casse / espaces).
 * Ne consulte que l’annuaire : jamais le mot de passe.
 */
export async function resolveTeacherAuthRateLimitTarget(
  identifier: string,
  lookup: TeacherRateLimitAccountLookup,
): Promise<string> {
  const trimmed = identifier.trim();
  if (!trimmed) return "empty";

  const byInitials = await lookup.findAccountByInitials(trimmed);
  if (byInitials?.id) return byInitials.id;

  const compact = trimmed.toLowerCase().replace(/\s+/g, "");
  const byId = (await lookup.findAccount(trimmed)) ?? (
    compact.startsWith("teacher-") && compact !== trimmed
      ? await lookup.findAccount(compact)
      : null
  );
  if (byId?.id) return byId.id;

  return authRateLimitTargetFromUnknownTeacherIdentifier(trimmed);
}

/**
 * Préfixe de classe uniquement. Le secret du code n’entre jamais dans la clé.
 * Format invalide → seau générique `unparsed` (pas de bypass).
 */
export function authRateLimitTargetFromStudentCode(rawCode: string): string {
  const parsed = parseStudentAccessCode(rawCode);
  if (!parsed) return STUDENT_UNPARSED_RATE_LIMIT_TARGET;
  return sanitizeRateLimitTarget(parsed.prefix);
}

const RATE_LIMIT_ENV_KEYS: Record<AuthRateLimitScope, string> = {
  teacher: "CAMPUS_AUTH_RATE_LIMIT_TEACHER",
  student: "CAMPUS_AUTH_RATE_LIMIT_STUDENT",
  "teacher-password": "CAMPUS_AUTH_RATE_LIMIT_TEACHER_PASSWORD",
  "teacher-mfa": "CAMPUS_AUTH_RATE_LIMIT_TEACHER_MFA",
};

const RATE_LIMIT_TARGET_ENV_KEYS: Record<AuthRateLimitScope, string> = {
  teacher: "CAMPUS_AUTH_RATE_LIMIT_TEACHER_TARGET",
  student: "CAMPUS_AUTH_RATE_LIMIT_STUDENT_TARGET",
  "teacher-password": "CAMPUS_AUTH_RATE_LIMIT_TEACHER_PASSWORD_TARGET",
  "teacher-mfa": "CAMPUS_AUTH_RATE_LIMIT_TEACHER_MFA_TARGET",
};

const RATE_LIMIT_DEFAULTS: Record<AuthRateLimitScope, number> = {
  teacher: AUTH_TEACHER_LIMIT,
  student: AUTH_STUDENT_LIMIT,
  "teacher-password": AUTH_PASSWORD_CHANGE_LIMIT,
  "teacher-mfa": AUTH_MFA_LIMIT,
};

function readPositiveLimit(envKey: string, fallback: number): number {
  const configured = Number(process.env[envKey]);
  if (Number.isFinite(configured) && configured > 0) {
    return configured;
  }
  return fallback;
}

export function resolveAuthRateLimit(scope: AuthRateLimitScope, layer: AuthRateLimitLayer = "ip"): number {
  if (layer === "target") {
    return readPositiveLimit(RATE_LIMIT_TARGET_ENV_KEYS[scope], RATE_LIMIT_DEFAULTS[scope]);
  }
  return readPositiveLimit(RATE_LIMIT_ENV_KEYS[scope], RATE_LIMIT_DEFAULTS[scope]);
}

export function countInMemoryRateLimitBuckets(): number {
  return memoryBuckets.size;
}

/**
 * Retire uniquement les seaux dont `resetAt <= now`.
 * Les seaux encore actifs restent intacts. Ne journalise aucune clé.
 */
export function cleanupExpiredRateLimitBuckets(now = Date.now()): number {
  let removed = 0;
  for (const [key, bucket] of memoryBuckets) {
    if (bucket.resetAt <= now) {
      memoryBuckets.delete(key);
      removed += 1;
    }
  }
  lastCleanupAt = now;
  checksSinceCleanup = 0;
  return removed;
}

function maybeCleanupExpiredRateLimitBuckets(now: number): void {
  checksSinceCleanup += 1;
  if (
    checksSinceCleanup >= MEMORY_RATE_LIMIT_CLEANUP_EVERY_CHECKS
    || now - lastCleanupAt >= MEMORY_RATE_LIMIT_CLEANUP_EVERY_MS
  ) {
    cleanupExpiredRateLimitBuckets(now);
  }
}

/**
 * Place pour une nouvelle clé : cleanup des expirés, puis refus si 8000 seaux actifs.
 * Ne supprime jamais un seau encore valide. Pas de tri.
 */
function canAllocateNewMemoryBucket(now: number): boolean {
  if (memoryBuckets.size < MEMORY_RATE_LIMIT_MAX_BUCKETS) return true;
  cleanupExpiredRateLimitBuckets(now);
  return memoryBuckets.size < MEMORY_RATE_LIMIT_MAX_BUCKETS;
}

/**
 * `false` = compteur individuel dépassé **ou** Map saturée (8000 seaux actifs).
 * Dans les deux cas la route répond 429. Un seau existant n’est jamais évincé.
 */
export function checkInMemoryRateLimit(
  key: string,
  limit: number,
  windowMs = AUTH_RATE_LIMIT_WINDOW_MS,
  now = Date.now(),
): boolean {
  maybeCleanupExpiredRateLimitBuckets(now);
  const bucket = memoryBuckets.get(key);
  if (bucket && now < bucket.resetAt) {
    if (bucket.count >= limit) {
      return false;
    }
    bucket.count += 1;
    return true;
  }
  if (!bucket && !canAllocateNewMemoryBucket(now)) {
    return false;
  }
  memoryBuckets.set(key, { count: 1, resetAt: now + windowMs });
  return true;
}

export function resetInMemoryRateLimits(): void {
  memoryBuckets.clear();
  lastCleanupAt = 0;
  checksSinceCleanup = 0;
}

export function rateLimitKeyLooksSensitive(key: string): boolean {
  const payload = key.replace(/^auth:[a-z-]+:(?:ip|target):/i, "");
  const upper = payload.toUpperCase();
  return (
    /[A-Z0-9]{4}-[A-Z0-9]{4}/.test(upper) ||
    /\b\d{6}\b/.test(payload) ||
    (upper.includes("PASSWORD") && payload.includes("=")) ||
    /CAMPUS-DEMO|RECOVERY|TOTP/.test(upper)
  );
}
