import {
  getTeacherAccountsStore,
  jsonResponse,
  requireAdminSession,
} from "../../../../lib/server/api.ts";
import { withApiObservability } from "../../../../lib/server/observability.ts";

async function handleGet(request: Request) {
  const auth = await requireAdminSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const accounts = await getTeacherAccountsStore();
  return jsonResponse({ ok: true, teachers: await accounts.listAccounts() });
}

async function handlePost(request: Request) {
  const auth = await requireAdminSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const body = (await request.json()) as {
    displayName?: string;
    initials?: string;
    isAdmin?: boolean;
  };

  const accounts = await getTeacherAccountsStore();
  const result = await accounts.createAccount({
    displayName: String(body.displayName ?? ""),
    initials: String(body.initials ?? ""),
    isAdmin: Boolean(body.isAdmin),
  });
  if (!result.ok) {
    return jsonResponse({ ok: false, reason: result.reason }, { status: result.status });
  }

  // Le mot de passe provisoire n'est renvoyé qu'ici : l'administrateur le
  // transmet de vive voix, aucune trace n'est conservée en clair.
  return jsonResponse({
    ok: true,
    teacher: result.account,
    temporaryPassword: result.temporaryPassword,
  });
}

export const GET = withApiObservability("/api/admin/teachers", handleGet);
export const POST = withApiObservability("/api/admin/teachers", handlePost);
