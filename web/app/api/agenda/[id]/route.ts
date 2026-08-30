import {
  assertAgendaItemMutable,
  assertAgendaPublicationBranchAllowed,
  forbiddenResponse,
  jsonResponse,
  requireTeacherSession,
} from "../../../../lib/server/api.ts";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await requireTeacherSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const { id } = await context.params;
  const itemId = Number(id);
  if (!Number.isFinite(itemId)) {
    return jsonResponse({ ok: false, reason: "Identifiant invalide." }, { status: 400 });
  }

  const body = await request.json() as {
    title?: string;
    detail?: string;
    day?: number;
    hour?: number;
    subjectId?: string;
    schoolWeekNumber?: number;
  };

  const existing = await auth.store!.findAgendaItem(itemId);
  const archivedBlock = await assertAgendaItemMutable(existing);
  if (archivedBlock) return archivedBlock;

  if (existing && !(await auth.store!.teacherCanPublish(auth.session!.teacherId, existing.classroomId, body.subjectId ?? existing.subjectId))) {
    return forbiddenResponse("Branche non autorisée.");
  }

  if (existing) {
    const branchGuard = await assertAgendaPublicationBranchAllowed(
      existing.classroomId,
      body.subjectId ?? existing.subjectId,
    );
    if (branchGuard) return branchGuard;
  }

  const result = await auth.store!.updateAgendaItem(itemId, auth.session!.teacherId, body);
  if (!result.ok) {
    return jsonResponse({ ok: false, reason: result.reason }, { status: result.status });
  }

  return jsonResponse({ ok: true, item: result.item });
}

export async function DELETE(request: Request, context: RouteContext) {
  const auth = await requireTeacherSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const { id } = await context.params;
  const itemId = Number(id);
  if (!Number.isFinite(itemId)) {
    return jsonResponse({ ok: false, reason: "Identifiant invalide." }, { status: 400 });
  }

  const existing = await auth.store!.findAgendaItem(itemId);
  const archivedBlock = await assertAgendaItemMutable(existing);
  if (archivedBlock) return archivedBlock;

  const result = await auth.store!.deleteAgendaItem(itemId, auth.session!.teacherId);
  if (!result.ok) {
    return jsonResponse({ ok: false, reason: result.reason }, { status: result.status });
  }

  return jsonResponse({ ok: true, item: result.item });
}
