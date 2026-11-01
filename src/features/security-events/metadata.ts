import { SECURITY_EVENT_CATALOG, type SecurityEventType, type SecurityMetadataSpec } from "./catalog.ts";
import type { SecurityMetadata } from "./types.ts";

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{0,15}$/;
const MAX_INT = 1_000_000_000;

/**
 * Motifs qui ressemblent à un secret : code TOTP (6 chiffres), code de
 * récupération / code apprentis (XXXX-XXXX), empreintes ou jetons longs.
 * Une valeur qui correspond est refusée même si son type est valide.
 */
export function looksLikeSecretFragment(value: string): boolean {
  return (
    /(^|[^0-9])\d{6}([^0-9]|$)/.test(value)
    || /(^|[^A-Za-z0-9])[A-Z0-9]{4}-[A-Z0-9]{4}([^A-Za-z0-9]|$)/.test(value)
    || /[A-Za-z0-9+/=_]{32,}/.test(value)
  );
}

export function looksLikeSecret(value: string): boolean {
  return (
    looksLikeSecretFragment(value)
    || /PASSWORD|SECRET|TOKEN|RECOVERY|TOTP|COOKIE|CAMPUS-DEMO|\$/.test(value.toUpperCase())
  );
}

export function isSafeSecurityIdentifier(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value) && !looksLikeSecret(value);
}

function sanitizeValue(spec: SecurityMetadataSpec, value: unknown): string | number | boolean | undefined {
  if (spec === "bool") return typeof value === "boolean" ? value : undefined;
  if (spec === "int") {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return undefined;
    return Math.min(value, MAX_INT);
  }
  if (typeof value !== "string") return undefined;
  if (spec === "id") return isSafeSecurityIdentifier(value) ? value : undefined;
  if (spec === "code") {
    const upper = value.trim().toUpperCase();
    return CODE_PATTERN.test(upper) && !looksLikeSecret(upper) ? upper : undefined;
  }
  return spec.includes(value) ? value : undefined;
}

/**
 * Construit les métadonnées autorisées pour un type d'événement.
 * Toute clé absente du catalogue, tout type inattendu et toute valeur
 * ressemblant à un secret sont silencieusement écartés.
 */
export function sanitizeSecurityMetadata(type: SecurityEventType, input: unknown): SecurityMetadata {
  const schema = SECURITY_EVENT_CATALOG[type].metadata as Readonly<Record<string, SecurityMetadataSpec>>;
  const output: SecurityMetadata = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return output;
  for (const [key, spec] of Object.entries(schema)) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
    const sanitized = sanitizeValue(spec, (input as Record<string, unknown>)[key]);
    if (sanitized !== undefined) output[key] = sanitized;
  }
  return output;
}

/** Chemin d'API sans query string, borné et limité à un jeu de caractères sûr. */
export function sanitizeSecurityRoute(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const path = value.split("?")[0]!.split("#")[0]!;
  if (!path.startsWith("/api/") || path.length > 120) return null;
  if (!/^[A-Za-z0-9/_.[\]-]+$/.test(path)) return null;
  return looksLikeSecretFragment(path) ? null : path;
}

const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

export function sanitizeSecurityMethod(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const upper = value.toUpperCase();
  return HTTP_METHODS.has(upper) ? upper : null;
}

export function sanitizeSecurityStatus(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;

export function sanitizeSecurityRequestId(value: unknown): string | null {
  return typeof value === "string" && REQUEST_ID_PATTERN.test(value) ? value : null;
}
