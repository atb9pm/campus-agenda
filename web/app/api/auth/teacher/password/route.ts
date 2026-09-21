import {
  getTeacherAccountsStore,
  jsonResponse,
  jsonWithSession,
  requireTeacherSessionAllowingPasswordChange,
} from "../../../../../lib/server/api.ts";
import { enforceAuthRateLimit } from "../../../../../lib/server/rate-limit.ts";

export async function POST(request: Request) {
  const limited = await enforceAuthRateLimit(request, "teacher-password");
  if (limited) return limited;

  const auth = await requireTeacherSessionAllowingPasswordChange(request);
  if ("error" in auth && auth.error) return auth.error;

  const body = await request.json() as {
    currentPassword?: string;
    nextPassword?: string;
    remember?: boolean;
  };
  const previous = auth.session!;
  const accounts = await getTeacherAccountsStore();
  const result = await accounts.changeOwnPassword(
    previous.teacherId,
    String(body.currentPassword ?? ""),
    String(body.nextPassword ?? ""),
  );
  if (!result.ok) {
    return jsonResponse({ ok: false, reason: result.reason }, { status: result.status });
  }

  // Nouveau cookie : les sessions émises avant ce changement sont mortes.
  const session = {
    kind: "teacher" as const,
    teacherId: previous.teacherId,
    issuedAt: Date.now(),
    ...(previous.mfaPending ? { mfaPending: true } : {}),
    ...(previous.mfaRecoveryVerifiedAt ? { mfaRecoveryVerifiedAt: previous.mfaRecoveryVerifiedAt } : {}),
  };
  return jsonWithSession(session, { ok: true }, {}, Boolean(body.remember));
}
