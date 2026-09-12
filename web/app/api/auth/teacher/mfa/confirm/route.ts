import { confirmAdminMfaEnrollment } from "@campus/features/admin-mfa/index.ts";
import { getAdminMfaStore } from "@campus/lib/persistence/store-factory.ts";

import {
  jsonResponse,
  jsonWithSession,
  requireAdminMfaPendingSession,
} from "../../../../../../lib/server/api.ts";
import { buildTeacherClientSession } from "../../../../../../lib/server/teacher-session.ts";
import { enforceAuthRateLimit } from "../../../../../../lib/server/rate-limit.ts";

export async function POST(request: Request) {
  const auth = await requireAdminMfaPendingSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const limited = await enforceAuthRateLimit(request, "teacher-mfa", auth.session!.teacherId);
  if (limited) return limited;

  const body = await request.json() as { code?: string; remember?: boolean };
  const result = await confirmAdminMfaEnrollment(
    await getAdminMfaStore(),
    auth.session!.teacherId,
    String(body.code ?? ""),
  );
  if (!result.ok) {
    return jsonResponse({ ok: false, reason: result.reason }, { status: result.status });
  }

  const session = { kind: "teacher" as const, teacherId: auth.session!.teacherId, issuedAt: Date.now() };
  return jsonWithSession(
    session,
    {
      ok: true,
      recoveryCodes: result.recoveryCodes,
      session: await buildTeacherClientSession(session.teacherId, session),
    },
    {},
    Boolean(body.remember),
  );
}
