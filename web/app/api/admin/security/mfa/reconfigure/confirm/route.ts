import { confirmAdminMfaReconfigure } from "@campus/features/admin-mfa/index.ts";
import { getAdminMfaStore } from "@campus/lib/persistence/store-factory.ts";

import { jsonResponse, requireAdminSession } from "../../../../../../../lib/server/api.ts";
import { enforceAuthRateLimit } from "../../../../../../../lib/server/rate-limit.ts";

export async function POST(request: Request) {
  const auth = await requireAdminSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const limited = await enforceAuthRateLimit(request, "teacher-mfa", auth.session!.teacherId);
  if (limited) return limited;

  const body = await request.json() as { code?: string };
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
