import { attachRequestId, logApiEvent, readRequestId } from "@campus/lib/observability/index.ts";

import { jsonResponse } from "./api.ts";

export interface RouteHandlerContext {
  params?: Promise<Record<string, string>>;
}

/** Accepte les handlers dont `context.params` est plus précis que `Record<string, string>`. */
type ObservabilityHandler = (request: Request, context?: never) => Response | Promise<Response>;

export function withApiObservability<H extends ObservabilityHandler>(route: string, handler: H): H {
  const wrapped = (async (request: Request, context?: Parameters<H>[1]) => {
    const requestId = readRequestId(request);
    const startedAt = performance.now();
    const response = await handler(request, context as never);
    const headers = new Headers(response.headers);
    attachRequestId(headers, requestId);
    logApiEvent({
      requestId,
      route,
      method: request.method,
      status: response.status,
      durationMs: performance.now() - startedAt,
    });
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }) as H;
  return wrapped;
}

export function jsonResponseWithRequestId(request: Request, body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  attachRequestId(headers, readRequestId(request));
  return jsonResponse(body, { ...init, headers });
}
