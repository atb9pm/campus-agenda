const REQUEST_ID_HEADER = "x-request-id";
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;

/** Un même Request garde le même identifiant : log API et journal de sécurité restent corrélables. */
const requestIds = new WeakMap<Request, string>();

export function createRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** En-tête client accepté seulement s'il est court et sans caractère de contrôle (injection de logs). */
export function readRequestId(request: Request): string {
  const cached = requestIds.get(request);
  if (cached) return cached;
  const header = request.headers.get(REQUEST_ID_HEADER)?.trim();
  const requestId = header && REQUEST_ID_PATTERN.test(header) ? header : createRequestId();
  requestIds.set(request, requestId);
  return requestId;
}

export function attachRequestId(headers: Headers, requestId: string) {
  headers.set(REQUEST_ID_HEADER, requestId);
}

export { REQUEST_ID_HEADER };
