/**
 * CSRF : cookie `SameSite=Lax` + JSON same-origin.
 *
 * Lax bloque déjà un POST cross-site avec cookie. On ajoute Origin / Host et
 * Sec-Fetch-Site pour les écritures authentifiées (y compris
 * `DELETE /api/auth/session`) et les lectures admin sensibles (sauvegarde),
 * sans jeton CSRF dédié.
 */
export const UNTRUSTED_ORIGIN_REASON = "Origine de la requête refusée.";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function requestHost(request: Request): string | null {
  const header = request.headers.get("host")?.trim();
  if (header) return header.toLowerCase();
  try {
    return new URL(request.url).host.toLowerCase();
  } catch {
    return null;
  }
}

export function originMatchesRequestHost(origin: string, request: Request): boolean {
  const host = requestHost(request);
  if (!host) return false;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    return parsed.host.toLowerCase() === host;
  } catch {
    return false;
  }
}

export function readSecFetchSite(request: Request): string | null {
  return request.headers.get("sec-fetch-site")?.trim().toLowerCase() || null;
}

export function isCrossSiteRequest(request: Request): boolean {
  const site = readSecFetchSite(request);
  if (site === "cross-site" || site === "cross-origin") return true;
  const origin = request.headers.get("origin")?.trim();
  if (origin && origin !== "null" && !originMatchesRequestHost(origin, request)) {
    return true;
  }
  return false;
}

/** Écritures : Origin externe ou Sec-Fetch-Site cross-site → refuser. Origin absente (tests, curl) : accepter. */
export function isTrustedWriteOrigin(request: Request): boolean {
  if (!MUTATING_METHODS.has(request.method.toUpperCase())) return true;
  return !isCrossSiteRequest(request);
}

/** Lectures admin exportables (backup, export année) : même règle que les écritures. */
export function isTrustedSensitiveRead(request: Request): boolean {
  return !isCrossSiteRequest(request);
}
