import { attendanceDaysForWeek } from "../course-schedule/class-attendance.ts";
import { slotAppliesToWeekView } from "../course-schedule/preview.ts";
import type { ClassAttendanceDay, CourseScheduleSlot, CourseWeekday } from "../course-schedule/types.ts";
import type { CourseDaySlot, SchoolWeek, SchoolWeekKind } from "./types.ts";

function parseLocalDate(isoDate: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
}

/** Indice Agenda (lundi=0) ↔ jour ISO (lundi=1). */
export function agendaDayIndexFromIsoWeekday(dayOfWeek: CourseWeekday): number {
  return dayOfWeek - 1;
}

export function isoWeekdayFromAgendaDayIndex(dayIndex: number): CourseWeekday | null {
  if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex > 4) return null;
  return (dayIndex + 1) as CourseWeekday;
}

/**
 * Jours de présence d'une classe pour une semaine A/B, depuis ClassAttendanceDay.
 * Ne suppose jamais « lundi + jeudi B ».
 */
export function getCourseDaysForAttendanceWeek(
  week: SchoolWeek,
  days: Array<Pick<ClassAttendanceDay, "dayOfWeek" | "weekKind" | "role">>,
): CourseDaySlot[] {
  const asDays = days.map((day, index) => ({
    id: `tmp-${index}`,
    classId: "",
    dayOfWeek: day.dayOfWeek,
    weekKind: day.weekKind,
    role: day.role ?? "ADDITIONAL",
    createdAt: "",
    updatedAt: "",
  })) as ClassAttendanceDay[];
  const monday = startOfDay(week.monday);
  return attendanceDaysForWeek(asDays, week.kind).map((day) => {
    const date = new Date(monday);
    date.setDate(date.getDate() + (day.dayOfWeek - 1));
    return {
      schoolWeekNumber: week.number,
      weekKind: week.kind,
      date,
      dayIndex: agendaDayIndexFromIsoWeekday(day.dayOfWeek),
    };
  });
}

export function attendanceCoversAgendaDay(
  days: Array<Pick<ClassAttendanceDay, "dayOfWeek" | "weekKind" | "role">>,
  weekKind: SchoolWeekKind,
  dayIndex: number,
): boolean {
  const iso = isoWeekdayFromAgendaDayIndex(dayIndex);
  if (!iso) return false;
  return getCourseDaysForAttendanceWeek(
    { number: 0, kind: weekKind, monday: parseLocalDate("2026-01-05") },
    days,
  ).some((slot) => slot.dayIndex === dayIndex);
}

export function listAllAttendanceCourseDays(
  weeks: SchoolWeek[],
  days: Array<Pick<ClassAttendanceDay, "dayOfWeek" | "weekKind" | "role">>,
): CourseDaySlot[] {
  return weeks.flatMap((week) => getCourseDaysForAttendanceWeek(week, days));
}

export function resolveDisplayCourseDayFromAttendance(
  today: Date,
  weeks: SchoolWeek[],
  days: Array<Pick<ClassAttendanceDay, "dayOfWeek" | "weekKind" | "role">>,
): CourseDaySlot | null {
  const all = listAllAttendanceCourseDays(weeks, days);
  if (!all.length) return null;
  const todayStart = startOfDay(today).getTime();
  const onToday = all.find((slot) => startOfDay(slot.date).getTime() === todayStart);
  if (onToday) return onToday;
  const upcoming = all
    .filter((slot) => startOfDay(slot.date).getTime() >= todayStart)
    .sort((left, right) => left.date.getTime() - right.date.getTime());
  return upcoming[0] ?? all[all.length - 1];
}

export function listPreviousAttendanceCourseDays(
  beforeDate: Date,
  limit: number,
  weeks: SchoolWeek[],
  days: Array<Pick<ClassAttendanceDay, "dayOfWeek" | "weekKind" | "role">>,
): CourseDaySlot[] {
  const before = startOfDay(beforeDate).getTime();
  return listAllAttendanceCourseDays(weeks, days)
    .filter((slot) => startOfDay(slot.date).getTime() < before)
    .sort((left, right) => right.date.getTime() - left.date.getTime())
    .slice(0, limit);
}

/**
 * Un créneau d'horaire (segment, pas une séance) autorise-t-il ce jour d'agenda
 * pour la semaine A ou B ?
 */
export function scheduleSlotAllowsAgendaDay(
  slots: CourseScheduleSlot[],
  weekKind: SchoolWeekKind,
  dayIndex: number,
): boolean {
  const iso = isoWeekdayFromAgendaDayIndex(dayIndex);
  if (!iso) return false;
  return slots.some(
    (slot) => slot.dayOfWeek === iso && slotAppliesToWeekView(slot, weekKind),
  );
}
