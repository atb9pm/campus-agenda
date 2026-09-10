import { previewCatalogDelete } from "@campus/features/admin-catalog-delete/index.ts";
import { loadCatalogDeleteDeps } from "@campus/features/admin-catalog-delete/deps.ts";
import { jsonResponse, requireAdminSession } from "../../../../../../lib/server/api.ts";
import { withApiObservability } from "../../../../../../lib/server/observability.ts";

async function handleGet(request: Request, context?: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const { id } = await (context?.params ?? Promise.resolve({ id: "" }));
  if (!id) return jsonResponse({ ok: false, reason: "Identifiant manquant." }, { status: 400 });

  const kind = new URL(request.url).searchParams.get("kind")?.trim();
  if (kind !== "class" && kind !== "profession" && kind !== "branch" && kind !== "context") {
    return jsonResponse(
      { ok: false, reason: "Paramètre kind requis (class|branch|profession|context)." },
      { status: 400 },
    );
  }

  const result = await previewCatalogDelete(await loadCatalogDeleteDeps(), kind, id);
  if (!result.ok || !result.preview) {
    return jsonResponse({ ok: false, reason: result.reason }, { status: result.status });
  }
  return jsonResponse(result.preview);
}

export const GET = withApiObservability("/api/admin/catalog/[id]/delete-preview", handleGet);
