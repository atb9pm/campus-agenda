import { AGENDA_ITEM_TYPES } from "@campus/types/agenda.ts";
import {
  forbiddenResponse,
  jsonResponse,
  requireClassroomReadAccess,
  requireTeacherSession,
} from "../../../lib/server/api.ts";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const classroomId = url.searchParams.get("classroomId")?.trim();
  if (!classroomId) {
    return jsonResponse({ ok: false, reason: "Paramètre classroomId requis." }, { status: 400 });
  }

  const access = await requireClassroomReadAccess(request, classroomId);
  if ("error" in access && access.error) return access.error;

  const items = access.store!.listAgendaItems(classroomId);
  return jsonResponse({ ok: true, items });
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

  if (!auth.store!.teacherCanPublish(auth.session!.teacherId, classroomId, subjectId)) {
    return forbiddenResponse("Vous ne pouvez pas publier dans cette branche.");
  }

  const item = auth.store!.createAgendaItem({
    classroomId,
    subjectId,
    authorTeacherId: auth.session!.teacherId,
    day: Number(body.day ?? 0),
    hour: Number(body.hour ?? 8),
    weekOffset: Number(body.weekOffset ?? 0),
    type: type as typeof AGENDA_ITEM_TYPES[number],
    title: String(body.title ?? ""),
    detail: String(body.detail ?? ""),
  });

  return jsonResponse({ ok: true, item }, { status: 201 });
}
