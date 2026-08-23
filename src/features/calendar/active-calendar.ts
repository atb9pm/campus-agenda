import { SCHOOL_WEEK_MONDAYS } from "./school-week-dates.ts";
import type { SchoolWeek } from "./types.ts";
import type { SchoolWeekEntry } from "../school-year/types.ts";

let activeWeekEntries: ReadonlyArray<SchoolWeekEntry> | null = null;

function parseLocalDate(isoDate: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

export function setActiveSchoolWeekEntries(entries: ReadonlyArray<SchoolWeekEntry> | null): void {
  activeWeekEntries = entries;
}

export function resetActiveSchoolWeekEntries(): void {
  activeWeekEntries = null;
}

export function getSchoolWeekEntries(): ReadonlyArray<{ number: number; kind: "A" | "B"; monday: string }> {
  if (activeWeekEntries && activeWeekEntries.length > 0) {
    return activeWeekEntries;
  }
  return SCHOOL_WEEK_MONDAYS;
}

export function buildSchoolWeeksFromEntries(
  entries: ReadonlyArray<{ number: number; kind: "A" | "B"; monday: string }>,
): SchoolWeek[] {
  return entries.map((entry) => ({
    number: entry.number,
    kind: entry.kind,
    monday: parseLocalDate(entry.monday),
  }));
}

export function getActiveSchoolWeeks(): SchoolWeek[] {
  return buildSchoolWeeksFromEntries(getSchoolWeekEntries());
}
