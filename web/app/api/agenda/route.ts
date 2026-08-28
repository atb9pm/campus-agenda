import { AGENDA_ITEM_TYPES } from "@campus/types/agenda.ts";
import {
  forbiddenResponse,
  getArchivedSchoolYearIds,
  jsonResponse,
  requireClassroomReadAccess,
  requireTeacherSession,
  getActiveSchoolYearId,
} from "../../../lib/server/api.ts";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const classroomId = url.searchParams.get("classroomId")?.trim();
  const schoolYearId = url.searchParams.get("schoolYearId")?.trim() || null;
  if (!classroomId) {
    return jsonResponse({ ok: false, reason: "Paramètre classroomId requis." }, { status: 400 });
  }

  const access = await requireClassroomReadAccess(request, classroomId);
  if ("error" in access && access.error) return access.error;

  let items = await access.store!.listAgendaItems(classroomId);
  if (schoolYearId) {
    items = items.filter((item) => item.schoolYearId === schoolYearId);
  }

  const archivedIds = await getArchivedSchoolYearIds();
  const readOnly = Boolean(schoolYearId && archivedIds.has(schoolYearId));

  return jsonResponse({ ok: true, items, readOnly, schoolYearId });
}

export async function POST(request: Request) {
  const auth = await requireTeacherSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const body = await request.json() as {
    classroomId?: string;
    subjectId?: string;
    day?: number;
    hour?: number;
    weekOffset?: number;
    schoolWeekNumber?: number;
    type?: string;
    title?: string;
    detail?: string;
  };

  const classroomId = String(body.classroomId ?? "").trim();
  const subjectId = String(body.subjectId ?? "").trim();
  const type = String(body.type ?? "").trim();

  if (!classroomId || !subjectId || !AGENDA_ITEM_TYPES.includes(type as typeof AGENDA_ITEM_TYPES[number])) {
    return jsonResponse({ ok: false, reason: "Données de publication invalides." }, { status: 400 });
  }

  if (!(await auth.store!.teacherCanPublish(auth.session!.teacherId, classroomId, subjectId))) {
    return forbiddenResponse("Vous ne pouvez pas publier dans cette branche.");
  }

  const schoolWeekNumber = Number(body.schoolWeekNumber ?? 0);
  if (!Number.isFinite(schoolWeekNumber) || schoolWeekNumber < 1 || schoolWeekNumber > 38) {
    return jsonResponse({ ok: false, reason: "Semaine scolaire invalide." }, { status: 400 });
  }

  const day = Number(body.day ?? 0);
  if (day !== 0 && day !== 3) {
    return jsonResponse({ ok: false, reason: "Jour de cours invalide." }, { status: 400 });
  }

  const item = await auth.store!.createAgendaItem({
    classroomId,
    subjectId,
    authorTeacherId: auth.session!.teacherId,
    day,
    hour: Number(body.hour ?? 8),
    weekOffset: Number(body.weekOffset ?? 0),
    schoolWeekNumber,
    type: type as typeof AGENDA_ITEM_TYPES[number],
    title: String(body.title ?? ""),
    detail: String(body.detail ?? ""),
    schoolYearId: await getActiveSchoolYearId(),
  });

  return jsonResponse({ ok: true, item }, { status: 201 });
}
