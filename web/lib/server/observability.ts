import { attachRequestId, logApiEvent, readRequestId } from "@campus/lib/observability/index.ts";

import { jsonResponse } from "./api.ts";

type ApiHandler = (request: Request, context?: unknown) => Response | Promise<Response>;

export function withApiObservability(route: string, handler: ApiHandler): ApiHandler {
  return async (request: Request, context?: unknown) => {
    const requestId = readRequestId(request);
    const startedAt = performance.now();
    const response = await handler(request, context);
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
  };
}

export function jsonResponseWithRequestId(request: Request, body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  attachRequestId(headers, readRequestId(request));
  return jsonResponse(body, { ...init, headers });
}
