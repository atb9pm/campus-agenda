import { getSchoolCatalogStore } from "@campus/lib/persistence/store-factory.ts";
import { listActiveSchoolBranches, listActiveSchoolClasses } from "@campus/features/school-catalog/index.ts";
import { jsonResponse, requireAdminSession, requireTeacherSession } from "../../../../lib/server/api.ts";
import { withApiObservability } from "../../../../lib/server/observability.ts";

async function handleGet(request: Request) {
  const activeOnly = new URL(request.url).searchParams.get("active") === "1";
  // Liste active : tout enseignant (Configuration). Liste complète : admin seulement.
  const auth = activeOnly ? await requireTeacherSession(request) : await requireAdminSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const catalog = await getSchoolCatalogStore();
  await catalog.ensureSeeded();
  const [classes, branches] = await Promise.all([catalog.listClasses(), catalog.listBranches()]);

  return jsonResponse({
    ok: true,
    classes: activeOnly ? listActiveSchoolClasses(classes) : classes,
    branches: activeOnly ? listActiveSchoolBranches(branches) : branches,
  });
}

async function handlePost(request: Request) {
  const auth = await requireAdminSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const body = (await request.json()) as {
    kind?: "class" | "branch";
    code?: string;
    label?: string;
    sortOrder?: number;
    isActive?: boolean;
    schoolYearLabel?: string | null;
  };

  if (!body.code?.trim() || !body.label?.trim() || (body.kind !== "class" && body.kind !== "branch")) {
    return jsonResponse({ ok: false, reason: "Données invalides." }, { status: 400 });
  }

  const catalog = await getSchoolCatalogStore();
  if (body.kind === "class") {
    const created = await catalog.createClass({
      code: body.code,
      label: body.label,
      sortOrder: body.sortOrder,
      isActive: body.isActive,
      schoolYearLabel: body.schoolYearLabel ?? null,
    });
    return jsonResponse({ ok: true, class: created });
  }

  const created = await catalog.createBranch({
    code: body.code,
    label: body.label,
    sortOrder: body.sortOrder,
    isActive: body.isActive,
  });
  return jsonResponse({ ok: true, branch: created });
}

export const GET = withApiObservability("/api/admin/catalog", handleGet);
export const POST = withApiObservability("/api/admin/catalog", handlePost);
