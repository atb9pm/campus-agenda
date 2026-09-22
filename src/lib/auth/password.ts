/**
 * Mots de passe enseignant : stockage haché uniquement (PBKDF2-SHA-256).
 *
 * Format retenu : `pbkdf2-sha256$<iterations>$<sel base64>$<empreinte base64>`.
 * Les anciens comptes de démonstration portent encore `demo:<mot de passe>` ;
 * ils ne sont acceptés qu'en dehors de la production.
 */

import { DEMO_TEACHER_PASSWORD } from "../../features/teacher-accounts/password-policy.ts";
import { isProductionRuntime } from "./runtime-env.ts";

export {
  checkPasswordStrength,
  DEMO_TEACHER_PASSWORD,
  isDemoTeacherPassword,
  MIN_PASSWORD_LENGTH,
  type PasswordCheck,
} from "../../features/teacher-accounts/password-policy.ts";

const PBKDF2_PREFIX = "pbkdf2-sha256";
const LEGACY_DEMO_PREFIX = "demo:";
/** Nouveaux hashes. Les anciens `pbkdf2-sha256$210000$…` restent vérifiables. */
export const DEFAULT_PBKDF2_ITERATIONS = 600_000;
export const MIN_PRODUCTION_PBKDF2_ITERATIONS = 600_000;
export const MIN_DEV_PBKDF2_ITERATIONS = 10_000;
const SALT_BYTES = 16;
const KEY_BITS = 256;

/** Empreinte héritée de la démonstration, reconnaissable et non sécurisée. */
export function legacyDemoPasswordHash(): string {
  return `${LEGACY_DEMO_PREFIX}${DEMO_TEACHER_PASSWORD}`;
}

export function isLegacyDemoHash(hash: string): boolean {
  return hash.startsWith(LEGACY_DEMO_PREFIX);
}

export function isUsablePasswordHash(hash: string | null | undefined): boolean {
  return Boolean(hash && hash.startsWith(`${PBKDF2_PREFIX}$`));
}

/**
 * Le mot de passe de démonstration reste utile pour les tests et l'aperçu local.
 * En production, un hash `demo:` est TOUJOURS refusé : `CAMPUS_ALLOW_DEMO_PASSWORD=1`
 * ne peut pas réactiver ce mécanisme.
 * Hors production : `CAMPUS_ALLOW_DEMO_PASSWORD=1` l’autorise ; `=0` le refuse ;
 * `NODE_ENV=development` l’accepte si la variable est absente.
 */
export function demoPasswordAllowed(): boolean {
  if (isProductionRuntime()) return false;
  const flag = process.env.CAMPUS_ALLOW_DEMO_PASSWORD;
  if (flag === "1") return true;
  if (flag === "0") return false;
  return process.env.NODE_ENV === "development";
}

export function resolvePbkdf2Iterations(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.CAMPUS_PBKDF2_ITERATIONS ?? "");
  if (isProductionRuntime(env)) {
    if (Number.isInteger(raw) && raw >= MIN_PRODUCTION_PBKDF2_ITERATIONS) return raw;
    return DEFAULT_PBKDF2_ITERATIONS;
  }
  if (Number.isInteger(raw) && raw >= MIN_DEV_PBKDF2_ITERATIONS) return raw;
  return DEFAULT_PBKDF2_ITERATIONS;
}

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as unknown as BufferSource, iterations },
    key,
    KEY_BITS,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string, iterations = resolvePbkdf2Iterations()): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const derived = await derive(password, salt, iterations);
  return `${PBKDF2_PREFIX}$${iterations}$${toBase64(salt)}$${toBase64(derived)}`;
}

export function constantTimeEquals(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

export async function verifyPassword(password: string, storedHash: string | null | undefined): Promise<boolean> {
  if (!storedHash) return false;
  const candidate = password.trim();
  if (!candidate) return false;

  if (isLegacyDemoHash(storedHash)) {
    if (isProductionRuntime()) return false;
    if (!demoPasswordAllowed()) return false;
    return constantTimeEquals(candidate, storedHash.slice(LEGACY_DEMO_PREFIX.length));
  }

  const [prefix, iterationsRaw, saltRaw, hashRaw] = storedHash.split("$");
  if (prefix !== PBKDF2_PREFIX || !iterationsRaw || !saltRaw || !hashRaw) return false;
  const iterations = Number(iterationsRaw);
  if (!Number.isInteger(iterations) || iterations <= 0) return false;

  const derived = await derive(candidate, fromBase64(saltRaw), iterations);
  return constantTimeEquals(toBase64(derived), hashRaw);
}

/** Alphabet sans caractères ambigus : dictable au téléphone sans erreur. */
const TEMPORARY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Mot de passe provisoire lisible, affiché une seule fois à l'administrateur. */
export function generateTemporaryPassword(groups = 3, groupLength = 4): string {
  const total = groups * groupLength;
  const random = crypto.getRandomValues(new Uint8Array(total));
  const characters = Array.from(random, (value) => TEMPORARY_ALPHABET[value % TEMPORARY_ALPHABET.length]);
  const parts: string[] = [];
  for (let index = 0; index < groups; index += 1) {
    parts.push(characters.slice(index * groupLength, (index + 1) * groupLength).join(""));
  }
  return parts.join("-");
}
