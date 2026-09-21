/**
 * En-têtes navigateur appliqués à toutes les réponses (HTML + API).
 * CSP assez souple pour vinext (scripts/styles inline) et IBM Plex (Google Fonts).
 */
export const SECURITY_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export function securityHeaderEntries(): Array<[string, string]> {
  const headers: Array<[string, string]> = [
    ["Content-Security-Policy", SECURITY_CSP],
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

export function applySecurityHeaders(headers: Headers): Headers {
  for (const [name, value] of securityHeaderEntries()) {
    if (!headers.has(name)) headers.set(name, value);
  }
  return headers;
}

export function withSecurityHeaders(response: Response): Response {
  const headers = applySecurityHeaders(new Headers(response.headers));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
