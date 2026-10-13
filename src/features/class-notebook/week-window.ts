import type { SchoolWeek } from "../calendar/types.ts";

export type WeekDisplayCount = 1 | 2 | 3 | 4;

/** Aligné sur le breakpoint CSS `@media (max-width: 760px)` du Carnet. */
export const NOTEBOOK_NARROW_VIEWPORT_MAX_PX = 760;

export function clampWeekDisplayCount(value: number): WeekDisplayCount {
  if (value <= 1) return 1;
  if (value === 2) return 2;
  if (value >= 4) return 4;
  return 3;
}

/**
 * Sur smartphone (≤ 760 px) le Carnet n’affiche qu’une semaine :
 * la grille CSS force déjà une colonne, donc 2 / 3 / 4 semaines
 * s’empilent sans apporter de vue multi-colonnes.
 * La préférence desktop (1–4) n’est pas écrasée.
 */
export function notebookWeekDisplayCountForViewport(
  viewportWidthPx: number,
  preferred: WeekDisplayCount,
): WeekDisplayCount {
  if (viewportWidthPx <= NOTEBOOK_NARROW_VIEWPORT_MAX_PX) return 1;
  return preferred;
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
  const padded = String(week.number).padStart(2, "0");
  if (week.kind === "A" || week.kind === "B") {
    return `Sem ${padded}-${week.kind}`;
  }
  return `Sem ${padded}`;
}

export function formatWeekColumnSubtitle(week: SchoolWeek): string {
  if (week.kind === "A") return "lun";
  if (week.kind === "B") return "lun + jeu";
  return "cours";
}
