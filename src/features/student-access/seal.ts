import { getAuthSecret } from "../../lib/auth/config.ts";

const SEAL_PREFIX = "aes-gcm-v1";
const INFO = "campus-agenda/student-access-code";

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

async function sealingKey(): Promise<CryptoKey> {
  const material = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${INFO}\0${getAuthSecret()}`),
  );
  return crypto.subtle.importKey("raw", material, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** Chiffre le code courant pour l’affichage enseignant. L’auth élève reste le hash PBKDF2. */
export async function sealStudentAccessCode(code: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await sealingKey();
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(code),
  );
  return `${SEAL_PREFIX}$${toBase64(iv)}$${toBase64(new Uint8Array(sealed))}`;
}

export async function unsealStudentAccessCode(sealed: string | null | undefined): Promise<string | null> {
  if (!sealed) return null;
  const [prefix, ivRaw, payloadRaw] = sealed.split("$");
  if (prefix !== SEAL_PREFIX || !ivRaw || !payloadRaw) return null;
  try {
    const key = await sealingKey();
    const opened = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(ivRaw) as BufferSource },
      key,
      fromBase64(payloadRaw) as BufferSource,
    );
    const code = new TextDecoder().decode(opened).trim();
    return code || null;
  } catch {
    return null;
  }
}

export function isSealedStudentAccessCode(value: string | null | undefined): boolean {
  return Boolean(value && value.startsWith(`${SEAL_PREFIX}$`));
}
