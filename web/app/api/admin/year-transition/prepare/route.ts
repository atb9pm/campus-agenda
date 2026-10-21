import { loadYearTransitionPrepareState } from "@campus/features/year-transition/index.ts";
import { getYearTransitionPrepareDeps } from "@campus/lib/persistence/store-factory.ts";
import { jsonResponse, requireAdminSession } from "../../../../../lib/server/api.ts";
import { withApiObservability } from "../../../../../lib/server/observability.ts";

async function handleGet(request: Request) {
  const auth = await requireAdminSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const payload = await loadYearTransitionPrepareState(
    await getYearTransitionPrepareDeps(),
    auth.session!.teacherId,
  );
  return jsonResponse({ ok: true, ...payload });
}

export const GET = withApiObservability("/api/admin/year-transition/prepare", handleGet);
