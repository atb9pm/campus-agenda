import { AGENDA_ITEM_TYPES } from "@campus/types/agenda.ts";
import { parseConfirmCoordination } from "@campus/features/course-publications/index.ts";
import { evaluateLiveControlCoordination } from "@campus/features/control-planning/index.ts";
import {
  CONTROL_COORDINATION_CONFIRM_CODE,
  CONTROL_COORDINATION_CONFIRM_REASON,
  gateControlCoordination,
} from "@campus/features/evaluations/index.ts";
import {
  assertAgendaPublicationBranchAllowed,
  assertStructuredAgendaSubjectLinked,
  assertValidAgendaScheduleTarget,
  forbiddenResponse,
  getArchivedSchoolYearIds,
  jsonResponse,
  listAttendanceDaysForLegacyClassroom,
  requireClassroomReadAccess,
  requireTeacherSession,
  getActiveSchoolYear,
  authorizeTeacherAgendaPublish,
} from "../../../lib/server/api.ts";
import {
  getAnnualCourseStore,
  getCourseScheduleStore,
  getRuntimeAgendaAdapterStore,
  getSchoolCatalogStore,
  getSchoolYearStore,
  getTeacherAccountStore,
} from "@campus/lib/persistence/store-factory.ts";

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
  const attendanceDays = await listAttendanceDaysForLegacyClassroom(classroomId);

  return jsonResponse({ ok: true, items, readOnly, schoolYearId, attendanceDays });
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
    confirmCoordination?: boolean;
    annualCourseId?: string;
    courseSessionKey?: string;
    courseSessionDate?: string;
    referenceSessionId?: string;
    referenceItemId?: string;
  };

  if (
    body.annualCourseId != null ||
    body.courseSessionKey != null ||
    body.courseSessionDate != null ||
    body.referenceSessionId != null ||
    body.referenceItemId != null
  ) {
    return jsonResponse(
      {
        ok: false,
        reason: "La provenance structurée ne peut être écrite que depuis le déroulement du cours.",
      },
      { status: 400 },
    );
  }

  const classroomId = String(body.classroomId ?? "").trim();
  const subjectId = String(body.subjectId ?? "").trim();
  const type = String(body.type ?? "").trim();

  if (!classroomId || !subjectId || !AGENDA_ITEM_TYPES.includes(type as typeof AGENDA_ITEM_TYPES[number])) {
    return jsonResponse({ ok: false, reason: "Données de publication invalides." }, { status: 400 });
  }

  const activeYear = await getActiveSchoolYear();
  const activeSchoolYearId = activeYear?.id ?? null;
  const schoolWeekNumber = Number(body.schoolWeekNumber ?? 0);
  const day = Number(body.day ?? 0);
  const subjectLinkGuard = await assertStructuredAgendaSubjectLinked(classroomId, subjectId);
  if (subjectLinkGuard) return subjectLinkGuard;
  if (
    !(await authorizeTeacherAgendaPublish(
      auth.session!.teacherId,
      classroomId,
      subjectId,
      auth.store!,
      activeSchoolYearId,
      { schoolWeekNumber, dayIndex: day },
    ))
  ) {
    return forbiddenResponse("Vous ne pouvez pas publier dans cette branche.");
  }

  const branchGuard = await assertAgendaPublicationBranchAllowed(classroomId, subjectId, activeSchoolYearId);
  if (branchGuard) return branchGuard;

  const scheduleGuard = await assertValidAgendaScheduleTarget({
    classroomId,
    subjectId,
    schoolWeekNumber,
    dayIndex: day,
    schoolYearId: activeSchoolYearId,
  });
  if (scheduleGuard) return scheduleGuard;

  if (type === "TEST") {
    const coordination = await evaluateLiveControlCoordination(
      {
        agenda: auth.store!,
        adapters: await getRuntimeAgendaAdapterStore(),
        catalog: await getSchoolCatalogStore(),
        courses: await getAnnualCourseStore(),
        years: await getSchoolYearStore(),
        teachers: await getTeacherAccountStore(),
        schedules: await getCourseScheduleStore(),
      },
      {
        teacherId: auth.session!.teacherId,
        classroomId,
        type: "TEST",
        schoolYearId: activeSchoolYearId ?? "",
        schoolWeekNumber,
        dayIndex: day,
        includeUnscopedYearItems: true,
      },
    );
    const gate = gateControlCoordination(coordination, parseConfirmCoordination(body));
    if (!gate.ok) {
      return jsonResponse(
        {
          ok: false,
          reason: CONTROL_COORDINATION_CONFIRM_REASON,
          code: CONTROL_COORDINATION_CONFIRM_CODE,
          coordination,
        },
        { status: 409 },
      );
    }
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
    schoolYearId: activeSchoolYearId,
  });

  return jsonResponse({ ok: true, item }, { status: 201 });
}
