import { jsonResponse, requireTeacherSession, getTemplatesStore } from "../../../../../lib/server/api.ts";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireTeacherSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const { id } = await context.params;
  const body = await request.json() as {
    title?: string;
    detail?: string;
    subjectId?: string | null;
    defaultSchoolWeekNumber?: number | null;
    defaultDay?: number | null;
  };

  const templateStore = await getTemplatesStore();
  const result = await templateStore.updateTemplate(id, auth.session!.teacherId, body);
  if (!result.ok) {
    return jsonResponse({ ok: false, reason: result.reason }, { status: result.status });
  }

  return jsonResponse({ ok: true, template: result.template });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireTeacherSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const { id } = await context.params;
  const templateStore = await getTemplatesStore();
  const result = await templateStore.deleteTemplate(id, auth.session!.teacherId);
  if (!result.ok) {
    return jsonResponse({ ok: false, reason: result.reason }, { status: result.status });
  }

  return jsonResponse({ ok: true });
}
