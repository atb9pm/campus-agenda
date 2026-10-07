import {
  AGENDA_PLACEMENT_YEAR_REASON,
  buildAgendaItemUpdatePatch,
  isAgendaPlacementChange,
  isStructuredAgendaPublication,
  structuredAgendaPatchGuard,
  type AgendaPlacementContext,
  type PublicationPatch,
} from "@campus/features/agenda/index.ts";
import type { PrototypeAgendaItem } from "@campus/features/agenda/demo-items.ts";
import { authorizeNotebookOwnedItemMutation } from "@campus/features/class-notebook";
import { listComputedCourseSessions } from "@campus/features/course-sessions/index.ts";
import {
  assertAgendaItemMutable,
  assertAgendaClassMutableForItem,
  assertAgendaPublicationBranchAllowed,
  assertValidAgendaScheduleTarget,
  forbiddenResponse,
  getCourseScheduleServiceDeps,
  getNotebookPublicationDeps,
  jsonResponse,
  requireTeacherSession,
  authorizeTeacherAgendaPublish,
} from "../../../../lib/server/api.ts";
import { getSchoolYearStore } from "@campus/lib/persistence/store-factory.ts";
import type { AgendaStore } from "@campus/lib/persistence/types.ts";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function contentPatchFromBody(body: {
  title?: string;
  detail?: string;
  day?: number;
  hour?: number;
  subjectId?: string;
  schoolWeekNumber?: number;
  studentVisible?: boolean;
}): PublicationPatch {
  return {
    title: body.title,
    detail: body.detail,
    day: body.day,
    hour: body.hour,
    subjectId: body.subjectId,
    schoolWeekNumber: body.schoolWeekNumber,
    studentVisible: body.studentVisible,
  };
}

async function placementContextForItem(
  item: PrototypeAgendaItem,
): Promise<{ ok: true; context: AgendaPlacementContext } | { ok: false; reason: string; status: number }> {
  const years = await getSchoolYearStore();
  const year = item.schoolYearId
    ? await years.getSchoolYearById(item.schoolYearId)
    : await years.getActiveSchoolYear();
  if (!year) {
    return { ok: false, reason: AGENDA_PLACEMENT_YEAR_REASON, status: 400 };
  }
  const context: AgendaPlacementContext = { weeks: year.weeks };
  if (isStructuredAgendaPublication(item)) {
    const sessions = await listComputedCourseSessions(await getCourseScheduleServiceDeps(), {
      schoolYearId: year.id,
      annualCourseId: item.annualCourseId ?? "",
    });
    if (!sessions.ok) {
      return { ok: false, reason: sessions.reason, status: sessions.status };
    }
    context.sessions = sessions.value;
  }
  return { ok: true, context };
}

async function updateAgendaItemWithPlacement(
  store: AgendaStore,
  teacherId: string,
  item: PrototypeAgendaItem,
  body: Parameters<typeof contentPatchFromBody>[0],
) {
  const raw = contentPatchFromBody(body);
  if (!isAgendaPlacementChange(item, raw)) {
    return store.updateAgendaItem(item.id, teacherId, raw);
  }
  const loaded = await placementContextForItem(item);
  if (!loaded.ok) return loaded;
  const built = buildAgendaItemUpdatePatch(item, raw, loaded.context);
  if (!built.ok) return { ok: false as const, reason: built.reason, status: 400 as const };
  return store.updateAgendaItem(item.id, teacherId, built.patch);
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
    annualCourseId?: string;
    courseSessionKey?: string;
    courseSessionDate?: string;
    referenceSessionId?: string;
    referenceItemId?: string;
    studentVisible?: boolean;
  };

  const existing = await auth.store!.findAgendaItem(itemId);
  const archivedBlock = await assertAgendaItemMutable(existing);
  if (archivedBlock) return archivedBlock;
  const classBlock = await assertAgendaClassMutableForItem(existing);
  if (classBlock) return classBlock;

  if (existing) {
    const notebookOwned = await authorizeNotebookOwnedItemMutation(await getNotebookPublicationDeps(), {
      teacherId: auth.session!.teacherId,
      item: existing,
    });
    if (notebookOwned) {
      if (!notebookOwned.ok) {
        return jsonResponse({ ok: false, reason: notebookOwned.reason }, { status: notebookOwned.status });
      }
      const result = await updateAgendaItemWithPlacement(
        auth.store!,
        auth.session!.teacherId,
        existing,
        body,
      );
      if (!result.ok) {
        return jsonResponse({ ok: false, reason: result.reason }, { status: result.status });
      }
      return jsonResponse({ ok: true, item: result.item });
    }
  }

  if (existing && isStructuredAgendaPublication(existing)) {
    const guard = structuredAgendaPatchGuard(existing, body as Record<string, unknown>);
    if (!guard.ok) {
      return jsonResponse({ ok: false, reason: guard.reason }, { status: 400 });
    }
    const result = await updateAgendaItemWithPlacement(
      auth.store!,
      auth.session!.teacherId,
      existing,
      {
        title: body.title,
        detail: body.detail,
        day: body.day,
        schoolWeekNumber: body.schoolWeekNumber,
        studentVisible: body.studentVisible,
      },
    );
    if (!result.ok) {
      return jsonResponse({ ok: false, reason: result.reason }, { status: result.status });
    }
    return jsonResponse({ ok: true, item: result.item });
  }

  if (
    existing &&
    !(await authorizeTeacherAgendaPublish(
      auth.session!.teacherId,
      existing.classroomId,
      body.subjectId ?? existing.subjectId,
      auth.store!,
      existing.schoolYearId,
      {
        schoolWeekNumber: Number(body.schoolWeekNumber ?? existing.schoolWeekNumber),
        dayIndex: Number(body.day ?? existing.day),
      },
    ))
  ) {
    return forbiddenResponse("Branche non autorisée.");
  }

  if (existing) {
    const branchGuard = await assertAgendaPublicationBranchAllowed(
      existing.classroomId,
      body.subjectId ?? existing.subjectId,
      existing.schoolYearId,
      "update",
    );
    if (branchGuard) return branchGuard;

    const nextWeek = body.schoolWeekNumber ?? existing.schoolWeekNumber;
    const nextDay = body.day ?? existing.day;
    const scheduleGuard = await assertValidAgendaScheduleTarget({
      classroomId: existing.classroomId,
      subjectId: body.subjectId ?? existing.subjectId,
      schoolWeekNumber: Number(nextWeek),
      dayIndex: Number(nextDay),
      schoolYearId: existing.schoolYearId,
    });
    if (scheduleGuard) return scheduleGuard;
  }

  const result = existing
    ? await updateAgendaItemWithPlacement(auth.store!, auth.session!.teacherId, existing, body)
    : await auth.store!.updateAgendaItem(itemId, auth.session!.teacherId, contentPatchFromBody(body));
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
  const classBlock = await assertAgendaClassMutableForItem(existing);
  if (classBlock) return classBlock;

  if (existing) {
    const notebookOwned = await authorizeNotebookOwnedItemMutation(await getNotebookPublicationDeps(), {
      teacherId: auth.session!.teacherId,
      item: existing,
    });
    if (notebookOwned && !notebookOwned.ok) {
      return jsonResponse({ ok: false, reason: notebookOwned.reason }, { status: notebookOwned.status });
    }
  }

  const result = await auth.store!.deleteAgendaItem(itemId, auth.session!.teacherId);
  if (!result.ok) {
    return jsonResponse({ ok: false, reason: result.reason }, { status: result.status });
  }

  return jsonResponse({ ok: true, item: result.item });
}
