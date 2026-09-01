import { getActiveSchoolWeeks } from "./active-calendar.ts";
import type { CourseDaySlot, SchoolWeek, TmaCourseSchedule } from "./types.ts";
import { DEFAULT_TMA_SCHEDULE } from "./types.ts";

function parseLocalDate(isoDate: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
}

function isSameDay(left: Date, right: Date): boolean {
  return startOfDay(left).getTime() === startOfDay(right).getTime();
}

export function buildSchoolWeeks(): SchoolWeek[] {
  return getActiveSchoolWeeks();
}

export function findSchoolWeekForDate(date: Date, weeks = buildSchoolWeeks()): SchoolWeek {
  const target = startOfDay(date).getTime();
  for (const week of weeks) {
    const monday = startOfDay(week.monday).getTime();
    const sunday = monday + 6 * 24 * 60 * 60 * 1000;
    if (target >= monday && target <= sunday) {
      return week;
    }
  }
  if (target < startOfDay(weeks[0].monday).getTime()) {
    return weeks[0];
  }
  return weeks[weeks.length - 1];
}

export function courseDayKey(slot: CourseDaySlot): string {
  const iso = startOfDay(slot.date).toISOString().slice(0, 10);
  return `${slot.schoolWeekNumber}-${slot.weekKind}-${slot.dayIndex}-${iso}`;
}

/**
 * LEGACY ADAPTER — jours TMA historiques (lundi toutes les semaines, jeudi en B).
 * Les vues runtime d'une classe structurée doivent utiliser
 * `getCourseDaysForAttendanceWeek` (ClassAttendanceDay), pas ce défaut.
 */
export function getCourseDaysForWeek(
  week: SchoolWeek,
  schedule: TmaCourseSchedule = DEFAULT_TMA_SCHEDULE,
): CourseDaySlot[] {
  const monday = startOfDay(week.monday);
  const slots: CourseDaySlot[] = [
    {
      schoolWeekNumber: week.number,
      weekKind: week.kind,
      date: monday,
      dayIndex: schedule.mondayIndex,
    },
  ];

  if (week.kind === "B") {
    const thursday = new Date(monday);
    thursday.setDate(thursday.getDate() + schedule.thursdayIndex);
    slots.push({
      schoolWeekNumber: week.number,
      weekKind: week.kind,
      date: thursday,
      dayIndex: schedule.thursdayIndex,
    });
  }

  return slots;
}

export function listAllCourseDays(
  weeks = buildSchoolWeeks(),
  schedule: TmaCourseSchedule = DEFAULT_TMA_SCHEDULE,
): CourseDaySlot[] {
  return weeks.flatMap((week) => getCourseDaysForWeek(week, schedule));
}

/** Prochain jour de cours à afficher selon la date du jour. */
export function resolveDisplayCourseDay(
  today: Date,
  weeks = buildSchoolWeeks(),
  schedule: TmaCourseSchedule = DEFAULT_TMA_SCHEDULE,
): CourseDaySlot {
  const week = findSchoolWeekForDate(today, weeks);
  const courseDays = getCourseDaysForWeek(week, schedule);
  const todayStart = startOfDay(today);

  for (const slot of courseDays) {
    if (isSameDay(slot.date, todayStart)) {
      return slot;
    }
  }

  if (week.kind === "B") {
    const thursday = courseDays.find((slot) => slot.dayIndex === schedule.thursdayIndex);
    if (thursday && todayStart.getTime() < startOfDay(thursday.date).getTime()) {
      return thursday;
    }
  }

  const weekIndex = weeks.findIndex((entry) => entry.number === week.number);
  const nextWeek = weeks[Math.min(weekIndex + 1, weeks.length - 1)];
  return getCourseDaysForWeek(nextWeek, schedule)[0];
}

export function listPreviousCourseDays(
  beforeDate: Date,
  limit = 12,
  weeks = buildSchoolWeeks(),
  schedule: TmaCourseSchedule = DEFAULT_TMA_SCHEDULE,
): CourseDaySlot[] {
  const before = startOfDay(beforeDate).getTime();
  return listAllCourseDays(weeks, schedule)
    .filter((slot) => startOfDay(slot.date).getTime() < before)
    .sort((left, right) => right.date.getTime() - left.date.getTime())
    .slice(0, limit);
}

export function formatSchoolWeekLabel(slot: CourseDaySlot): string {
  return `Semaine ${String(slot.schoolWeekNumber).padStart(2, "0")}-${slot.weekKind}`;
}

export function formatCourseDayHeading(slot: CourseDaySlot): string {
  const weekday = new Intl.DateTimeFormat("fr-CH", { weekday: "long" }).format(slot.date);
  const datePart = new Intl.DateTimeFormat("fr-CH", { day: "numeric", month: "long" }).format(slot.date);
  const capitalizedWeekday = weekday.charAt(0).toUpperCase() + weekday.slice(1);
  return `${capitalizedWeekday} ${datePart.replace(".", "")}`;
}

export function findSchoolWeekByNumber(number: number, weeks = buildSchoolWeeks()): SchoolWeek {
  return weeks.find((week) => week.number === number) ?? weeks[0];
}

export function formatSchoolWeekOptionLabel(week: SchoolWeek): string {
  return `Semaine ${String(week.number).padStart(2, "0")}-${week.kind}`;
}

export interface CourseDayOption {
  dayIndex: number;
  label: string;
}

export function getCourseDayOptionsForSchoolWeek(
  schoolWeekNumber: number,
  weeks = buildSchoolWeeks(),
  schedule: TmaCourseSchedule = DEFAULT_TMA_SCHEDULE,
): CourseDayOption[] {
  const week = findSchoolWeekByNumber(schoolWeekNumber, weeks);
  return getCourseDaysForWeek(week, schedule).map((slot) => ({
    dayIndex: slot.dayIndex,
    label: formatCourseDayHeading(slot),
  }));
}

export function isValidCourseDayForSchoolWeek(
  schoolWeekNumber: number,
  dayIndex: number,
  weeks = buildSchoolWeeks(),
  schedule: TmaCourseSchedule = DEFAULT_TMA_SCHEDULE,
): boolean {
  return getCourseDayOptionsForSchoolWeek(schoolWeekNumber, weeks, schedule)
    .some((option) => option.dayIndex === dayIndex);
}

export function formatCourseDayMenuLabel(slot: CourseDaySlot): string {
  return `${formatSchoolWeekLabel(slot)} — ${formatCourseDayHeading(slot)}`;
}
