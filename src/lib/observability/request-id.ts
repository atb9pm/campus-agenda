const REQUEST_ID_HEADER = "x-request-id";

export function createRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function readRequestId(request: Request): string {
  return request.headers.get(REQUEST_ID_HEADER)?.trim() || createRequestId();
}

export function attachRequestId(headers: Headers, requestId: string) {
  headers.set(REQUEST_ID_HEADER, requestId);
}

export { REQUEST_ID_HEADER };
