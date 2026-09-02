import type { SchoolWeekEntry } from "../school-year/types.ts";
import type {
  PublicHoliday,
  SchoolDayCell,
  SchoolDayException,
  SchoolDayPlanRow,
  SchoolDayWeekRow,
} from "./types.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Jours ouvrés affichés : lundi à vendredi. */
export const SCHOOL_WEEKDAY_COUNT = 5;

export const SCHOOL_WEEKDAY_LABELS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi"] as const;

function parseIsoDate(isoDate: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDays(isoDate: string, days: number): string {
  const date = parseIsoDate(isoDate);
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}

/**
 * Date ISO (YYYY-MM-DD) d'une publication Agenda : lundi de la semaine scolaire + dayIndex (0 = lundi).
 * Réutilise le calendrier existant. Ne pas inventer un second calendrier.
 */
export function isoDateForSchoolWeekDay(
  weeks: ReadonlyArray<{ number: number; monday: string }>,
  schoolWeekNumber: number,
  dayIndex: number,
): string | null {
  if (!Number.isInteger(schoolWeekNumber) || !Number.isInteger(dayIndex)) return null;
  if (dayIndex < 0 || dayIndex >= SCHOOL_WEEKDAY_COUNT) return null;
  const week = weeks.find((entry) => entry.number === schoolWeekNumber);
  if (!week?.monday) return null;
  return addDays(week.monday, dayIndex);
}

export function isMonday(isoDate: string): boolean {
  return parseIsoDate(isoDate).getDay() === 1;
}

function weeksBetween(fromMonday: string, toMonday: string): number {
  const diff = parseIsoDate(toMonday).getTime() - parseIsoDate(fromMonday).getTime();
  return Math.round(diff / (7 * DAY_MS));
}

/**
 * Construit la grille des jours de l'année scolaire : une ligne par semaine du plan,
 * cinq jours par ligne, et une ligne « coupure » quand des semaines sont sautées
 * (vacances). Les fêtes marquent le jour concerné, une correction manuelle l'emporte.
 */
export function buildSchoolDayPlan(
  weeks: SchoolWeekEntry[],
  holidays: PublicHoliday[] = [],
  exceptions: SchoolDayException[] = [],
): SchoolDayPlanRow[] {
  const holidayByDate = new Map(holidays.map((entry) => [entry.date, entry.label]));
  const exceptionByDate = new Map(exceptions.map((entry) => [entry.date, entry]));
  const ordered = [...weeks].sort((left, right) => left.number - right.number);

  const rows: SchoolDayPlanRow[] = [];
  let previous: SchoolWeekEntry | null = null;

  for (const week of ordered) {
    if (previous) {
      const gap = weeksBetween(previous.monday, week.monday) - 1;
      if (gap > 0) {
        rows.push({
          kind: "break",
          fromMonday: addDays(previous.monday, 7),
          weekCount: gap,
          afterWeekNumber: previous.number,
        });
      }
    }

    const days: SchoolDayCell[] = [];
    for (let offset = 0; offset < SCHOOL_WEEKDAY_COUNT; offset += 1) {
      const date = addDays(week.monday, offset);
      const holidayLabel = holidayByDate.get(date) ?? null;
      const exception = exceptionByDate.get(date);

      days.push({
        date,
        weekdayIndex: offset + 1,
        state: exception?.state ?? (holidayLabel ? "holiday" : "class"),
        label: exception ? exception.label ?? holidayLabel : holidayLabel,
        isManual: Boolean(exception),
      });
    }

    rows.push({
      kind: "week",
      number: week.number,
      weekKind: week.kind,
      monday: week.monday,
      days,
    });
    previous = week;
  }

  return rows;
}

export function countClassDays(rows: SchoolDayPlanRow[]): number {
  return rows
    .filter((row): row is SchoolDayWeekRow => row.kind === "week")
    .flatMap((row) => row.days)
    .filter((day) => day.state === "class").length;
}

export function listHolidayDays(rows: SchoolDayPlanRow[]): SchoolDayCell[] {
  return rows
    .filter((row): row is SchoolDayWeekRow => row.kind === "week")
    .flatMap((row) => row.days)
    .filter((day) => day.state === "holiday");
}

/**
 * Contrôles non bloquants du plan des semaines : l'administrateur doit pouvoir
 * enregistrer une correction même si l'alternance est rompue par des vacances.
 */
export function checkWeekPlanConsistency(weeks: SchoolWeekEntry[]): string[] {
  const warnings: string[] = [];
  const seenNumbers = new Set<number>();
  const seenMondays = new Set<string>();
  const ordered = [...weeks].sort((left, right) => left.number - right.number);

  for (const week of ordered) {
    if (seenNumbers.has(week.number)) {
      warnings.push(`Semaine ${week.number} en double.`);
    }
    seenNumbers.add(week.number);

    if (seenMondays.has(week.monday)) {
      warnings.push(`Deux semaines partagent le lundi ${week.monday}.`);
    }
    seenMondays.add(week.monday);

    if (!isMonday(week.monday)) {
      warnings.push(`Semaine ${week.number} : ${week.monday} n'est pas un lundi.`);
    }
  }

  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (current.monday <= previous.monday) {
      warnings.push(`Semaine ${current.number} : date antérieure à la semaine ${previous.number}.`);
    }
    if (current.kind === previous.kind) {
      warnings.push(`Alternance A/B rompue entre les semaines ${previous.number} et ${current.number}.`);
    }
  }

  return warnings;
}
