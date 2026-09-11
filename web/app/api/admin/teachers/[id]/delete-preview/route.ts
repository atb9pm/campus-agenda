import { loadTeacherDeleteDeps, previewTeacherDelete } from "@campus/features/admin-teacher-delete/index.ts";
import { jsonResponse, requireAdminSession } from "../../../../../../lib/server/api.ts";
import { withApiObservability } from "../../../../../../lib/server/observability.ts";

async function handleGet(request: Request, context?: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const { id } = await (context?.params ?? Promise.resolve({ id: "" }));
  if (!id) return jsonResponse({ ok: false, reason: "Identifiant manquant." }, { status: 400 });

  const result = await previewTeacherDelete(await loadTeacherDeleteDeps(), id);
  if (!result.ok || !result.preview) {
    return jsonResponse({ ok: false, reason: result.reason }, { status: result.status });
  }
  return jsonResponse(result.preview);
}

export const GET = withApiObservability("/api/admin/teachers/[id]/delete-preview", handleGet);
