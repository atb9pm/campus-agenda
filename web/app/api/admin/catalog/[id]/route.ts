import { getSchoolCatalogStore } from "@campus/lib/persistence/store-factory.ts";
import { jsonResponse, requireAdminSession } from "../../../../../lib/server/api.ts";
import { withApiObservability } from "../../../../../lib/server/observability.ts";

async function handlePatch(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const { id } = await context.params;
  const body = (await request.json()) as {
    kind?: "class" | "branch";
    code?: string;
    label?: string;
    sortOrder?: number;
    isActive?: boolean;
    isArchived?: boolean;
    schoolYearLabel?: string | null;
  };

  if (body.kind !== "class" && body.kind !== "branch") {
    return jsonResponse({ ok: false, reason: "Paramètre kind requis (class|branch)." }, { status: 400 });
  }

  const catalog = await getSchoolCatalogStore();
  if (body.kind === "class") {
    const updated = await catalog.updateClass(id, body);
    if (!updated) return jsonResponse({ ok: false, reason: "Classe introuvable." }, { status: 404 });
    return jsonResponse({ ok: true, class: updated });
  }

  const updated = await catalog.updateBranch(id, body);
  if (!updated) return jsonResponse({ ok: false, reason: "Branche introuvable." }, { status: 404 });
  return jsonResponse({ ok: true, branch: updated });
}

export const PATCH = withApiObservability("/api/admin/catalog/[id]", handlePatch);
