import type { SchoolWeek } from "../calendar/types.ts";
import { COURSE_WEEKDAY_LABELS } from "../course-schedule/types.ts";
import { formatCourseSessionPeriods } from "../course-sessions/format.ts";
import type { CourseSession } from "../course-sessions/types.ts";
import { resolveAgendaItemSession } from "../notebook-export/session-match.ts";
import type { PrototypeAgendaItem } from "../agenda/demo-items.ts";
import type { WeekDisplayCount } from "./week-window.ts";
import { formatWeekColumnLabel } from "./week-window.ts";

function shortIsoDayMonth(isoDate: string): string {
  const [, month, day] = isoDate.split("-");
  if (!month || !day) return isoDate;
  return `${day}.${month}`;
}

export function orderedCourseSessions(sessions: readonly CourseSession[]): CourseSession[] {
  return [...sessions].sort(
    (left, right) =>
      left.date.localeCompare(right.date) ||
      left.dayOfWeek - right.dayOfWeek ||
      left.sequenceNumber - right.sequenceNumber ||
      left.key.localeCompare(right.key),
  );
}

export function snapToCourseSession(
  sessions: readonly CourseSession[],
  requestedKey: string | null | undefined,
  fallbackWeekNumber?: number,
): CourseSession | null {
  const ordered = orderedCourseSessions(sessions);
  if (!ordered.length) return null;
  if (requestedKey) {
    const exact = ordered.find((session) => session.key === requestedKey);
    if (exact) return exact;
  }
  if (fallbackWeekNumber != null) {
    const inWeek = ordered.find((session) => session.schoolWeekNumber >= fallbackWeekNumber);
    if (inWeek) return inWeek;
  }
  return ordered[0] ?? null;
}

export function visibleCourseSessions(
  sessions: readonly CourseSession[],
  startKey: string | null | undefined,
  count: WeekDisplayCount,
): CourseSession[] {
  const ordered = orderedCourseSessions(sessions);
  if (!ordered.length) return [];
  const startIndex = startKey ? ordered.findIndex((session) => session.key === startKey) : 0;
  let start = startIndex >= 0 ? startIndex : 0;
  if (start + count > ordered.length) start = Math.max(0, ordered.length - count);
  return ordered.slice(start, start + count);
}

export function shiftCourseSession(
  sessions: readonly CourseSession[],
  currentKey: string | null | undefined,
  direction: -1 | 1,
): CourseSession | null {
  const ordered = orderedCourseSessions(sessions);
  if (!ordered.length) return null;
  const index = currentKey ? ordered.findIndex((session) => session.key === currentKey) : -1;
  if (index < 0) return snapToCourseSession(ordered, currentKey);
  return ordered[index + direction] ?? null;
}

export function schoolWeekForSession(
  schoolWeeks: readonly SchoolWeek[],
  session: Pick<CourseSession, "schoolWeekNumber">,
): SchoolWeek | null {
  return schoolWeeks.find((week) => week.number === session.schoolWeekNumber) ?? null;
}

/** Ex. `Lundi 26.10 · P7-P8` */
export function formatCourseSessionCardSubtitle(session: CourseSession): string {
  const weekday = COURSE_WEEKDAY_LABELS[session.dayOfWeek];
  const date = shortIsoDayMonth(session.date);
  const periods = formatCourseSessionPeriods(session.segments);
  return periods ? `${weekday} ${date} · ${periods}` : `${weekday} ${date}`;
}

export function formatCourseSessionCardWeekLabel(
  session: Pick<CourseSession, "schoolWeekNumber" | "weekKind">,
  week?: SchoolWeek | null,
): string {
  if (week) return formatWeekColumnLabel(week);
  const padded = String(session.schoolWeekNumber).padStart(2, "0");
  if (session.weekKind === "A" || session.weekKind === "B") {
    return `Sem ${padded}-${session.weekKind}`;
  }
  return `Sem ${padded}`;
}

export function itemsForCourseSession(
  items: readonly PrototypeAgendaItem[],
  session: CourseSession,
  allSessions: readonly CourseSession[],
): PrototypeAgendaItem[] {
  return items.filter((item) => {
    const resolved = resolveAgendaItemSession(item, allSessions);
    return resolved.kind !== "UNMATCHED" && resolved.session.key === session.key;
  });
}

export function moveTargetCourseSessions(
  sessions: readonly CourseSession[],
  currentKey: string,
): CourseSession[] {
  return orderedCourseSessions(sessions).filter((session) => session.key !== currentKey);
}

export function sessionNotesKey(courseSessionKey: string): string {
  return courseSessionKey.trim();
}
