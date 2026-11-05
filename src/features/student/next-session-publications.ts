import type { PrototypeAgendaItem } from "../agenda/demo-items.ts";
import { isVisibleToStudent } from "../agenda/visibility.ts";
import type { CourseDaySlot, SchoolWeek } from "../calendar/types.ts";
import { calendarDateKey, calendarDaysBetween, slotFromWeekAndDay } from "../evaluations/coordination.ts";
import { publicationGroupKey } from "./course-day-view.ts";

/**
 * Couvre une alternance A/B (14 jours) suivie de deux semaines de vacances,
 * sans faire remonter des séances préparées plusieurs mois à l’avance.
 */
export const STUDENT_NEXT_SESSION_HORIZON_DAYS = 35;

export interface StudentNextSessionPublications {
  slot: CourseDaySlot;
  publications: PrototypeAgendaItem[];
}

/**
 * Par branche (AnnualCourse, sinon matière), publications élèves de la prochaine
 * séance publiée après le jour affiché. Les contrôles restent dans « Contrôles à venir ».
 */
export function nextSessionPublicationsByBranch(
  items: readonly PrototypeAgendaItem[],
  weeks: readonly SchoolWeek[],
  after: CourseDaySlot,
  horizonDays = STUDENT_NEXT_SESSION_HORIZON_DAYS,
): Map<string, StudentNextSessionPublications> {
  const afterKey = calendarDateKey(after.date);
  const weekByNumber = new Map(weeks.map((week) => [week.number, week]));
  const byBranch = new Map<string, { dateKey: string; slot: CourseDaySlot; publications: PrototypeAgendaItem[] }>();

  for (const item of items) {
    if (item.type === "TEST" || !isVisibleToStudent(item)) continue;
    if (!Number.isInteger(item.day) || item.day < 0 || item.day > 4) continue;
    const week = weekByNumber.get(item.schoolWeekNumber);
    if (!week) continue;
    const slot = slotFromWeekAndDay(week, item.day);
    const dateKey = calendarDateKey(slot.date);
    if (dateKey <= afterKey) continue;
    if (calendarDaysBetween(after.date, slot.date) > horizonDays) continue;

    const key = publicationGroupKey(item);
    const current = byBranch.get(key);
    if (!current || dateKey < current.dateKey) {
      byBranch.set(key, { dateKey, slot, publications: [item] });
    } else if (dateKey === current.dateKey) {
      current.publications.push(item);
    }
  }

  const result = new Map<string, StudentNextSessionPublications>();
  for (const [key, entry] of byBranch) {
    result.set(key, { slot: entry.slot, publications: entry.publications });
  }
  return result;
}

/** « Pour le jeudi 12 novembre » */
export function formatNextSessionLabel(date: Date): string {
  const weekday = new Intl.DateTimeFormat("fr-CH", { weekday: "long" }).format(date).toLocaleLowerCase("fr-CH");
  const dayMonth = new Intl.DateTimeFormat("fr-CH", { day: "numeric", month: "long" }).format(date);
  return `Pour le ${weekday} ${dayMonth}`;
}
