import { slotAppliesToWeekView } from "../course-schedule/preview.ts";
import type { CourseScheduleSlot, CourseWeekKind, CourseWeekday } from "../course-schedule/types.ts";
import { buildSchoolDayPlan } from "../school-days/day-plan.ts";
import type { PublicHoliday, SchoolDayException } from "../school-days/types.ts";
import type { SchoolWeekEntry } from "../school-year/types.ts";
import type { CourseSession, CourseSessionSegment } from "./types.ts";

export interface ComputeCourseSessionsCourse {
  id: string;
  classId: string;
  contextId: string;
}

/** Champs utilisés pour l’existence calendaire. Le rôle n’entre pas dans le calcul. */
export interface ComputeCourseSessionsMeetingDay {
  annualCourseId: string;
  dayOfWeek: CourseWeekday;
  weekKind: CourseWeekKind;
}

export interface ComputeCourseSessionsInput {
  schoolYearId: string;
  courses: ComputeCourseSessionsCourse[];
  slots: CourseScheduleSlot[];
  weeks: SchoolWeekEntry[];
  holidays?: PublicHoliday[];
  exceptions?: SchoolDayException[];
  /**
   * Plan de jours par cours. Absent, vide, ou cours sans ligne → calcul legacy
   * depuis les `CourseScheduleSlot`. Un plan non vide est autoritaire pour les dates.
   */
  meetingDays?: ComputeCourseSessionsMeetingDay[];
}

export function courseSessionKey(schoolYearId: string, annualCourseId: string, date: string): string {
  return `${schoolYearId}|${annualCourseId}|${date}`;
}

/** Inverse de `courseSessionKey`. `null` si la clé n’a pas la forme attendue. */
export function parseCourseSessionKey(
  key: string,
): { schoolYearId: string; annualCourseId: string; date: string } | null {
  const trimmed = key.trim();
  const first = trimmed.indexOf("|");
  const last = trimmed.lastIndexOf("|");
  if (first <= 0 || last <= first) return null;
  const schoolYearId = trimmed.slice(0, first);
  const annualCourseId = trimmed.slice(first + 1, last);
  const date = trimmed.slice(last + 1);
  if (!schoolYearId || !annualCourseId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return { schoolYearId, annualCourseId, date };
}

function slotActiveOnDate(slot: CourseScheduleSlot, date: string): boolean {
  if (slot.validFrom && date < slot.validFrom) return false;
  if (slot.validTo && date > slot.validTo) return false;
  return true;
}

function compareSegments(left: CourseSessionSegment, right: CourseSessionSegment): number {
  return (
    left.periodStart - right.periodStart ||
    left.periodEnd - right.periodEnd ||
    left.scheduleSlotId.localeCompare(right.scheduleSlotId)
  );
}

function groupMeetingDaysByCourse(
  days: ComputeCourseSessionsMeetingDay[] | undefined,
): Map<string, ComputeCourseSessionsMeetingDay[]> {
  const grouped = new Map<string, ComputeCourseSessionsMeetingDay[]>();
  for (const day of days ?? []) {
    const list = grouped.get(day.annualCourseId);
    if (list) list.push(day);
    else grouped.set(day.annualCourseId, [day]);
  }
  return grouped;
}

function meetingDayAppliesToDate(
  days: ComputeCourseSessionsMeetingDay[],
  dayOfWeek: CourseWeekday,
  weekKind: CourseSession["weekKind"],
): boolean {
  return days.some(
    (day) => day.dayOfWeek === dayOfWeek && slotAppliesToWeekView(day, weekKind),
  );
}

interface SessionAccumulator {
  course: ComputeCourseSessionsCourse;
  date: string;
  dayOfWeek: CourseWeekday;
  schoolWeekNumber: number;
  weekKind: CourseSession["weekKind"];
  segments: CourseSessionSegment[];
}

/**
 * Projette un AnnualCourse sur le calendrier scolaire.
 *
 * Si le cours a un plan de meeting days (au moins une ligne fournie) :
 * les dates viennent exclusivement de ce plan ; les slots n’ajoutent que des segments.
 * Sinon : comportement legacy — les CourseScheduleSlot créent les dates.
 *
 * Vacances = semaines absentes du plan. Fériés / exceptions = état du jour.
 * Groupement : une séance par couple (annualCourseId, date).
 * La date réelle vient de SchoolWeekEntry, jamais de schoolYear.endsOn.
 */
export function computeCourseSessions(input: ComputeCourseSessionsInput): CourseSession[] {
  const courseById = new Map(input.courses.map((course) => [course.id, course]));
  const meetingDaysByCourse = groupMeetingDaysByCourse(input.meetingDays);
  const coursesWithMeetingPlan = new Set(
    [...meetingDaysByCourse.entries()]
      .filter(([courseId, days]) => courseById.has(courseId) && days.length > 0)
      .map(([courseId]) => courseId),
  );
  const plan = buildSchoolDayPlan(input.weeks, input.holidays ?? [], input.exceptions ?? []);
  const groups = new Map<string, SessionAccumulator>();

  function ensureGroup(
    course: ComputeCourseSessionsCourse,
    date: string,
    dayOfWeek: CourseWeekday,
    schoolWeekNumber: number,
    weekKind: CourseSession["weekKind"],
  ): SessionAccumulator {
    const key = courseSessionKey(input.schoolYearId, course.id, date);
    let group = groups.get(key);
    if (!group) {
      group = {
        course,
        date,
        dayOfWeek,
        schoolWeekNumber,
        weekKind,
        segments: [],
      };
      groups.set(key, group);
    }
    return group;
  }

  for (const row of plan) {
    if (row.kind !== "week") continue;
    for (const day of row.days) {
      if (day.state !== "class") continue;
      const dayOfWeek = day.weekdayIndex as CourseWeekday;

      for (const courseId of coursesWithMeetingPlan) {
        const course = courseById.get(courseId);
        const days = meetingDaysByCourse.get(courseId);
        if (!course || !days) continue;
        if (!meetingDayAppliesToDate(days, dayOfWeek, row.weekKind)) continue;
        ensureGroup(course, day.date, dayOfWeek, row.number, row.weekKind);
      }

      for (const slot of input.slots) {
        const course = courseById.get(slot.annualCourseId);
        if (!course) continue;
        if (slot.dayOfWeek !== dayOfWeek) continue;
        if (!slotAppliesToWeekView(slot, row.weekKind)) continue;
        if (!slotActiveOnDate(slot, day.date)) continue;

        if (coursesWithMeetingPlan.has(course.id)) {
          const existing = groups.get(courseSessionKey(input.schoolYearId, course.id, day.date));
          if (!existing) continue;
          existing.segments.push({
            scheduleSlotId: slot.id,
            periodStart: slot.periodStart,
            periodEnd: slot.periodEnd,
          });
          continue;
        }

        ensureGroup(course, day.date, dayOfWeek, row.number, row.weekKind).segments.push({
          scheduleSlotId: slot.id,
          periodStart: slot.periodStart,
          periodEnd: slot.periodEnd,
        });
      }
    }
  }

  const byCourse = new Map<string, SessionAccumulator[]>();
  for (const group of groups.values()) {
    const list = byCourse.get(group.course.id) ?? [];
    list.push(group);
    byCourse.set(group.course.id, list);
  }

  const sessions: CourseSession[] = [];
  for (const [annualCourseId, list] of byCourse) {
    list.sort((left, right) => left.date.localeCompare(right.date));
    list.forEach((group, index) => {
      const segments = [...group.segments].sort(compareSegments);
      sessions.push({
        key: courseSessionKey(input.schoolYearId, annualCourseId, group.date),
        schoolYearId: input.schoolYearId,
        annualCourseId,
        classId: group.course.classId,
        contextId: group.course.contextId,
        date: group.date,
        schoolWeekNumber: group.schoolWeekNumber,
        weekKind: group.weekKind,
        dayOfWeek: group.dayOfWeek,
        sequenceNumber: index + 1,
        segments,
      });
    });
  }

  sessions.sort(
    (left, right) =>
      left.date.localeCompare(right.date) ||
      left.annualCourseId.localeCompare(right.annualCourseId) ||
      left.sequenceNumber - right.sequenceNumber,
  );
  return sessions;
}
