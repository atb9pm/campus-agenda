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
    return jsonResponse({ ok: false, reason: result.reason }, { status: result.status });
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
