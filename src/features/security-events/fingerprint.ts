/**
 * Empreinte pseudonymisée d'une source réseau.
 *
 * HMAC-SHA256(clé serveur, contexte + IP) tronqué à 64 bits, en hexadécimal
 * majuscule. Sans la clé serveur, l'empreinte ne permet pas de retrouver l'IP ;
 * avec la même clé, la même IP donne toujours la même empreinte (« même source »).
 * L'adresse IP brute n'est jamais persistée par le journal de sécurité.
 */
export const SOURCE_FINGERPRINT_CONTEXT = "campus-agenda:security-source:v1:";
export const SOURCE_FINGERPRINT_HEX_LENGTH = 16;

const FINGERPRINT_PATTERN = /^[0-9A-F]{16}$/;

const keyCache = new Map<string, Promise<CryptoKey>>();

function importKey(secret: string): Promise<CryptoKey> {
  let cached = keyCache.get(secret);
  if (!cached) {
    cached = crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(`${SOURCE_FINGERPRINT_CONTEXT}${secret}`),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    keyCache.clear();
    keyCache.set(secret, cached);
  }
  return cached;
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
}

/** `null` si l'adresse est inconnue : aucune empreinte partagée « unknown ». */
export async function computeSourceFingerprint(clientIp: string | null | undefined, secret: string): Promise<string | null> {
  const ip = clientIp?.trim().toLowerCase();
  if (!ip || ip === "unknown" || !secret) return null;
  const key = await importKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${SOURCE_FINGERPRINT_CONTEXT}${ip}`));
  return toHex(signature).slice(0, SOURCE_FINGERPRINT_HEX_LENGTH);
}

export function isSourceFingerprint(value: unknown): value is string {
  return typeof value === "string" && FINGERPRINT_PATTERN.test(value);
}

/** Affichage court : `7F2A…91C4`. */
export function formatSourceFingerprint(value: string | null | undefined): string | null {
  if (!isSourceFingerprint(value)) return null;
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}
