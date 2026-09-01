import { COURSE_WEEKDAY_LABELS } from "../course-schedule/types.ts";
import type { CourseSession } from "./types.ts";

export function formatSwissDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  if (!year || !month || !day) return isoDate;
  return `${day}.${month}.${year}`;
}

export function formatCourseSessionPeriods(periodStart: number, periodEnd: number): string {
  if (periodStart === periodEnd) return `P${periodStart}`;
  return `P${periodStart}-P${periodEnd}`;
}

export function formatCourseSessionNumber(sessionNumber: number): string {
  return `Séance n° ${sessionNumber}`;
}

/** Ex. `Moteur — lundi 07.09.2026` */
export function formatCourseSessionHeading(branchLabel: string, session: Pick<CourseSession, "date" | "dayOfWeek">): string {
  const weekday = COURSE_WEEKDAY_LABELS[session.dayOfWeek].toLocaleLowerCase("fr-CH");
  return `${branchLabel.trim() || "Branche"} — ${weekday} ${formatSwissDate(session.date)}`;
}

export function formatCourseSessionSummary(
  branchLabel: string,
  session: Pick<CourseSession, "date" | "dayOfWeek" | "sessionNumber" | "periodStart" | "periodEnd">,
): string {
  return [
    formatCourseSessionHeading(branchLabel, session),
    formatCourseSessionNumber(session.sessionNumber),
    formatCourseSessionPeriods(session.periodStart, session.periodEnd),
  ].join("\n");
}
