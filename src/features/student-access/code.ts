/** Alphabet sans caractères ambigus (0/O, 1/I/L). */
export const STUDENT_ACCESS_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const SECRET_GROUP_LENGTH = 4;
const SECRET_GROUP_COUNT = 2;
const SECRET_LENGTH = SECRET_GROUP_LENGTH * SECRET_GROUP_COUNT;

export interface ParsedStudentAccessCode {
  prefix: string;
  secret: string;
  canonical: string;
}

export function normalizeStudentAccessCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

/** Compare MECAUTO 3A et MECAUTO3A comme le même code de classe. */
export function compactClassCodeKey(code: string): string {
  return normalizeStudentAccessCode(code).replace(/[^A-Z0-9]/g, "");
}

function isAlphabetChar(char: string): boolean {
  return STUDENT_ACCESS_ALPHABET.includes(char);
}

function isSecretGroup(part: string): boolean {
  return part.length === SECRET_GROUP_LENGTH && [...part].every(isAlphabetChar);
}

function groupSecret(secret: string): string {
  const groups: string[] = [];
  for (let index = 0; index < secret.length; index += SECRET_GROUP_LENGTH) {
    groups.push(secret.slice(index, index + SECRET_GROUP_LENGTH));
  }
  return groups.join("-");
}

export function canonicalStudentAccessCode(prefix: string, secret: string): string {
  const normalizedPrefix = normalizeStudentAccessCode(prefix);
  const normalizedSecret = normalizeStudentAccessCode(secret).replace(/-/g, "");
  return `${normalizedPrefix}-${groupSecret(normalizedSecret)}`;
}

function parseHyphenated(normalized: string): ParsedStudentAccessCode | null {
  const parts = normalized.split("-").filter(Boolean);
  if (parts.length < SECRET_GROUP_COUNT + 1) return null;
  const secretParts = parts.slice(-SECRET_GROUP_COUNT);
  if (!secretParts.every(isSecretGroup)) return null;
  const prefixParts = parts.slice(0, -SECRET_GROUP_COUNT);
  if (prefixParts.length === 0) return null;
  const prefix = prefixParts.join("-");
  const secret = secretParts.join("");
  return { prefix, secret, canonical: canonicalStudentAccessCode(prefix, secret) };
}

function parseCompact(normalized: string): ParsedStudentAccessCode | null {
  const compact = normalized.replace(/-/g, "");
  if (compact.length <= SECRET_LENGTH) return null;
  const secret = compact.slice(-SECRET_LENGTH);
  const prefix = compact.slice(0, -SECRET_LENGTH);
  if (!prefix || ![...secret].every(isAlphabetChar)) return null;
  return { prefix, secret, canonical: canonicalStudentAccessCode(prefix, secret) };
}

/**
 * Extrait le préfixe de classe depuis la fin du code (les groupes secrets)
 * afin de tolérer un code de classe qui contient déjà des tirets.
 */
export function parseStudentAccessCode(raw: string): ParsedStudentAccessCode | null {
  const normalized = normalizeStudentAccessCode(raw);
  if (!normalized) return null;
  return parseHyphenated(normalized) ?? parseCompact(normalized);
}

export function generateStudentAccessSecret(length = SECRET_LENGTH): string {
  const size = Math.max(length, SECRET_LENGTH);
  const random = crypto.getRandomValues(new Uint8Array(size));
  return Array.from(random, (value) => STUDENT_ACCESS_ALPHABET[value % STUDENT_ACCESS_ALPHABET.length]).join("");
}

export function generateStudentAccessCode(classCode: string): string {
  const prefix = normalizeStudentAccessCode(classCode);
  if (!prefix) {
    throw new Error("Le code de classe est requis pour générer un accès apprentis.");
  }
  return canonicalStudentAccessCode(prefix, generateStudentAccessSecret());
}
