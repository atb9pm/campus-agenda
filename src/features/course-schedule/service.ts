import type { AnnualCourseStore } from "../../lib/persistence/annual-course-types.ts";
import type { CourseScheduleStore } from "../../lib/persistence/course-schedule-types.ts";
import type { SchoolCatalogStore } from "../../lib/persistence/school-catalog-types.ts";
import type { SchoolYearStore } from "../../lib/persistence/school-year-types.ts";
import type { TeacherAccountStore } from "../../lib/persistence/teacher-account-types.ts";
import { findConflictingSlot } from "./conflicts.ts";
import { isOperationalAnnualCourse } from "./operational.ts";
import { validateCourseScheduleSlotInput } from "./validation.ts";
import type { CourseScheduleSlot, CourseScheduleSlotInput, ScheduleMutationResult } from "./types.ts";

export interface CourseScheduleServiceDeps {
  schedules: CourseScheduleStore;
  courses: AnnualCourseStore;
  catalog: SchoolCatalogStore;
  years: SchoolYearStore;
  teachers?: TeacherAccountStore;
}

function createId(): string {
  return `css-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

async function assertCourseMutable(
  deps: CourseScheduleServiceDeps,
  annualCourseId: string,
): Promise<ScheduleMutationResult<{ courseId: string; classId: string; schoolYearId: string }>> {
  const course = await deps.courses.getCourse(annualCourseId);
  if (!course) return { ok: false, reason: "Cours annuel introuvable.", status: 404 };
  if (course.isArchived) {
    return { ok: false, reason: "Ce cours annuel est archivé. Aucun nouveau créneau n’est possible.", status: 409 };
  }
  const year = (await deps.years.listSchoolYears()).find((entry) => entry.id === course.schoolYearId);
  if (!year) return { ok: false, reason: "Année scolaire introuvable.", status: 400 };
  if (year.status === "archived") {
    return { ok: false, reason: "Cette année scolaire est archivée (lecture seule).", status: 409 };
  }
  const schoolClass = (await deps.catalog.listClasses()).find((entry) => entry.id === course.classId);
  if (!schoolClass) return { ok: false, reason: "Classe introuvable.", status: 400 };
  if (schoolClass.isArchived) {
    return { ok: false, reason: "Cette classe est archivée (lecture seule).", status: 409 };
  }
  if (!schoolClass.isActive) {
    return { ok: false, reason: "Cette classe est désactivée. Aucun nouveau créneau opérationnel.", status: 409 };
  }
  return { ok: true, value: { courseId: course.id, classId: course.classId, schoolYearId: course.schoolYearId } };
}

async function classSlotsForConflict(
  deps: CourseScheduleServiceDeps,
  classId: string,
  schoolYearId: string,
): Promise<CourseScheduleSlot[]> {
  const courses = (await deps.courses.listCourses()).filter(
    (course) =>
      course.classId === classId &&
      course.schoolYearId === schoolYearId &&
      isOperationalAnnualCourse(course),
  );
  const courseIds = new Set(courses.map((course) => course.id));
  const slots = await deps.schedules.listSlots();
  return slots.filter((slot) => courseIds.has(slot.annualCourseId));
}

export async function createCourseScheduleSlot(
  deps: CourseScheduleServiceDeps,
  input: CourseScheduleSlotInput,
): Promise<ScheduleMutationResult<CourseScheduleSlot>> {
  const parsed = validateCourseScheduleSlotInput(input);
  if (!parsed.ok) return parsed;
  const mutable = await assertCourseMutable(deps, parsed.value.annualCourseId);
  if (!mutable.ok) return mutable;

  const existing = await classSlotsForConflict(deps, mutable.value.classId, mutable.value.schoolYearId);
  const conflict = findConflictingSlot({ ...parsed.value, id: "" }, existing);
  if (conflict) {
    return {
      ok: false,
      reason: "Ce créneau chevauche un autre cours de la même classe sur une semaine compatible.",
      status: 409,
      code: "OVERLAP",
    };
  }

  const timestamp = nowIso();
  const slot: CourseScheduleSlot = {
    id: createId(),
    annualCourseId: parsed.value.annualCourseId,
    dayOfWeek: parsed.value.dayOfWeek,
    periodStart: parsed.value.periodStart,
    periodEnd: parsed.value.periodEnd,
    weekKind: parsed.value.weekKind,
    // validFrom / validTo : réservés au futur support des changements d’horaire en cours d’année.
    validFrom: parsed.value.validFrom ?? null,
    validTo: parsed.value.validTo ?? null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  return { ok: true, value: await deps.schedules.createSlot(slot) };
}

export async function updateCourseScheduleSlot(
  deps: CourseScheduleServiceDeps,
  slotId: string,
  patch: Omit<CourseScheduleSlotInput, "annualCourseId">,
): Promise<ScheduleMutationResult<CourseScheduleSlot>> {
  const current = await deps.schedules.getSlot(slotId);
  if (!current) return { ok: false, reason: "Créneau introuvable.", status: 404 };
  const parsed = validateCourseScheduleSlotInput({ ...patch, annualCourseId: current.annualCourseId });
  if (!parsed.ok) return parsed;
  const mutable = await assertCourseMutable(deps, current.annualCourseId);
  if (!mutable.ok) return mutable;

  const existing = await classSlotsForConflict(deps, mutable.value.classId, mutable.value.schoolYearId);
  const next = {
    ...current,
    dayOfWeek: parsed.value.dayOfWeek,
    periodStart: parsed.value.periodStart,
    periodEnd: parsed.value.periodEnd,
    weekKind: parsed.value.weekKind,
    validFrom: parsed.value.validFrom ?? null,
    validTo: parsed.value.validTo ?? null,
    updatedAt: nowIso(),
  };
  const conflict = findConflictingSlot(next, existing);
  if (conflict) {
    return {
      ok: false,
      reason: "Ce créneau chevauche un autre cours de la même classe sur une semaine compatible.",
      status: 409,
      code: "OVERLAP",
    };
  }
  return { ok: true, value: await deps.schedules.updateSlot(next) };
}

export async function deleteCourseScheduleSlot(
  deps: CourseScheduleServiceDeps,
  slotId: string,
): Promise<ScheduleMutationResult<{ id: string }>> {
  const current = await deps.schedules.getSlot(slotId);
  if (!current) return { ok: false, reason: "Créneau introuvable.", status: 404 };
  const mutable = await assertCourseMutable(deps, current.annualCourseId);
  if (!mutable.ok) return mutable;
  await deps.schedules.deleteSlot(slotId);
  return { ok: true, value: { id: slotId } };
}

export async function listClassScheduleSlots(
  deps: CourseScheduleServiceDeps,
  classId: string,
  schoolYearId: string,
): Promise<CourseScheduleSlot[]> {
  return classSlotsForConflict(deps, classId, schoolYearId);
}

export function isClassScheduleWritable(options: {
  classIsActive: boolean;
  classIsArchived: boolean;
  yearStatus: string | null | undefined;
  courseIsArchived?: boolean;
}): boolean {
  if (options.yearStatus === "archived") return false;
  if (options.classIsArchived) return false;
  if (!options.classIsActive) return false;
  if (options.courseIsArchived) return false;
  return true;
}
