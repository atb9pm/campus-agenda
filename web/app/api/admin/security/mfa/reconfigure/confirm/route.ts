import { confirmAdminMfaReconfigure } from "@campus/features/admin-mfa/index.ts";
import { getAdminMfaStore } from "@campus/lib/persistence/store-factory.ts";

import { jsonResponse, requireAdminSession } from "../../../../../../../lib/server/api.ts";
import { enforceAuthRateLimit } from "../../../../../../../lib/server/rate-limit.ts";
import { readBoundedJson } from "../../../../../../../lib/server/read-bounded-json.ts";

export async function POST(request: Request) {
  const auth = await requireAdminSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const limited = await enforceAuthRateLimit(request, "teacher-mfa", auth.session!.teacherId);
  if (limited) return limited;

  const parsed = await readBoundedJson<{ code?: string }>(request);
  if (!parsed.ok) {
    if (parsed.reason === "too-large") {
      return jsonResponse({ ok: false, reason: "Requête trop volumineuse." }, { status: 413 });
    }
    return jsonResponse({ ok: false, reason: "Requête invalide." }, { status: 400 });
  }
  const body = parsed.value;
  const result = await confirmAdminMfaReconfigure(
    await getAdminMfaStore(),
    auth.session!.teacherId,
    String(body.code ?? ""),
  );
  if (!result.ok) {
    return jsonResponse({ ok: false, reason: result.reason }, { status: result.status });
  }
  return jsonResponse({ ok: true, recoveryCodes: result.recoveryCodes });
}
