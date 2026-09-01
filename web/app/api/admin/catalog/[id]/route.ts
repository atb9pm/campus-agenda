import {
  getAgendaStore,
  getAnnualCourseNotesStore,
  getAnnualCourseStore,
  getCourseScheduleStore,
  getMembershipStore,
  getSchoolCatalogStore,
  getSchoolYearStore,
  getTimetableStore,
  listRuntimeClassrooms,
  listStudentAccesses,
} from "@campus/lib/persistence/store-factory.ts";
import {
  classDeleteBlockers,
  loadClassDeleteUsage,
  validateAdminClassCreate,
} from "@campus/features/school-catalog/index.ts";
import { jsonResponse, requireAdminSession } from "../../../../../lib/server/api.ts";
import { withApiObservability } from "../../../../../lib/server/observability.ts";

async function handlePatch(request: Request, context?: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const { id } = await (context?.params ?? Promise.resolve({ id: "" }));
  if (!id) return jsonResponse({ ok: false, reason: "Identifiant manquant." }, { status: 400 });
  const body = (await request.json()) as {
    kind?: "class" | "branch" | "profession" | "context";
    code?: string;
    label?: string;
    sortOrder?: number;
    isActive?: boolean;
    isArchived?: boolean;
    schoolYearId?: string | null;
    schoolYearLabel?: string | null;
    professionId?: string | null;
    trainingYear?: number | null;
    durationYears?: number;
    classCodePrefix?: string | null;
    parallelCode?: string | null;
    teachingType?: "TECHNICAL" | "GENERAL" | null;
  };

  if (
    body.kind !== "class" &&
    body.kind !== "branch" &&
    body.kind !== "profession" &&
    body.kind !== "context"
  ) {
    return jsonResponse(
      { ok: false, reason: "Paramètre kind requis (class|branch|profession|context)." },
      { status: 400 },
    );
  }

  const catalog = await getSchoolCatalogStore();

  if (body.kind === "class") {
    if (body.isArchived !== undefined && typeof body.isArchived !== "boolean") {
      return jsonResponse({ ok: false, reason: "isArchived doit être un booléen." }, { status: 400 });
    }
    if (body.isActive !== undefined && typeof body.isActive !== "boolean") {
      return jsonResponse({ ok: false, reason: "isActive doit être un booléen." }, { status: 400 });
    }
    try {
      const pedagogyTouched =
        body.schoolYearId !== undefined ||
        body.professionId !== undefined ||
        body.trainingYear !== undefined;
      if (pedagogyTouched) {
        const [years, professions] = await Promise.all([
          getSchoolYearStore().then((store) => store.listSchoolYears()),
          catalog.listProfessions(),
        ]);
        const structured = validateAdminClassCreate({
          schoolYearId: body.schoolYearId,
          professionId: body.professionId,
          trainingYear: body.trainingYear,
          years,
          professions,
        });
        if (!structured.ok) {
          return jsonResponse({ ok: false, reason: structured.reason }, { status: 400 });
        }
        body.schoolYearId = structured.value.schoolYearId;
        body.schoolYearLabel = structured.value.schoolYearLabel;
        body.professionId = structured.value.professionId;
        body.trainingYear = structured.value.trainingYear;
      }
      const updated = await catalog.updateClass(id, body);
      if (!updated) return jsonResponse({ ok: false, reason: "Classe introuvable." }, { status: 404 });
      return jsonResponse({ ok: true, class: updated });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Mise à jour impossible.";
      return jsonResponse({ ok: false, reason }, { status: 400 });
    }
  }

  if (body.kind === "branch") {
    const updated = await catalog.updateBranch(id, body);
    if (!updated) return jsonResponse({ ok: false, reason: "Branche introuvable." }, { status: 404 });
    return jsonResponse({ ok: true, branch: updated });
  }

  if (body.kind === "profession") {
    const updated = await catalog.updateProfession(id, {
      label: body.label,
      durationYears: body.durationYears,
      classCodePrefix: body.classCodePrefix,
      sortOrder: body.sortOrder,
      isActive: body.isActive,
      isArchived: body.isArchived,
    });
    if (!updated.ok) {
      const status = updated.reason.includes("introuvable") ? 404 : 400;
      return jsonResponse({ ok: false, reason: updated.reason }, { status });
    }
    return jsonResponse({ ok: true, profession: updated.value });
  }

  const updated = await catalog.updateContext(id, {
    isActive: body.isActive,
    isArchived: body.isArchived,
  });
  if (!updated.ok) {
    const status = updated.reason.includes("introuvable") ? 404 : 400;
    return jsonResponse({ ok: false, reason: updated.reason }, { status });
  }
  return jsonResponse({ ok: true, context: updated.value });
}

async function handleDelete(request: Request, context?: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const { id } = await (context?.params ?? Promise.resolve({ id: "" }));
  if (!id) return jsonResponse({ ok: false, reason: "Identifiant manquant." }, { status: 400 });
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind")?.trim() as
    | "branch"
    | "profession"
    | "context"
    | "class"
    | null;

  if (kind !== "branch" && kind !== "profession" && kind !== "context" && kind !== "class") {
    return jsonResponse(
      { ok: false, reason: "Paramètre kind requis (class|branch|profession|context)." },
      { status: 400 },
    );
  }

  const catalog = await getSchoolCatalogStore();

  if (kind === "class") {
    const classes = await catalog.listClasses();
    const schoolClass = classes.find((entry) => entry.id === id) ?? null;
    if (!schoolClass) {
      return jsonResponse({ ok: false, reason: "Classe introuvable." }, { status: 404 });
    }
    const [courses, notes, agenda, timetable, memberships, classrooms, studentAccesses, schedules] =
      await Promise.all([
        getAnnualCourseStore(),
        getAnnualCourseNotesStore(),
        getAgendaStore(),
        getTimetableStore(),
        getMembershipStore(),
        listRuntimeClassrooms(),
        listStudentAccesses(),
        getCourseScheduleStore(),
      ]);
    const usage = await loadClassDeleteUsage({
      schoolClass,
      courses,
      notes,
      agenda,
      timetable,
      memberships,
      classrooms,
      studentAccesses,
      schedules,
    });
    const blockers = classDeleteBlockers(schoolClass, classes, usage);
    if (!blockers.ok) {
      return jsonResponse({ ok: false, reason: blockers.reason }, { status: 409 });
    }
    const deleted = await catalog.deleteClass(id);
    if (!deleted) {
      return jsonResponse({ ok: false, reason: "Classe introuvable." }, { status: 404 });
    }
    return jsonResponse({ ok: true, id });
  }

  if (kind === "branch") {
    const result = await catalog.deleteBranch(id);
    if (!result.ok) {
      const status = result.reason.includes("introuvable") ? 404 : 409;
      return jsonResponse({ ok: false, reason: result.reason }, { status });
    }
    return jsonResponse({ ok: true, id: result.value.id });
  }

  if (kind === "profession") {
    const result = await catalog.deleteProfession(id);
    if (!result.ok) {
      const status = result.reason.includes("introuvable") ? 404 : 409;
      return jsonResponse({ ok: false, reason: result.reason }, { status });
    }
    return jsonResponse({ ok: true, id: result.value.id });
  }

  const result = await catalog.deleteContext(id);
  if (!result.ok) {
    const status = result.reason.includes("introuvable") ? 404 : 409;
    return jsonResponse({ ok: false, reason: result.reason }, { status });
  }
  return jsonResponse({ ok: true, id: result.value.id });
}

export const PATCH = withApiObservability("/api/admin/catalog/[id]", handlePatch);
export const DELETE = withApiObservability("/api/admin/catalog/[id]", handleDelete);
