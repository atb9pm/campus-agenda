import { calendarDateKey } from "../evaluations/coordination.ts";

export function studentCalendarDateNeedsRefresh(current: Date, now: Date): boolean {
  return calendarDateKey(current) !== calendarDateKey(now);
}

/** Délai jusqu’à 00:00:01 du jour calendaire suivant — pas de polling fréquent. */
export function msUntilNextLocalMidnight(from: Date): number {
  const next = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1, 0, 0, 1);
  return Math.max(250, next.getTime() - from.getTime());
}
