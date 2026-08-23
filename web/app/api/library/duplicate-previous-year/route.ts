import { getSchoolYearStore } from "@campus/lib/persistence/store-factory.ts";
import { jsonResponse, requireTeacherSession, getActiveSchoolYearId, getTemplatesStore } from "../../../../lib/server/api.ts";

export async function POST(request: Request) {
  const auth = await requireTeacherSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const body = await request.json() as {
    archivedSchoolYearId?: string;
    classroomId?: string;
    alsoCreateTemplates?: boolean;
  };

  const archivedSchoolYearId = String(body.archivedSchoolYearId ?? "").trim();
  const classroomId = String(body.classroomId ?? "").trim();
  if (!archivedSchoolYearId || !classroomId) {
    return jsonResponse({ ok: false, reason: "Année archivée et classe requises." }, { status: 400 });
  }

  const schoolYearStore = await getSchoolYearStore();
  const archived = await schoolYearStore.getSchoolYearById(archivedSchoolYearId);
  if (!archived || archived.status !== "archived") {
    return jsonResponse({ ok: false, reason: "Année scolaire archivée introuvable." }, { status: 404 });
  }

  const activeSchoolYearId = await getActiveSchoolYearId();
  const templateStore = await getTemplatesStore();
  const result = await templateStore.duplicateFromArchivedYear(auth.session!.teacherId, {
    archivedSchoolYearId,
    classroomId,
    alsoCreateTemplates: Boolean(body.alsoCreateTemplates),
  }, activeSchoolYearId);

  if (!result.ok) {
    return jsonResponse({ ok: false, reason: result.reason }, { status: result.status });
  }

  return jsonResponse({
    ok: true,
    created: result.created,
    templatesCreated: result.templatesCreated,
    createdCount: result.created.length,
  }, { status: 201 });
}
