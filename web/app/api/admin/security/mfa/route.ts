import { adminMfaStatusView, loadAdminMfa } from "@campus/features/admin-mfa/index.ts";
import { getAdminMfaStore } from "@campus/lib/persistence/store-factory.ts";

import { jsonResponse, requireAdminSession } from "../../../../../lib/server/api.ts";

export async function GET(request: Request) {
  const auth = await requireAdminSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const record = await loadAdminMfa(await getAdminMfaStore(), auth.session!.teacherId);
  const view = adminMfaStatusView(record);
  return jsonResponse({
    ok: true,
    status: view.status,
    enabled: view.enabled,
    recoveryRemaining: view.recoveryRemaining,
  });
}
