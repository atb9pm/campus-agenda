/** Pause de midi : structure de journée, jamais un créneau de cours. */
export const LUNCH_PERIOD = 5;

export const TEACHABLE_PERIODS = [1, 2, 3, 4, 6, 7, 8, 9, 10] as const;
export type TeachablePeriod = (typeof TEACHABLE_PERIODS)[number];

export const MORNING_PERIODS = [1, 2, 3, 4] as const;
export const AFTERNOON_PERIODS = [6, 7, 8, 9, 10] as const;
export const ALL_DAY_PERIODS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

export function isTeachablePeriod(value: number): value is TeachablePeriod {
  return (TEACHABLE_PERIODS as readonly number[]).includes(value);
}

export function isLunchPeriod(value: number): boolean {
  return value === LUNCH_PERIOD;
}

export function periodLabel(period: number): string {
  if (period === LUNCH_PERIOD) return "5 — Pause de midi";
  return `P${period}`;
}

export function formatPeriodRange(start: number, end: number): string {
  if (start === end) return String(start);
  return `${start}–${end}`;
}

/** Un intervalle traverse la pause s’il commence le matin et finit l’après-midi. */
export function rangeCrossesLunch(periodStart: number, periodEnd: number): boolean {
  return periodStart <= 4 && periodEnd >= 6;
}

/** Fins autorisées pour un début donné : jamais P5, jamais de traversée de pause. */
export function allowedPeriodEnds(periodStart: number): number[] {
  if (!isTeachablePeriod(periodStart)) return [];
  if (periodStart <= 4) {
    return TEACHABLE_PERIODS.filter((period) => period >= periodStart && period <= 4);
  }
  return TEACHABLE_PERIODS.filter((period) => period >= periodStart);
}

export function periodsOverlap(
  leftStart: number,
  leftEnd: number,
  rightStart: number,
  rightEnd: number,
): boolean {
  return leftStart <= rightEnd && rightStart <= leftEnd;
}
