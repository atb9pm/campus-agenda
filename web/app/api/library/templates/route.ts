import { jsonResponse, requireTeacherSession, getActiveSchoolYearId, getTemplatesStore } from "../../../../lib/server/api.ts";

export async function GET(request: Request) {
  const auth = await requireTeacherSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const templateStore = await getTemplatesStore();
  const templates = await templateStore.listTemplatesForTeacher(auth.session!.teacherId);
  return jsonResponse({ ok: true, templates });
}

export async function POST(request: Request) {
  const auth = await requireTeacherSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const body = await request.json() as { itemId?: number };
  const itemId = Number(body.itemId);
  if (!Number.isFinite(itemId)) {
    return jsonResponse({ ok: false, reason: "Identifiant de publication requis." }, { status: 400 });
  }

  const activeSchoolYearId = await getActiveSchoolYearId();
  const templateStore = await getTemplatesStore();
  const result = await templateStore.createTemplateFromItem(itemId, auth.session!.teacherId, activeSchoolYearId);
  if (!result.ok) {
    return jsonResponse({ ok: false, reason: result.reason }, { status: result.status });
  }

  return jsonResponse({ ok: true, template: result.template, item: result.item }, { status: 201 });
}
