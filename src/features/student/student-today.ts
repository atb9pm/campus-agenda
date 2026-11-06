import { calendarDateKey } from "../evaluations/coordination.ts";

export function studentCalendarDateNeedsRefresh(current: Date, now: Date): boolean {
  return calendarDateKey(current) !== calendarDateKey(now);
}

/** Délai jusqu’à 00:00:01 du jour calendaire suivant — pas de polling fréquent. */
export function msUntilNextLocalMidnight(from: Date): number {
  const next = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1, 0, 0, 1);
  return Math.max(250, next.getTime() - from.getTime());
}

/** Rechargement des publications élève pendant que la page reste ouverte. */
export const STUDENT_AGENDA_REFRESH_INTERVAL_MS = 5 * 60_000;
/** Évite de recharger à chaque bascule rapide d’onglet. */
export const STUDENT_AGENDA_REFRESH_MIN_GAP_MS = 30_000;

export function studentAgendaRefreshDue(lastLoadedAtMs: number, nowMs: number): boolean {
  return nowMs - lastLoadedAtMs >= STUDENT_AGENDA_REFRESH_MIN_GAP_MS;
}
