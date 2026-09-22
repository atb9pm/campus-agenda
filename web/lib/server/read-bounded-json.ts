/** Corps d’authentification : identifiants minuscules. Ne pas se fier au seul Content-Length. */
export const AUTH_BODY_MAX_BYTES = 8 * 1024;

export type BoundedJsonResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "too-large" | "invalid-json" };

async function readBoundedBytes(request: Request, maxBytes: number): Promise<BoundedJsonResult<Uint8Array>> {
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, reason: "too-large" };
  }

  const reader = request.body?.getReader();
  if (!reader) {
    return { ok: true, value: new Uint8Array() };
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return { ok: false, reason: "too-large" };
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, value: bytes };
}

export async function readBoundedJson<T>(
  request: Request,
  maxBytes = AUTH_BODY_MAX_BYTES,
): Promise<BoundedJsonResult<T>> {
  const bytes = await readBoundedBytes(request, maxBytes);
  if (!bytes.ok) return bytes;
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes.value)) as T };
  } catch {
    return { ok: false, reason: "invalid-json" };
  }
}
