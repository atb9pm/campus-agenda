import {
  getTeacherAccountsStore,
  jsonResponse,
  requireTeacherSessionAllowingPasswordChange,
} from "../../../../../lib/server/api.ts";
import { enforceAuthRateLimit } from "../../../../../lib/server/rate-limit.ts";

export async function POST(request: Request) {
  const limited = await enforceAuthRateLimit(request, "teacher-password");
  if (limited) return limited;

  const auth = await requireTeacherSessionAllowingPasswordChange(request);
  if ("error" in auth && auth.error) return auth.error;

  const body = await request.json() as { currentPassword?: string; nextPassword?: string };
  const accounts = await getTeacherAccountsStore();
  const result = await accounts.changeOwnPassword(
    auth.session!.teacherId,
    String(body.currentPassword ?? ""),
    String(body.nextPassword ?? ""),
  );
  if (!result.ok) {
    return jsonResponse({ ok: false, reason: result.reason }, { status: result.status });
  }
  return jsonResponse({ ok: true });
}
