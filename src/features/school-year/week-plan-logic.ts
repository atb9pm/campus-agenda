import type { SchoolWeekEntry, ParsedWeekPlan } from "./types.ts";
import type { SchoolWeekKind } from "../calendar/types.ts";

export const SCHOOL_WEEKS_EXPECTED = 38;

const MONTH_COLUMNS = [
  { name: "Août", month: 8, yearOffset: 0 },
  { name: "Septembre", month: 9, yearOffset: 0 },
  { name: "Octobre", month: 10, yearOffset: 0 },
  { name: "Novembre", month: 11, yearOffset: 0 },
  { name: "Décembre", month: 12, yearOffset: 0 },
  { name: "Janvier", month: 1, yearOffset: 1 },
  { name: "Février", month: 2, yearOffset: 1 },
  { name: "Mars", month: 3, yearOffset: 1 },
  { name: "Avril", month: 4, yearOffset: 1 },
  { name: "Mai", month: 5, yearOffset: 1 },
  { name: "Juin", month: 6, yearOffset: 1 },
] as const;

export function weekKindForNumber(weekNumber: number): SchoolWeekKind {
  return weekNumber % 2 === 1 ? "A" : "B";
}

export function extractWeekNumberFromCell(text: string | null | undefined): number | null {
  if (!text) return null;
  const normalized = text.replace(/\s+/g, " ").trim();
  const match = normalized.match(/\b(\d{1,2})\b/);
  if (!match) return null;
  const value = Number(match[1]);
  return value >= 1 && value <= SCHOOL_WEEKS_EXPECTED ? value : null;
}

export function parseSchoolYearLabel(text: string): string | null {
  const match = text.match(/Année scolaire\s+(\d{4}-\d{4})/i);
  return match?.[1] ?? null;
}

export function schoolYearBoundsFromLabel(label: string): { startsOn: string; endsOn: string } {
  const [startYearText] = label.split("-");
  const startYear = Number(startYearText);
  return {
    startsOn: `${startYear}-08-01`,
    endsOn: `${startYear + 1}-06-30`,
  };
}

/** Le numéro de semaine est parfois placé sur un dimanche dans le PDF — on normalise au lundi. */
export function mondayReferenceFromDate(year: number, month: number, day: number): string | null {
  const date = new Date(year, month - 1, day, 12);
  if (Number.isNaN(date.getTime())) return null;

  const weekday = date.getDay();
  if (weekday === 0) {
    date.setDate(date.getDate() + 1);
  } else if (weekday !== 1) {
    date.setDate(date.getDate() - (weekday - 1));
  }

  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export interface GridTextItem {
  text: string;
  x: number;
  y: number;
}

export interface GridTableRow {
  dayOfMonth: number;
  cells: Map<string, string>;
}

export function buildWeekPlanFromGrid(
  label: string,
  rows: GridTableRow[],
  startYear: number,
): ParsedWeekPlan {
  const warnings: string[] = [];
  const weekDates = new Map<number, string>();

  for (const row of rows) {
    for (const column of MONTH_COLUMNS) {
      const cellText = row.cells.get(column.name);
      const weekNumber = extractWeekNumberFromCell(cellText);
      if (!weekNumber) continue;

      const year = startYear + column.yearOffset;
      const monday = mondayReferenceFromDate(year, column.month, row.dayOfMonth);
      if (!monday) continue;

      const existing = weekDates.get(weekNumber);
      if (existing && existing !== monday) {
        // Faux positifs possibles (colonne jour droite, chevauchements) : garder la date la plus tôt.
        weekDates.set(weekNumber, existing < monday ? existing : monday);
        continue;
      }
      weekDates.set(weekNumber, monday);
    }
  }

  const weeks: SchoolWeekEntry[] = [];
  for (let number = 1; number <= SCHOOL_WEEKS_EXPECTED; number += 1) {
    const monday = weekDates.get(number);
    if (!monday) {
      warnings.push(`Semaine ${number} introuvable dans le PDF.`);
      continue;
    }
    weeks.push({
      number,
      kind: weekKindForNumber(number),
      monday,
    });
  }

  const bounds = schoolYearBoundsFromLabel(label);
  if (weeks.length !== SCHOOL_WEEKS_EXPECTED) {
    warnings.push(`Attendu ${SCHOOL_WEEKS_EXPECTED} semaines, trouvé ${weeks.length}.`);
  }

  weeks.sort((left, right) => left.number - right.number);

  return {
    label,
    startsOn: weeks[0]?.monday ?? bounds.startsOn,
    endsOn: weeks[weeks.length - 1]?.monday ?? bounds.endsOn,
    weeks,
    warnings,
  };
}

export function isReceivableWeekPlan(plan: ParsedWeekPlan): boolean {
  return plan.weeks.length === SCHOOL_WEEKS_EXPECTED && plan.warnings.length === 0;
}

export { MONTH_COLUMNS };
