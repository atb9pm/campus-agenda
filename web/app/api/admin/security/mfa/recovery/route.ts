import { regenerateAdminRecoveryCodesWithPassword } from "@campus/features/admin-mfa/index.ts";
import { getAdminMfaStore } from "@campus/lib/persistence/store-factory.ts";

import { jsonResponse, requireAdminSession } from "../../../../../../lib/server/api.ts";
import { getTeacherAccountsStore } from "../../../../../../lib/server/api.ts";
import { enforceAuthRateLimit } from "../../../../../../lib/server/rate-limit.ts";

export async function POST(request: Request) {
  const auth = await requireAdminSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const limited = await enforceAuthRateLimit(request, "teacher-mfa", auth.session!.teacherId);
  if (limited) return limited;

  const body = await request.json() as { password?: string; totp?: string };
  const result = await regenerateAdminRecoveryCodesWithPassword(
    await getAdminMfaStore(),
    await getTeacherAccountsStore(),
    auth.session!.teacherId,
    String(body.password ?? ""),
    String(body.totp ?? ""),
  );
  if (!result.ok) {
    return jsonResponse({ ok: false, reason: result.reason }, { status: result.status });
  }
  return jsonResponse({ ok: true, recoveryCodes: result.recoveryCodes });
}
