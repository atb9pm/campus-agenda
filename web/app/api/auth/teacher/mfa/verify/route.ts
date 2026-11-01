import { verifyAdminMfaChallenge } from "@campus/features/admin-mfa/index.ts";
import { getAdminMfaStore } from "@campus/lib/persistence/store-factory.ts";

import {
  jsonResponse,
  jsonWithSession,
  requireAdminMfaPendingSession,
} from "../../../../../../lib/server/api.ts";
import { buildTeacherClientSession } from "../../../../../../lib/server/teacher-session.ts";
import { enforceAuthRateLimit } from "../../../../../../lib/server/rate-limit.ts";
import { readBoundedJson } from "../../../../../../lib/server/read-bounded-json.ts";
import { classifyMfaFailure, recordRequestSecurityEvent } from "../../../../../../lib/server/security-events.ts";

export async function POST(request: Request) {
  const auth = await requireAdminMfaPendingSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const limited = await enforceAuthRateLimit(request, "teacher-mfa", auth.session!.teacherId);
  if (limited) return limited;

  const parsed = await readBoundedJson<{ code?: string; remember?: boolean }>(request);
  if (!parsed.ok) {
    if (parsed.reason === "too-large") {
      return jsonResponse({ ok: false, reason: "Requête trop volumineuse." }, { status: 413 });
    }
    return jsonResponse({ ok: false, reason: "Requête invalide." }, { status: 400 });
  }
  const body = parsed.value;
  const result = await verifyAdminMfaChallenge(
    await getAdminMfaStore(),
    auth.session!.teacherId,
    String(body.code ?? ""),
  );
  if (!result.ok) {
    if (classifyMfaFailure(result.reason) === "wrong-code") {
      await recordRequestSecurityEvent(request, {
        type: "MFA_VERIFY_FAILED",
        actorType: "TEACHER",
        actorId: auth.session!.teacherId,
        httpStatus: result.status,
        metadata: { step: "login-challenge" },
        aggregateWindowMinutes: 15,
      });
    }
    return jsonResponse(
      {
        ok: false,
        reason: result.reason,
        ...(result.mfaSetupRequired ? { mfaSetupRequired: true } : {}),
      },
      { status: result.status },
    );
  }

  await recordRequestSecurityEvent(request, {
    type: "MFA_VERIFY_SUCCEEDED",
    actorType: "TEACHER",
    actorId: auth.session!.teacherId,
    httpStatus: 200,
    metadata: { usedRecovery: result.usedRecovery },
  });
  if (result.usedRecovery) {
    const remaining = (await (await getAdminMfaStore()).get(auth.session!.teacherId))?.recoveryHashes.length;
    await recordRequestSecurityEvent(request, {
      type: "MFA_RECOVERY_CODE_USED",
      actorType: "TEACHER",
      actorId: auth.session!.teacherId,
      httpStatus: 200,
      metadata: { context: "login-challenge", ...(remaining === undefined ? {} : { recoveryRemaining: remaining }) },
    });
  }

  const now = Date.now();
  const session = {
    kind: "teacher" as const,
    teacherId: auth.session!.teacherId,
    issuedAt: now,
    ...(result.usedRecovery ? { mfaRecoveryVerifiedAt: now } : {}),
  };
  return jsonWithSession(
    session,
    {
      ok: true,
      session: await buildTeacherClientSession(session.teacherId, session),
    },
    {},
    Boolean(body.remember),
  );
}
