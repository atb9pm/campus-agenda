import { NextResponse } from "next/server";

import { applySecurityHeaders, buildSecurityCsp, createRequestNonce } from "@campus/lib/security/http-headers.ts";

/**
 * vinext (Next.js 16) : `proxy.ts` remplace `middleware.ts`.
 * Pose un nonce CSP sur la requête pour que le moteur RSC l’applique aux
 * scripts inline, puis le republie sur la réponse HTML.
 */
export function proxy(request: Request) {
  const scriptNonce = createRequestNonce();
  const csp = buildSecurityCsp({ scriptNonce });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  applySecurityHeaders(response.headers, { scriptNonce });
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|branding/|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico)$).*)"],
};
