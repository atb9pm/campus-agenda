import type { SchoolWeek } from "../calendar/types.ts";
import { COURSE_WEEKDAY_LABELS } from "../course-schedule/types.ts";
import type { CourseSession } from "../course-sessions/types.ts";
import type { WeekDisplayCount } from "./week-window.ts";

function parseLocalIsoDate(isoDate: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1, 12);
}

function shortIsoDayMonth(isoDate: string): string {
  const [, month, day] = isoDate.split("-");
  if (!month || !day) return isoDate;
  return `${day}.${month}`;
}

export function courseSessionsForWeek(
  sessions: readonly CourseSession[],
  schoolWeekNumber: number,
): CourseSession[] {
  return sessions
    .filter((session) => session.schoolWeekNumber === schoolWeekNumber)
    .sort((left, right) => left.date.localeCompare(right.date) || left.dayOfWeek - right.dayOfWeek);
}

export function eligibleSchoolWeeksForSessions(
  schoolWeeks: readonly SchoolWeek[],
  sessions: readonly CourseSession[],
): SchoolWeek[] {
  const weekNumbers = new Set(sessions.map((session) => session.schoolWeekNumber));
  return schoolWeeks.filter((week) => weekNumbers.has(week.number));
}

export function eligibleCourseWeekNumbers(sessions: readonly CourseSession[]): number[] {
  return [...new Set(sessions.map((session) => session.schoolWeekNumber))].sort((left, right) => left - right);
}

/**
 * Prochaines semaines du cours à partir de `startWeekNumber` (inclus),
 * pas des semaines scolaires consécutives génériques.
 */
export function visibleCourseWeeks(
  eligibleWeeks: readonly SchoolWeek[],
  startWeekNumber: number,
  count: WeekDisplayCount,
): SchoolWeek[] {
  if (!eligibleWeeks.length) return [];
  const startIndex = eligibleWeeks.findIndex((week) => week.number === startWeekNumber);
  let start = startIndex >= 0 ? startIndex : 0;
  if (start + count > eligibleWeeks.length) start = Math.max(0, eligibleWeeks.length - count);
  return eligibleWeeks.slice(start, start + count);
}

export function snapToEligibleCourseWeek(
  eligibleWeekNumbers: readonly number[],
  requestedWeekNumber: number,
): number | null {
  if (!eligibleWeekNumbers.length) return null;
  const next = eligibleWeekNumbers.find((weekNumber) => weekNumber >= requestedWeekNumber);
  if (next != null) return next;
  return eligibleWeekNumbers[eligibleWeekNumbers.length - 1] ?? null;
}

export function shiftEligibleCourseWeek(
  eligibleWeekNumbers: readonly number[],
  currentWeekNumber: number,
  direction: -1 | 1,
): number | null {
  const index = eligibleWeekNumbers.indexOf(currentWeekNumber);
  if (index < 0) {
    return snapToEligibleCourseWeek(eligibleWeekNumbers, currentWeekNumber);
  }
  return eligibleWeekNumbers[index + direction] ?? null;
}

/** Ex. `JEU 24.09` ou `LUN 21.09 · JEU 24.09` — une entrée par date, pas par période. */
export function formatWeekColumnSubtitleFromSessions(sessions: readonly CourseSession[]): string {
  const uniqueByDate = new Map<string, CourseSession>();
  for (const session of [...sessions].sort((left, right) => left.date.localeCompare(right.date))) {
    if (!uniqueByDate.has(session.date)) uniqueByDate.set(session.date, session);
  }
  return [...uniqueByDate.values()]
    .map((session) => {
      const weekday = COURSE_WEEKDAY_LABELS[session.dayOfWeek].slice(0, 3).toLocaleUpperCase("fr-CH");
      return `${weekday} ${shortIsoDayMonth(session.date)}`;
    })
    .join(" · ");
}

export interface CourseControlDayOption {
  dayIndex: number;
  label: string;
  date: string;
}

export function formatControlSessionDayLabel(
  session: Pick<CourseSession, "date" | "dayOfWeek">,
): string {
  const date = parseLocalIsoDate(session.date);
  const datePart = new Intl.DateTimeFormat("fr-CH", { day: "numeric", month: "long" }).format(date);
  return `${COURSE_WEEKDAY_LABELS[session.dayOfWeek]} ${datePart.replace(".", "")}`;
}

export function controlDayOptionsForCourseWeek(
  sessions: readonly CourseSession[],
  schoolWeekNumber: number,
): CourseControlDayOption[] {
  const byDay = new Map<number, CourseSession>();
  for (const session of courseSessionsForWeek(sessions, schoolWeekNumber)) {
    const dayIndex = session.dayOfWeek - 1;
    if (!byDay.has(dayIndex)) byDay.set(dayIndex, session);
  }
  return [...byDay.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([dayIndex, session]) => ({
      dayIndex,
      label: formatControlSessionDayLabel(session),
      date: session.date,
    }));
}

export function isCourseControlSlotAllowed(
  sessions: readonly CourseSession[],
  schoolWeekNumber: number,
  dayIndex: number,
): boolean {
  return courseSessionForControlSlot(sessions, schoolWeekNumber, dayIndex) != null;
}

/** Vraie CourseSession du cours pour une case Carnet (semaine + jour). Jamais une clé reconstruite. */
export function courseSessionForControlSlot(
  sessions: readonly CourseSession[],
  schoolWeekNumber: number,
  dayIndex: number,
): CourseSession | null {
  const matches = courseSessionsForWeek(sessions, schoolWeekNumber).filter(
    (session) => session.dayOfWeek - 1 === dayIndex,
  );
  return matches.length === 1 ? matches[0]! : null;
}

export function moveTargetSchoolWeeks(
  eligibleWeeks: readonly SchoolWeek[],
  currentWeekNumber: number,
): SchoolWeek[] {
  return eligibleWeeks.filter((week) => week.number !== currentWeekNumber);
}

export function weekdayLabelForCourseDayIndex(dayIndex: number): string {
  const weekday = (dayIndex + 1) as keyof typeof COURSE_WEEKDAY_LABELS;
  return COURSE_WEEKDAY_LABELS[weekday]?.toLocaleLowerCase("fr-CH") ?? "";
}

/**
 * `AgendaItem.day` (0 = lundi … 4 = vendredi) pour une semaine du Carnet structuré.
 *
 * Une carte Carnet reste une semaine, même s’il y a plusieurs CourseSession.
 *
 * - un seul jour réel cette semaine → ce jour (jamais le jour générique de la classe) ;
 * - plusieurs jours, `existingDay` encore parmi les séances → le conserver ;
 * - plusieurs jours sans jour encore valide → première CourseSession par date ;
 * - aucune séance cette semaine → `null` (le caller garde le fallback legacy).
 */
export function publicationDayIndexForCourseWeek(
  sessions: readonly CourseSession[],
  schoolWeekNumber: number,
  existingDay?: number | null,
): number | null {
  const weekSessions = courseSessionsForWeek(sessions, schoolWeekNumber);
  if (!weekSessions.length) return null;
  const dayIndexes = [...new Set(weekSessions.map((session) => session.dayOfWeek - 1))];
  if (dayIndexes.length === 1) return dayIndexes[0] ?? null;
  if (existingDay != null && dayIndexes.includes(existingDay)) return existingDay;
  return weekSessions[0]!.dayOfWeek - 1;
}
