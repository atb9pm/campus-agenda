import { startAdminMfaReconfigure } from "@campus/features/admin-mfa/index.ts";
import { getAdminMfaStore } from "@campus/lib/persistence/store-factory.ts";

import { jsonResponse, requireAdminSession } from "../../../../../../lib/server/api.ts";
import { getTeacherAccountsStore } from "../../../../../../lib/server/api.ts";
import { enforceAuthRateLimit } from "../../../../../../lib/server/rate-limit.ts";

export async function POST(request: Request) {
  const auth = await requireAdminSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const limited = await enforceAuthRateLimit(request, "teacher-mfa", auth.session!.teacherId);
  if (limited) return limited;

  const body = await request.json() as { totp?: string; recoveryCode?: string };
  const proof = String(body.totp ?? body.recoveryCode ?? "");
  const accounts = await getTeacherAccountsStore();
  const account = await accounts.findAccount(auth.session!.teacherId);
  const result = await startAdminMfaReconfigure(
    await getAdminMfaStore(),
    auth.session!.teacherId,
    account?.initials ?? account?.displayName ?? "admin",
    proof,
  );
  if (!result.ok) {
    return jsonResponse({ ok: false, reason: result.reason }, { status: result.status });
  }
  return jsonResponse({
    ok: true,
    otpauthUri: result.otpauthUri,
    qrDataUrl: result.qrDataUrl,
    manualKey: result.manualKey,
  });
}
