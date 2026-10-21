import { annualCourseIdFromRuntimeSubjectId } from "../agenda-bridge/ids.ts";
import type { CourseDaySlot } from "../calendar/types.ts";
import { calendarDateKey } from "../evaluations/coordination.ts";
import type { CourseScheduleSlot } from "../course-schedule/types.ts";
import type { Subject } from "../../types/classroom.ts";

/** Créneau d’horaire exposé à l’agenda élève : pas d’identifiants internes ni de données enseignant. */
export type StudentDayScheduleSlot = Pick<
  CourseScheduleSlot,
  "annualCourseId" | "dayOfWeek" | "periodStart" | "periodEnd" | "weekKind" | "validFrom" | "validTo"
>;

export function toStudentDayScheduleSlot(slot: CourseScheduleSlot): StudentDayScheduleSlot {
  return {
    annualCourseId: slot.annualCourseId,
    dayOfWeek: slot.dayOfWeek,
    periodStart: slot.periodStart,
    periodEnd: slot.periodEnd,
    weekKind: slot.weekKind,
    validFrom: slot.validFrom,
    validTo: slot.validTo,
  };
}

export function classScopedStudentScheduleSlots(
  slots: readonly CourseScheduleSlot[],
  classCourseIds: ReadonlySet<string>,
): StudentDayScheduleSlot[] {
  return slots
    .filter((slot) => classCourseIds.has(slot.annualCourseId))
    .map(toStudentDayScheduleSlot);
}

export function annualCourseIdsForSubject(subject: Pick<Subject, "id" | "annualCourseId">): string[] {
  const ids = new Set<string>();
  const linked = subject.annualCourseId?.trim();
  if (linked) ids.add(linked);
  const fromRuntime = annualCourseIdFromRuntimeSubjectId(subject.id);
  if (fromRuntime) ids.add(fromRuntime);
  return [...ids];
}

function slotAppliesToCourseDay(slot: StudentDayScheduleSlot, day: CourseDaySlot): boolean {
  if (slot.dayOfWeek !== day.dayIndex + 1) return false;
  if (day.weekKind == null) {
    if (slot.weekKind !== "all") return false;
  } else if (slot.weekKind !== "all" && slot.weekKind !== day.weekKind) {
    return false;
  }
  const date = calendarDateKey(day.date);
  if (slot.validFrom && date < slot.validFrom) return false;
  if (slot.validTo && date > slot.validTo) return false;
  return true;
}

export function firstPeriodForSubjectOnDay(
  subject: Pick<Subject, "id" | "annualCourseId">,
  slots: readonly StudentDayScheduleSlot[],
  day: CourseDaySlot,
): number | null {
  const courseIds = new Set(annualCourseIdsForSubject(subject));
  if (!courseIds.size) return null;
  let first: number | null = null;
  for (const slot of slots) {
    if (!courseIds.has(slot.annualCourseId)) continue;
    if (!slotAppliesToCourseDay(slot, day)) continue;
    if (first == null || slot.periodStart < first) first = slot.periodStart;
  }
  return first;
}

function catalogIndex(subjectId: string, subjects: readonly Subject[]): number {
  const index = subjects.findIndex((subject) => subject.id === subjectId);
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}

export function compareSubjectsByDaySchedule(
  left: Pick<Subject, "id" | "annualCourseId">,
  right: Pick<Subject, "id" | "annualCourseId">,
  slots: readonly StudentDayScheduleSlot[],
  day: CourseDaySlot,
  subjects: readonly Subject[],
): number {
  const leftPeriod = firstPeriodForSubjectOnDay(left, slots, day);
  const rightPeriod = firstPeriodForSubjectOnDay(right, slots, day);
  const leftScheduled = leftPeriod != null;
  const rightScheduled = rightPeriod != null;
  if (leftScheduled && rightScheduled && leftPeriod !== rightPeriod) {
    return leftPeriod - rightPeriod;
  }
  if (leftScheduled !== rightScheduled) {
    return leftScheduled ? -1 : 1;
  }
  return catalogIndex(left.id, subjects) - catalogIndex(right.id, subjects) || left.id.localeCompare(right.id);
}

export function orderByDaySchedule<T extends { subject: Pick<Subject, "id" | "annualCourseId"> }>(
  entries: readonly T[],
  subjects: readonly Subject[],
  slots: readonly StudentDayScheduleSlot[] | undefined,
  day: CourseDaySlot | undefined,
): T[] {
  const copy = entries.slice();
  if (!slots?.length || !day) {
    return copy.sort(
      (left, right) =>
        catalogIndex(left.subject.id, subjects) - catalogIndex(right.subject.id, subjects)
        || left.subject.id.localeCompare(right.subject.id),
    );
  }
  return copy.sort((left, right) =>
    compareSubjectsByDaySchedule(left.subject, right.subject, slots, day, subjects),
  );
}
