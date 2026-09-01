import { slotAppliesToWeekView } from "../course-schedule/preview.ts";
import type { CourseScheduleSlot, CourseWeekday } from "../course-schedule/types.ts";
import { buildSchoolDayPlan } from "../school-days/day-plan.ts";
import type { PublicHoliday, SchoolDayException } from "../school-days/types.ts";
import type { SchoolWeekEntry } from "../school-year/types.ts";
import type { CourseSession, CourseSessionSegment } from "./types.ts";

export interface ComputeCourseSessionsCourse {
  id: string;
  classId: string;
  contextId: string;
}

export interface ComputeCourseSessionsInput {
  schoolYearId: string;
  courses: ComputeCourseSessionsCourse[];
  slots: CourseScheduleSlot[];
  weeks: SchoolWeekEntry[];
  holidays?: PublicHoliday[];
  exceptions?: SchoolDayException[];
}

export function courseSessionKey(schoolYearId: string, annualCourseId: string, date: string): string {
  return `${schoolYearId}|${annualCourseId}|${date}`;
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

interface SessionAccumulator {
  course: ComputeCourseSessionsCourse;
  date: string;
  dayOfWeek: CourseWeekday;
  schoolWeekNumber: number;
  weekKind: CourseSession["weekKind"];
  segments: CourseSessionSegment[];
}

/**
 * Projette les créneaux des AnnualCourse sur le calendrier scolaire.
 * Vacances = semaines absentes du plan. Fériés / exceptions = état du jour.
 * Groupement : une séance par couple (annualCourseId, date).
 * La date réelle vient de SchoolWeekEntry, jamais de schoolYear.endsOn.
 */
export function computeCourseSessions(input: ComputeCourseSessionsInput): CourseSession[] {
  const courseById = new Map(input.courses.map((course) => [course.id, course]));
  const plan = buildSchoolDayPlan(input.weeks, input.holidays ?? [], input.exceptions ?? []);
  const groups = new Map<string, SessionAccumulator>();

  for (const row of plan) {
    if (row.kind !== "week") continue;
    for (const day of row.days) {
      if (day.state !== "class") continue;
      const dayOfWeek = day.weekdayIndex as CourseWeekday;
      for (const slot of input.slots) {
        const course = courseById.get(slot.annualCourseId);
        if (!course) continue;
        if (slot.dayOfWeek !== dayOfWeek) continue;
        if (!slotAppliesToWeekView(slot, row.weekKind)) continue;
        if (!slotActiveOnDate(slot, day.date)) continue;

        const key = courseSessionKey(input.schoolYearId, course.id, day.date);
        let group = groups.get(key);
        if (!group) {
          group = {
            course,
            date: day.date,
            dayOfWeek,
            schoolWeekNumber: row.number,
            weekKind: row.weekKind,
            segments: [],
          };
          groups.set(key, group);
        }
        group.segments.push({
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
