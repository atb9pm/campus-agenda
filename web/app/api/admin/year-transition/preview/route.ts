import { createAuthorizedYearTransitionPreview } from "@campus/features/year-transition/index.ts";
import { getYearTransitionPrepareDeps } from "@campus/lib/persistence/store-factory.ts";
import { jsonResponse, requireAdminSession } from "../../../../../lib/server/api.ts";
import { withApiObservability } from "../../../../../lib/server/observability.ts";

async function handlePost(request: Request) {
  const auth = await requireAdminSession(request);
  if ("error" in auth && auth.error) return auth.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, reason: "Corps JSON invalide." }, { status: 400 });
  }

  try {
    const result = await createAuthorizedYearTransitionPreview(
      body,
      auth.session!.teacherId,
      await getYearTransitionPrepareDeps(),
    );
    return jsonResponse({
      ok: true,
      copied: false,
      transitionId: result.transitionId,
      blocking: result.blocking,
      preview: result.preview,
    });
  } catch (error) {
    return jsonResponse(
      { ok: false, reason: error instanceof Error ? error.message : "Aperçu impossible." },
      { status: 400 },
    );
  }
}

export const POST = withApiObservability("/api/admin/year-transition/preview", handlePost);
