export { DEMO_TEACHER_PASSWORD, isDemoTeacherPassword } from "./password.ts";

/** Minimum de secret effectif (octets UTF-8) en production. */
export const AUTH_SECRET_MIN_BYTES = 32;
/** Valeur fictive hors production uniquement — jamais acceptée si NODE_ENV=production. */
export const DEV_FALLBACK_AUTH_SECRET = "dev-only-campus-agenda-secret";

export const AUTH_SECRET_MISSING_PRODUCTION =
  "AUTH_SECRET est requis en production.";
export const AUTH_SECRET_WEAK_PRODUCTION =
  `AUTH_SECRET est trop faible en production (minimum ${AUTH_SECRET_MIN_BYTES} octets). Générez 48 ou 64 caractères aléatoires, par exemple : openssl rand -base64 48`;

export function authSecretByteLength(secret: string): number {
  return new TextEncoder().encode(secret).length;
}

/**
 * Production : secret présent et ≥ 32 octets. Ne jamais logger ni renvoyer la valeur.
 * Pas de règle artificielle majuscule/minuscule/chiffre : un secret aléatoire suffit.
 */
export function assertProductionAuthSecret(secret: string | undefined | null): string {
  const trimmed = secret?.trim() ?? "";
  if (!trimmed) {
    throw new Error(AUTH_SECRET_MISSING_PRODUCTION);
  }
  if (authSecretByteLength(trimmed) < AUTH_SECRET_MIN_BYTES) {
    throw new Error(AUTH_SECRET_WEAK_PRODUCTION);
  }
  return trimmed;
}

export function getAuthSecret(): string {
  const secret = process.env.AUTH_SECRET?.trim();
  if (process.env.NODE_ENV === "production") {
    return assertProductionAuthSecret(secret);
  }
  return secret || DEV_FALLBACK_AUTH_SECRET;
}
