/**
 * Chiffrement authentifié du secret TOTP (AES-256-GCM).
 * Clé : CAMPUS_MFA_ENCRYPTION_KEY (32 octets, hex 64 ou base64).
 * Hors production, dérivation depuis AUTH_SECRET si la clé dédiée est absente.
 */

import { getAuthSecret } from "./config.ts";

export const MFA_KEY_ENV = "CAMPUS_MFA_ENCRYPTION_KEY";
export const MFA_REQUIRE_KEY_ENV = "CAMPUS_MFA_REQUIRE_KEY";
export const MFA_SEAL_PREFIX = "aes-gcm-v1";
const MFA_KEY_INFO = "campus-agenda/admin-mfa";

export class MfaKeyUnavailableError extends Error {
  constructor(message = "CAMPUS_MFA_ENCRYPTION_KEY est absente ou invalide.") {
    super(message);
    this.name = "MfaKeyUnavailableError";
  }
}

export function isMfaKeyRequired(): boolean {
  if (process.env[MFA_REQUIRE_KEY_ENV] === "1") return true;
  return process.env.NODE_ENV === "production";
}

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

/** 32 octets : 64 hex ou base64. */
export function parseMfaEncryptionKey(raw: string | undefined | null): Uint8Array | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value) return null;
  if (/^[0-9a-fA-F]{64}$/.test(value)) return hexToBytes(value);
  try {
    const bytes = fromBase64(value);
    return bytes.length === 32 ? bytes : null;
  } catch {
    return null;
  }
}

export function hasExplicitMfaEncryptionKey(): boolean {
  return parseMfaEncryptionKey(process.env[MFA_KEY_ENV]) !== null;
}

/** Production : clé dédiée obligatoire. Jamais de contournement. */
export function isMfaEncryptionReady(): boolean {
  if (hasExplicitMfaEncryptionKey()) return true;
  return !isMfaKeyRequired();
}

export async function resolveMfaEncryptionKey(): Promise<Uint8Array> {
  const explicit = parseMfaEncryptionKey(process.env[MFA_KEY_ENV]);
  if (explicit) return explicit;
  if (isMfaKeyRequired()) {
    throw new MfaKeyUnavailableError();
  }
  const material = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${MFA_KEY_INFO}\0${getAuthSecret()}`),
  );
  return new Uint8Array(material);
}

async function importAesKey(): Promise<CryptoKey> {
  const raw = await resolveMfaEncryptionKey();
  return crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptTotpSecret(secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await importAesKey();
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(secret),
  );
  return `${MFA_SEAL_PREFIX}$${toBase64(iv)}$${toBase64(new Uint8Array(sealed))}`;
}

export async function decryptTotpSecret(sealed: string | null | undefined): Promise<string> {
  if (!sealed) {
    throw new MfaKeyUnavailableError("Secret TOTP introuvable.");
  }
  const [prefix, ivRaw, payloadRaw] = sealed.split("$");
  if (prefix !== MFA_SEAL_PREFIX || !ivRaw || !payloadRaw) {
    throw new MfaKeyUnavailableError("Secret TOTP illisible.");
  }
  try {
    const key = await importAesKey();
    const opened = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(ivRaw) as BufferSource },
      key,
      fromBase64(payloadRaw) as BufferSource,
    );
    const secret = new TextDecoder().decode(opened).trim();
    if (!secret) throw new MfaKeyUnavailableError("Secret TOTP vide.");
    return secret;
  } catch (error) {
    if (error instanceof MfaKeyUnavailableError) throw error;
    throw new MfaKeyUnavailableError("Impossible de déchiffrer le secret TOTP.");
  }
}

export function looksLikeEncryptedTotpSecret(value: string | null | undefined): boolean {
  return Boolean(value && value.startsWith(`${MFA_SEAL_PREFIX}$`));
}

export async function hashRecoveryCode(code: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const digest = await digestRecovery(code, salt);
  return `sha256$${toBase64(salt)}$${toBase64(digest)}`;
}

export async function recoveryCodeMatches(code: string, stored: string): Promise<boolean> {
  const [prefix, saltRaw, digestRaw] = stored.split("$");
  if (prefix !== "sha256" || !saltRaw || !digestRaw) return false;
  try {
    const digest = await digestRecovery(code, fromBase64(saltRaw));
    return constantTimeBytesEqual(digest, fromBase64(digestRaw));
  } catch {
    return false;
  }
}

async function digestRecovery(code: string, salt: Uint8Array): Promise<Uint8Array> {
  const key = await resolveMfaEncryptionKey();
  const normalized = new TextEncoder().encode(code);
  const payload = new Uint8Array(salt.length + normalized.length + key.length + 2);
  payload.set(salt, 0);
  payload[salt.length] = 0;
  payload.set(normalized, salt.length + 1);
  payload[salt.length + 1 + normalized.length] = 0;
  payload.set(key, salt.length + 2 + normalized.length);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", payload));
}

function constantTimeBytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left[index]! ^ right[index]!;
  }
  return diff === 0;
}
