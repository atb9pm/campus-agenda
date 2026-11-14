export const MAX_UPCOMING_CONTROL_DATES = [1, 2] as const;

export type MaxUpcomingControlDates = (typeof MAX_UPCOMING_CONTROL_DATES)[number];

export const MAX_UPCOMING_CONTROL_DATES_REASON =
  "Le nombre de prochaines dates de contrôle doit être 1 ou 2.";

/** Lecture : toute valeur autre que 2 reste le comportement actuel, une date. */
export function readMaxUpcomingControlDates(value: unknown): MaxUpcomingControlDates {
  return value === 2 ? 2 : 1;
}

export function parseMaxUpcomingControlDates(
  value: unknown,
): { ok: true; value: MaxUpcomingControlDates } | { ok: false; reason: string } {
  if (value === 1 || value === 2) return { ok: true, value };
  return { ok: false, reason: MAX_UPCOMING_CONTROL_DATES_REASON };
}

export function requireMaxUpcomingControlDates(value: unknown): MaxUpcomingControlDates {
  const parsed = parseMaxUpcomingControlDates(value);
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.value;
}
