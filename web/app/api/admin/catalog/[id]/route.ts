import { getSchoolCatalogStore, getSchoolYearStore } from "@campus/lib/persistence/store-factory.ts";
import { deleteCatalogItemPermanently } from "@campus/features/admin-catalog-delete/index.ts";
import { loadCatalogDeleteDeps } from "@campus/features/admin-catalog-delete/deps.ts";
import {
  assertClassStaysInSchoolYear,
  assertSchoolYearWritable,
  validateAdminClassCreate,
} from "@campus/features/school-catalog/index.ts";
import { logOperationalEvent } from "@campus/lib/observability/index.ts";
import { jsonResponse, requireAdminSession } from "../../../../../lib/server/api.ts";
import { withApiObservability } from "../../../../../lib/server/observability.ts";

async function loadClassWithYear(classId: string) {
  const [catalog, years] = await Promise.all([
    getSchoolCatalogStore(),
    getSchoolYearStore().then((store) => store.listSchoolYears()),
  ]);
  const current = (await catalog.listClasses()).find((entry) => entry.id === classId) ?? null;
  const year = current?.schoolYearId
    ? years.find((entry) => entry.id === current.schoolYearId) ?? null
    : null;
  return { catalog, years, current, year };
}

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
      const loaded = await loadClassWithYear(id);
      if (!loaded.current) return jsonResponse({ ok: false, reason: "Classe introuvable." }, { status: 404 });
      if (loaded.current.schoolYearId) {
        const writable = assertSchoolYearWritable(loaded.year);
        if (!writable.ok) {
          return jsonResponse({ ok: false, reason: writable.reason }, { status: 400 });
        }
      }
      if (body.schoolYearId !== undefined) {
        const stays = assertClassStaysInSchoolYear({
          currentSchoolYearId: loaded.current.schoolYearId,
          nextSchoolYearId: body.schoolYearId,
        });
        if (!stays.ok) {
          return jsonResponse({ ok: false, reason: stays.reason }, { status: 400 });
        }
      }
      const pedagogyTouched =
        body.schoolYearId !== undefined ||
        body.professionId !== undefined ||
        body.trainingYear !== undefined;
      if (pedagogyTouched) {
        const professions = await catalog.listProfessions();
        const structured = validateAdminClassCreate({
          schoolYearId: body.schoolYearId ?? loaded.current.schoolYearId,
          professionId: body.professionId,
          trainingYear: body.trainingYear,
          years: loaded.years,
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

  let confirmationText: string | null = null;
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as { confirmationText?: string } | null;
    confirmationText = typeof body?.confirmationText === "string" ? body.confirmationText : null;
  }

  if (kind === "class") {
    const loaded = await loadClassWithYear(id);
    if (!loaded.current) return jsonResponse({ ok: false, reason: "Classe introuvable." }, { status: 404 });
    if (loaded.current.schoolYearId) {
      const writable = assertSchoolYearWritable(loaded.year);
      if (!writable.ok) {
        return jsonResponse({ ok: false, reason: writable.reason }, { status: 400 });
      }
    }
  }

  const deps = await loadCatalogDeleteDeps();
  const result = await deleteCatalogItemPermanently(deps, { kind, id, confirmationText });
  if (!result.ok) {
    return jsonResponse(
      { ok: false, reason: result.reason, preview: result.preview ?? null },
      { status: result.status },
    );
  }

  logOperationalEvent(`Admin ${auth.session!.teacherId} deleted ${kind} ${id}`, {
    adminId: auth.session!.teacherId,
    kind,
    targetId: id,
  });
  return jsonResponse({ ok: true, id, preview: result.preview ?? null });
}

export const PATCH = withApiObservability("/api/admin/catalog/[id]", handlePatch);
export const DELETE = withApiObservability("/api/admin/catalog/[id]", handleDelete);
