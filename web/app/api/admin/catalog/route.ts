import { getSchoolCatalogStore } from "@campus/lib/persistence/store-factory.ts";
import {
  listActiveSchoolBranches,
  listActiveSchoolClasses,
  listBranchesForClass,
} from "@campus/features/school-catalog/index.ts";
import { jsonResponse, requireAdminSession, requireTeacherSession } from "../../../../lib/server/api.ts";
import { withApiObservability } from "../../../../lib/server/observability.ts";

async function handleGet(request: Request) {
  const url = new URL(request.url);
  const activeOnly = url.searchParams.get("active") === "1";
  const classId = url.searchParams.get("classId")?.trim() || null;
  // Liste active : tout enseignant (Configuration). Liste complète : admin seulement.
  const auth = activeOnly ? await requireTeacherSession(request) : await requireAdminSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const catalog = await getSchoolCatalogStore();
  await catalog.ensureSeeded();
  const [classes, branches, professions, contexts] = await Promise.all([
    catalog.listClasses(),
    catalog.listBranches(),
    catalog.listProfessions(),
    catalog.listContexts(),
  ]);

  const visibleClasses = activeOnly ? listActiveSchoolClasses(classes) : classes;
  let visibleBranches = activeOnly ? listActiveSchoolBranches(branches) : branches;
  if (classId) {
    const schoolClass = classes.find((entry) => entry.id === classId) ?? null;
    visibleBranches = listBranchesForClass({
      schoolClass,
      branches: visibleBranches,
      contexts,
    });
  }

  const visibleProfessions = activeOnly
    ? professions.filter((entry) => entry.isActive && !entry.isArchived)
    : professions;
  const visibleContexts = activeOnly
    ? contexts.filter((entry) => entry.isActive && !entry.isArchived)
    : contexts;

  return jsonResponse({
    ok: true,
    classes: visibleClasses,
    branches: visibleBranches,
    professions: visibleProfessions,
    contexts: visibleContexts,
  });
}

async function handlePost(request: Request) {
  const auth = await requireAdminSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const body = (await request.json()) as {
    kind?: "class" | "branch" | "profession" | "context";
    code?: string;
    label?: string;
    sortOrder?: number;
    isActive?: boolean;
    isArchived?: boolean;
    schoolYearLabel?: string | null;
    professionId?: string | null;
    trainingYear?: number | null;
    durationYears?: number;
    branchId?: string;
  };

  const catalog = await getSchoolCatalogStore();

  if (body.kind === "profession") {
    if (!body.label?.trim() || body.durationYears === undefined) {
      return jsonResponse({ ok: false, reason: "Données invalides." }, { status: 400 });
    }
    try {
      const created = await catalog.createProfession({
        label: body.label,
        durationYears: body.durationYears,
        sortOrder: body.sortOrder,
        isActive: body.isActive,
        isArchived: body.isArchived,
      });
      return jsonResponse({ ok: true, profession: created });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Création impossible.";
      return jsonResponse({ ok: false, reason }, { status: 400 });
    }
  }

  if (body.kind === "context") {
    if (!body.professionId?.trim() || !body.branchId?.trim() || body.trainingYear === undefined) {
      return jsonResponse({ ok: false, reason: "Données invalides." }, { status: 400 });
    }
    const created = await catalog.createContext({
      professionId: body.professionId,
      trainingYear: body.trainingYear,
      branchId: body.branchId,
      isActive: body.isActive,
      isArchived: body.isArchived,
    });
    if (!created.ok) return jsonResponse({ ok: false, reason: created.reason }, { status: 400 });
    return jsonResponse({ ok: true, context: created.value });
  }

  if (!body.code?.trim() || !body.label?.trim() || (body.kind !== "class" && body.kind !== "branch")) {
    return jsonResponse({ ok: false, reason: "Données invalides." }, { status: 400 });
  }

  if (body.kind === "class") {
    const created = await catalog.createClass({
      code: body.code,
      label: body.label,
      sortOrder: body.sortOrder,
      isActive: body.isActive,
      schoolYearLabel: body.schoolYearLabel ?? null,
      professionId: body.professionId ?? null,
      trainingYear: body.trainingYear ?? null,
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
