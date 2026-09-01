import { slotAppliesToWeekView } from "../course-schedule/preview.ts";
import { LUNCH_PERIOD } from "../course-schedule/periods.ts";
import type { CourseScheduleSlot, CourseWeekday } from "../course-schedule/types.ts";
import { buildSchoolDayPlan } from "../school-days/day-plan.ts";
import type { PublicHoliday, SchoolDayException, SchoolDayWeekRow } from "../school-days/types.ts";
import type { SchoolWeekEntry } from "../school-year/types.ts";
import type { CourseSession } from "./types.ts";

export interface ComputeCourseSessionsInput {
  annualCourse: { id: string; contextId: string };
  slots: CourseScheduleSlot[];
  weeks: SchoolWeekEntry[];
  holidays?: PublicHoliday[];
  exceptions?: SchoolDayException[];
}

function slotActiveOnDate(slot: CourseScheduleSlot, date: string): boolean {
  if (slot.validFrom && date < slot.validFrom) return false;
  if (slot.validTo && date > slot.validTo) return false;
  return true;
}

function periodsAreAdjacent(leftEnd: number, rightStart: number): boolean {
  if (rightStart <= leftEnd) return true;
  if (leftEnd + 1 === rightStart) return leftEnd !== LUNCH_PERIOD && rightStart !== LUNCH_PERIOD;
  return false;
}

function mergeRanges(
  ranges: Array<{ periodStart: number; periodEnd: number; slotIds: string[] }>,
): Array<{ periodStart: number; periodEnd: number; slotIds: string[] }> {
  const ordered = [...ranges].sort(
    (left, right) => left.periodStart - right.periodStart || left.periodEnd - right.periodEnd,
  );
  const merged: Array<{ periodStart: number; periodEnd: number; slotIds: string[] }> = [];
  for (const range of ordered) {
    const last = merged[merged.length - 1];
    if (last && periodsAreAdjacent(last.periodEnd, range.periodStart)) {
      last.periodEnd = Math.max(last.periodEnd, range.periodEnd);
      for (const id of range.slotIds) {
        if (!last.slotIds.includes(id)) last.slotIds.push(id);
      }
      continue;
    }
    merged.push({
      periodStart: range.periodStart,
      periodEnd: range.periodEnd,
      slotIds: [...range.slotIds],
    });
  }
  return merged;
}

function sessionsForClassDay(options: {
  annualCourse: { id: string; contextId: string };
  slots: CourseScheduleSlot[];
  week: SchoolDayWeekRow;
  day: SchoolDayWeekRow["days"][number];
}): Omit<CourseSession, "sessionNumber">[] {
  const dayOfWeek = options.day.weekdayIndex as CourseWeekday;
  const applicable = options.slots.filter(
    (slot) =>
      slot.annualCourseId === options.annualCourse.id &&
      slot.dayOfWeek === dayOfWeek &&
      slotAppliesToWeekView(slot, options.week.weekKind) &&
      slotActiveOnDate(slot, options.day.date),
  );
  return mergeRanges(
    applicable.map((slot) => ({
      periodStart: slot.periodStart,
      periodEnd: slot.periodEnd,
      slotIds: [slot.id],
    })),
  ).map((range) => ({
    annualCourseId: options.annualCourse.id,
    contextId: options.annualCourse.contextId,
    date: options.day.date,
    dayOfWeek,
    schoolWeekNumber: options.week.number,
    weekKind: options.week.weekKind,
    periodStart: range.periodStart,
    periodEnd: range.periodEnd,
    slotIds: range.slotIds,
  }));
}

/**
 * Projette les créneaux d’un AnnualCourse sur le calendrier scolaire.
 * Vacances = semaines absentes du plan. Fériés / exceptions = état du jour.
 */
export function computeCourseSessions(input: ComputeCourseSessionsInput): CourseSession[] {
  const plan = buildSchoolDayPlan(input.weeks, input.holidays ?? [], input.exceptions ?? []);
  const raw: Omit<CourseSession, "sessionNumber">[] = [];
  for (const row of plan) {
    if (row.kind !== "week") continue;
    for (const day of row.days) {
      if (day.state !== "class") continue;
      raw.push(
        ...sessionsForClassDay({
          annualCourse: input.annualCourse,
          slots: input.slots,
          week: row,
          day,
        }),
      );
    }
  }
  raw.sort((left, right) => left.date.localeCompare(right.date) || left.periodStart - right.periodStart);
  return raw.map((session, index) => ({ ...session, sessionNumber: index + 1 }));
}
