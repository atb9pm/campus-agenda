/**
 * En-têtes navigateur appliqués à toutes les réponses (HTML + API).
 *
 * script-src : pas de `unsafe-inline` ni `unsafe-eval`.
 * vinext / React RSC injecte des scripts inline par requête (hydratation, payload).
 * Un nonce cryptographique est donc posé sur la requête (proxy + worker) pour que
 * vinext l’applique aux balises <script> ; `strict-dynamic` autorise ensuite
 * uniquement les scripts chargés par un script déjà noncé.
 *
 * style-src conserve `unsafe-inline` : CSS Tailwind, styles vinext/fonts, et
 * @import IBM Plex (Google Fonts). Un nonce style casserait le rendu actuel.
 */
const CSP_STYLE_AND_ASSETS = [
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
] as const;

function scriptSrcDirective(scriptNonce?: string): string {
  if (scriptNonce) {
    return `script-src 'self' 'nonce-${scriptNonce}' 'strict-dynamic'`;
  }
  // Hors HTML noncé : API JSON et assets. En dev vinext, HMR peut encore
  // injecter un bootstrap inline sans nonce — uniquement hors production.
  if (process.env.NODE_ENV !== "production") {
    return "script-src 'self' 'unsafe-inline'";
  }
  return "script-src 'self'";
}

/** Politique de production sans nonce (réponses API, fallback). */
export const SECURITY_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  ...CSP_STYLE_AND_ASSETS,
].join("; ");

export function createRequestNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function buildSecurityCsp(options: { scriptNonce?: string } = {}): string {
  return ["default-src 'self'", scriptSrcDirective(options.scriptNonce), ...CSP_STYLE_AND_ASSETS].join("; ");
}

export function securityHeaderEntries(options: { scriptNonce?: string } = {}): Array<[string, string]> {
  const headers: Array<[string, string]> = [
    ["Content-Security-Policy", buildSecurityCsp(options)],
    ["X-Frame-Options", "DENY"],
    ["X-Content-Type-Options", "nosniff"],
    ["Referrer-Policy", "strict-origin-when-cross-origin"],
    ["Permissions-Policy", "camera=(), microphone=(), geolocation=()"],
  ];
  if (process.env.NODE_ENV === "production") {
    headers.push(["Strict-Transport-Security", "max-age=31536000; includeSubDomains"]);
  }
  return headers;
}

export function applySecurityHeaders(headers: Headers, options: { scriptNonce?: string } = {}): Headers {
  if (options.scriptNonce) {
    headers.set("Content-Security-Policy", buildSecurityCsp({ scriptNonce: options.scriptNonce }));
  }
  for (const [name, value] of securityHeaderEntries(options.scriptNonce ? { scriptNonce: options.scriptNonce } : {})) {
    if (!headers.has(name)) headers.set(name, value);
  }
  return headers;
}

export function withSecurityHeaders(response: Response, options: { scriptNonce?: string } = {}): Response {
  const headers = applySecurityHeaders(new Headers(response.headers), options);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function extractScriptNonceFromCsp(csp: string | null | undefined): string | null {
  if (!csp) return null;
  const match = csp.match(/'nonce-([A-Za-z0-9+/=_-]+)'/);
  return match?.[1] ?? null;
}
