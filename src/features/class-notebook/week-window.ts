import type { SchoolWeek } from "../calendar/types.ts";

export type WeekDisplayCount = 1 | 2 | 3 | 4;

export function clampWeekDisplayCount(value: number): WeekDisplayCount {
  if (value <= 1) return 1;
  if (value === 2) return 2;
  if (value >= 4) return 4;
  return 3;
}

export function visibleSchoolWeeks(
  weeks: SchoolWeek[],
  centerWeekNumber: number,
  count: WeekDisplayCount,
): SchoolWeek[] {
  if (!weeks.length) return [];

  const centerIndex = weeks.findIndex((week) => week.number === centerWeekNumber);
  const anchor = centerIndex >= 0 ? centerIndex : 0;
  const leftOffset = Math.floor((count - 1) / 2);
  let start = anchor - leftOffset;
  if (start < 0) start = 0;
  if (start + count > weeks.length) start = Math.max(0, weeks.length - count);

  return weeks.slice(start, start + count);
}

export function formatWeekColumnLabel(week: SchoolWeek): string {
  return `Sem ${String(week.number).padStart(2, "0")}-${week.kind}`;
}

export function formatWeekColumnSubtitle(week: SchoolWeek): string {
  return week.kind === "A" ? "lun" : "lun + jeu";
}
