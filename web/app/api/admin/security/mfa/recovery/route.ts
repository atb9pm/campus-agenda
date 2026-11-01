import { regenerateAdminRecoveryCodesWithPassword } from "@campus/features/admin-mfa/index.ts";
import { getAdminMfaStore } from "@campus/lib/persistence/store-factory.ts";

import { jsonResponse, requireAdminSession } from "../../../../../../lib/server/api.ts";
import { getTeacherAccountsStore } from "../../../../../../lib/server/api.ts";
import { enforceAuthRateLimit } from "../../../../../../lib/server/rate-limit.ts";
import { readBoundedJson } from "../../../../../../lib/server/read-bounded-json.ts";
import { classifyMfaFailure, recordRequestSecurityEvent } from "../../../../../../lib/server/security-events.ts";

export async function POST(request: Request) {
  const auth = await requireAdminSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const limited = await enforceAuthRateLimit(request, "teacher-mfa", auth.session!.teacherId);
  if (limited) return limited;

  const parsed = await readBoundedJson<{ password?: string; totp?: string }>(request);
  if (!parsed.ok) {
    if (parsed.reason === "too-large") {
      return jsonResponse({ ok: false, reason: "Requête trop volumineuse." }, { status: 413 });
    }
    return jsonResponse({ ok: false, reason: "Requête invalide." }, { status: 400 });
  }
  const body = parsed.value;
  const result = await regenerateAdminRecoveryCodesWithPassword(
    await getAdminMfaStore(),
    await getTeacherAccountsStore(),
    auth.session!.teacherId,
    String(body.password ?? ""),
    String(body.totp ?? ""),
  );
  if (!result.ok) {
    const failure = classifyMfaFailure(result.reason);
    if (failure) {
      await recordRequestSecurityEvent(request, {
        type: "MFA_SENSITIVE_ACTION_DENIED",
        actorType: "TEACHER",
        actorId: auth.session!.teacherId,
        httpStatus: result.status,
        metadata: { step: "regenerate-recovery-codes", reason: failure },
        aggregateWindowMinutes: 15,
      });
    }
    return jsonResponse({ ok: false, reason: result.reason }, { status: result.status });
  }
  await recordRequestSecurityEvent(request, {
    type: "MFA_RECOVERY_CODES_REGENERATED",
    actorType: "TEACHER",
    actorId: auth.session!.teacherId,
    httpStatus: 200,
  });
  return jsonResponse({ ok: true, recoveryCodes: result.recoveryCodes });
}
