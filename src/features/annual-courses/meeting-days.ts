/**
 * Jours de séance d’un AnnualCourse, sans périodes ni enseignants.
 * Distinct de ClassAttendanceDay (classe) et de CourseScheduleSlot (horaire détaillé).
 *
 * Un cours sans plan (0 ligne) reste valide.
 * Un plan non vide : exactement un PRIMARY, au plus un ADDITIONAL, jours distincts.
 * PRIMARY peut être all / A / B — contrairement au plan de présence de classe.
 */

import { randomUUID } from "node:crypto";

import { isAttendanceRole } from "../course-schedule/class-attendance.ts";
import {
  COURSE_WEEK_KINDS,
  type AttendanceRole,
  type CourseWeekKind,
  type CourseWeekday,
} from "../course-schedule/types.ts";
import { isCourseWeekday } from "../course-schedule/validation.ts";
import type { AnnualCourseStore } from "../../lib/persistence/annual-course-types.ts";
import type { CourseScheduleStore } from "../../lib/persistence/course-schedule-types.ts";

export interface AnnualCourseMeetingDay {
  id: string;
  annualCourseId: string;
  dayOfWeek: CourseWeekday;
  weekKind: CourseWeekKind;
  role: AttendanceRole;
  createdAt: string;
  updatedAt: string;
}

export interface AnnualCourseMeetingDayInput {
  dayOfWeek: CourseWeekday;
  weekKind: CourseWeekKind;
  role: AttendanceRole;
}

export type MeetingDayPlanOk<T> = { ok: true; value: T };
export type MeetingDayPlanErr = { ok: false; reason: string; status?: number };
export type MeetingDayPlanResult<T> = MeetingDayPlanOk<T> | MeetingDayPlanErr;

export const MEETING_DAY_NO_PRIMARY_REASON =
  "Un cours annuel avec un plan de jours doit avoir exactement un jour principal.";
export const MEETING_DAY_TWO_PRIMARY_REASON = "Un cours annuel ne peut avoir qu’un seul jour principal.";
export const MEETING_DAY_TOO_MANY_REASON =
  "Un cours annuel accepte au plus un jour principal et un jour complémentaire.";
export const MEETING_DAY_SAME_DAY_REASON = "Le jour complémentaire doit être différent du jour principal.";
export const MEETING_DAY_WEEKDAY_REASON = "Le jour doit être un jour de cours (lundi à vendredi).";
export const MEETING_DAY_WEEK_KIND_REASON =
  "Le rythme doit être Toutes les semaines, Semaine A ou Semaine B.";
export const MEETING_DAY_ROLE_REASON = "Le rôle doit être principal ou complémentaire.";
export const MEETING_DAY_COURSE_MISSING_REASON = "Cours annuel introuvable.";

export function validateAnnualCourseMeetingDayPlan(
  days: AnnualCourseMeetingDayInput[],
): MeetingDayPlanResult<AnnualCourseMeetingDayInput[]> {
  if (days.length === 0) return { ok: true, value: days };
  if (days.length > 2) {
    return { ok: false, reason: MEETING_DAY_TOO_MANY_REASON, status: 400 };
  }

  for (const day of days) {
    if (!isCourseWeekday(day.dayOfWeek)) {
      return { ok: false, reason: MEETING_DAY_WEEKDAY_REASON, status: 400 };
    }
    if (!(COURSE_WEEK_KINDS as readonly string[]).includes(day.weekKind)) {
      return { ok: false, reason: MEETING_DAY_WEEK_KIND_REASON, status: 400 };
    }
    if (!isAttendanceRole(day.role)) {
      return { ok: false, reason: MEETING_DAY_ROLE_REASON, status: 400 };
    }
  }

  const primaries = days.filter((day) => day.role === "PRIMARY");
  if (primaries.length === 0) {
    return { ok: false, reason: MEETING_DAY_NO_PRIMARY_REASON, status: 400 };
  }
  if (primaries.length > 1) {
    return { ok: false, reason: MEETING_DAY_TWO_PRIMARY_REASON, status: 400 };
  }

  const additionals = days.filter((day) => day.role === "ADDITIONAL");
  if (additionals.length > 1) {
    return { ok: false, reason: MEETING_DAY_TOO_MANY_REASON, status: 400 };
  }

  if (days.length === 2 && days[0]!.dayOfWeek === days[1]!.dayOfWeek) {
    return { ok: false, reason: MEETING_DAY_SAME_DAY_REASON, status: 400 };
  }

  return { ok: true, value: days };
}

function createMeetingDayId(): string {
  return `acmd-${randomUUID()}`;
}

export async function replaceAnnualCourseMeetingDays(
  deps: {
    courses: AnnualCourseStore;
    schedules: CourseScheduleStore;
    now?: () => string;
  },
  annualCourseId: string,
  inputDays: AnnualCourseMeetingDayInput[],
): Promise<MeetingDayPlanResult<AnnualCourseMeetingDay[]>> {
  const courseId = annualCourseId.trim();
  if (!courseId) {
    return { ok: false, reason: MEETING_DAY_COURSE_MISSING_REASON, status: 404 };
  }
  const course = await deps.courses.getCourse(courseId);
  if (!course) {
    return { ok: false, reason: MEETING_DAY_COURSE_MISSING_REASON, status: 404 };
  }

  const parsed = validateAnnualCourseMeetingDayPlan(inputDays);
  if (!parsed.ok) return parsed;

  const timestamp = deps.now?.() ?? new Date().toISOString();
  const days: AnnualCourseMeetingDay[] = parsed.value.map((day) => ({
    id: createMeetingDayId(),
    annualCourseId: courseId,
    dayOfWeek: day.dayOfWeek,
    weekKind: day.weekKind,
    role: day.role,
    createdAt: timestamp,
    updatedAt: timestamp,
  }));
  return { ok: true, value: await deps.schedules.replaceMeetingDaysForAnnualCourse(courseId, days) };
}
