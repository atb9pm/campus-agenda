import {
  createCourseScheduleSlot,
  deleteCourseScheduleSlot,
  isAttendanceRole,
  isCourseWeekKind,
  isCourseWeekday,
  replaceAttendanceDaysForClass,
  type ClassAttendanceDayInput,
  type CourseWeekKind,
  type CourseWeekday,
  updateCourseScheduleSlot,
} from "@campus/features/course-schedule/index.ts";
import {
  getCourseScheduleServiceDeps,
  jsonResponse,
  requireAdminSession,
} from "../../../../lib/server/api.ts";
import { withApiObservability } from "../../../../lib/server/observability.ts";

async function handleGet(request: Request) {
  const auth = await requireAdminSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const deps = await getCourseScheduleServiceDeps();
  const [
    slots,
    attendanceDays,
    courses,
    assignments,
    classes,
    branches,
    professions,
    contexts,
    teachers,
    schoolYears,
  ] = await Promise.all([
    deps.schedules.listSlots(),
    deps.schedules.listAttendanceDays(),
    deps.courses.listCourses(),
    deps.courses.listAssignments(),
    deps.catalog.listClasses(),
    deps.catalog.listBranches(),
    deps.catalog.listProfessions(),
    deps.catalog.listContexts(),
    deps.teachers!.listAccounts(),
    deps.years.listSchoolYears(),
  ]);

  return jsonResponse({
    ok: true,
    slots,
    attendanceDays,
    courses,
    assignments,
    classes,
    branches,
    professions,
    contexts,
    schoolYears: schoolYears.map((year) => ({ id: year.id, label: year.label, status: year.status })),
    teachers: teachers.map((teacher) => ({
      id: teacher.id,
      displayName: teacher.displayName,
      initials: teacher.initials,
      isActive: teacher.isActive,
      isArchived: teacher.isArchived,
    })),
  });
}

function parseWeekday(value: unknown): CourseWeekday | null {
  const numeric = Number(value);
  return isCourseWeekday(numeric) ? numeric : null;
}

function parseAttendanceDayInput(raw: unknown): ClassAttendanceDayInput | null {
  if (!raw || typeof raw !== "object") return null;
  const entry = raw as Record<string, unknown>;
  const dayOfWeek = parseWeekday(entry.dayOfWeek);
  const weekKind = isCourseWeekKind(entry.weekKind) ? entry.weekKind : null;
  if (!dayOfWeek || !weekKind || !isAttendanceRole(entry.role)) return null;
  return { dayOfWeek, weekKind, role: entry.role };
}

async function handlePost(request: Request) {
  const auth = await requireAdminSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const deps = await getCourseScheduleServiceDeps();
  const body = (await request.json()) as {
    action?: string;
    id?: string;
    classId?: string;
    days?: unknown;
    annualCourseId?: string;
    dayOfWeek?: number;
    periodStart?: number;
    periodEnd?: number;
    weekKind?: string;
    validFrom?: string | null;
    validTo?: string | null;
    teacherId?: unknown;
  };

  if (body.teacherId !== undefined) {
    return jsonResponse(
      { ok: false, reason: "L’horaire ne définit jamais l’enseignant. Utilisez Attributions des cours." },
      { status: 400 },
    );
  }

  const action = body.action ?? "create";

  if (action === "replaceAttendanceDays") {
    const classId = String(body.classId ?? "").trim();
    if (!classId) {
      return jsonResponse({ ok: false, reason: "La classe est obligatoire." }, { status: 400 });
    }
    if (!Array.isArray(body.days)) {
      return jsonResponse({ ok: false, reason: "Le plan de présence est invalide." }, { status: 400 });
    }
    const days: ClassAttendanceDayInput[] = [];
    for (const raw of body.days) {
      const parsed = parseAttendanceDayInput(raw);
      if (!parsed) {
        return jsonResponse({ ok: false, reason: "Jour de présence invalide." }, { status: 400 });
      }
      days.push(parsed);
    }
    const result = await replaceAttendanceDaysForClass(deps, classId, days);
    if (!result.ok) {
      return jsonResponse(
        { ok: false, reason: result.reason, code: result.code },
        { status: result.status ?? 400 },
      );
    }
    return jsonResponse({ ok: true, attendanceDays: result.value });
  }

  if (action === "create") {
    const dayOfWeek = parseWeekday(body.dayOfWeek);
    const weekKind = isCourseWeekKind(body.weekKind) ? (body.weekKind as CourseWeekKind) : null;
    if (!dayOfWeek || !weekKind) {
      return jsonResponse({ ok: false, reason: "Jour ou rythme invalide." }, { status: 400 });
    }
    const result = await createCourseScheduleSlot(deps, {
      annualCourseId: String(body.annualCourseId ?? ""),
      dayOfWeek,
      periodStart: Number(body.periodStart),
      periodEnd: Number(body.periodEnd),
      weekKind,
      validFrom: body.validFrom ?? null,
      validTo: body.validTo ?? null,
    });
    if (!result.ok) {
      return jsonResponse(
        { ok: false, reason: result.reason, code: result.code },
        { status: result.status ?? 400 },
      );
    }
    return jsonResponse({ ok: true, slot: result.value }, { status: 201 });
  }

  if (action === "update") {
    const dayOfWeek = parseWeekday(body.dayOfWeek);
    const weekKind = isCourseWeekKind(body.weekKind) ? (body.weekKind as CourseWeekKind) : null;
    if (!dayOfWeek || !weekKind) {
      return jsonResponse({ ok: false, reason: "Jour ou rythme invalide." }, { status: 400 });
    }
    const result = await updateCourseScheduleSlot(deps, String(body.id ?? ""), {
      dayOfWeek,
      periodStart: Number(body.periodStart),
      periodEnd: Number(body.periodEnd),
      weekKind,
      validFrom: body.validFrom ?? null,
      validTo: body.validTo ?? null,
    });
    if (!result.ok) {
      return jsonResponse(
        { ok: false, reason: result.reason, code: result.code },
        { status: result.status ?? 400 },
      );
    }
    return jsonResponse({ ok: true, slot: result.value });
  }

  if (action === "delete") {
    const result = await deleteCourseScheduleSlot(deps, String(body.id ?? ""));
    if (!result.ok) {
      return jsonResponse({ ok: false, reason: result.reason, code: result.code }, { status: result.status ?? 400 });
    }
    return jsonResponse({ ok: true, id: result.value.id });
  }

  return jsonResponse({ ok: false, reason: "Action inconnue." }, { status: 400 });
}

export const GET = withApiObservability("/api/admin/course-schedule", handleGet);
export const POST = withApiObservability("/api/admin/course-schedule", handlePost);
