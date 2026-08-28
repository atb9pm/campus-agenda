import {
  getTeacherAccountsStore,
  jsonResponse,
  requireAdminSession,
} from "../../../../../../lib/server/api.ts";
import { withApiObservability } from "../../../../../../lib/server/observability.ts";

async function handlePost(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const { id } = await context.params;
  const accounts = await getTeacherAccountsStore();
  const result = await accounts.resetPassword(id);
  if (!result.ok) {
    return jsonResponse({ ok: false, reason: result.reason }, { status: result.status });
  }

  return jsonResponse({
    ok: true,
    teacher: result.account,
    temporaryPassword: result.temporaryPassword,
  });
}

export const POST = withApiObservability("/api/admin/teachers/[id]/password", handlePost);
