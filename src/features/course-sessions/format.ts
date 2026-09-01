import { LUNCH_PERIOD } from "../course-schedule/periods.ts";
import { COURSE_WEEKDAY_LABELS } from "../course-schedule/types.ts";
import type { CourseSession, CourseSessionSegment } from "./types.ts";

export function formatSwissDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  if (!year || !month || !day) return isoDate;
  return `${day}.${month}.${year}`;
}

function occupiedPeriods(segments: ReadonlyArray<Pick<CourseSessionSegment, "periodStart" | "periodEnd">>): number[] {
  const periods = new Set<number>();
  for (const segment of segments) {
    for (let period = segment.periodStart; period <= segment.periodEnd; period += 1) {
      if (period !== LUNCH_PERIOD) periods.add(period);
    }
  }
  return [...periods].sort((left, right) => left - right);
}

/**
 * Présentation des périodes d’une séance.
 * Contiguës sans pause → `P2-P3` / `P1-P4`.
 * Séparées par la pause (P5) ou un trou → `P4 · P6`, jamais `P4-P6`.
 */
export function formatCourseSessionPeriods(
  segments: ReadonlyArray<Pick<CourseSessionSegment, "periodStart" | "periodEnd">>,
): string {
  const periods = occupiedPeriods(segments);
  if (periods.length === 0) return "";

  const groups: Array<{ start: number; end: number }> = [];
  for (const period of periods) {
    const last = groups[groups.length - 1];
    if (last && period === last.end + 1) {
      last.end = period;
      continue;
    }
    groups.push({ start: period, end: period });
  }

  return groups
    .map((group) => (group.start === group.end ? `P${group.start}` : `P${group.start}-P${group.end}`))
    .join(" · ");
}

export function formatCourseSessionNumber(sequenceNumber: number): string {
  return `Séance n° ${sequenceNumber}`;
}

/** Ex. `Moteur — lundi 07.09.2026` */
export function formatCourseSessionHeading(
  branchLabel: string,
  session: Pick<CourseSession, "date" | "dayOfWeek">,
): string {
  const weekday = COURSE_WEEKDAY_LABELS[session.dayOfWeek].toLocaleLowerCase("fr-CH");
  return `${branchLabel.trim() || "Branche"} — ${weekday} ${formatSwissDate(session.date)}`;
}

export function formatCourseSessionSummary(
  branchLabel: string,
  session: Pick<CourseSession, "date" | "dayOfWeek" | "sequenceNumber" | "segments">,
): string {
  return [
    formatCourseSessionHeading(branchLabel, session),
    formatCourseSessionNumber(session.sequenceNumber),
    formatCourseSessionPeriods(session.segments),
  ].join("\n");
}
