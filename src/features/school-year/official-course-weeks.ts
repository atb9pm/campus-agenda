import type { SchoolDayException } from "../school-days/types.ts";
import { addIsoDays } from "./official-plan-logic.ts";
import { pedagogicalWeekKind } from "./pedagogical-week-kinds.ts";
import type { SchoolWeekEntry } from "./types.ts";

export function mondayOfContainingWeek(isoDate: string): string {
  const date = new Date(`${isoDate}T12:00:00.000Z`);
  const weekday = date.getUTCDay();
  const offset = weekday === 0 ? -6 : 1 - weekday;
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function officialCourseWeekCountMismatchMessage(generated: number, announced: number): string {
  return `Le calendrier génère ${generated} semaines de cours alors que le document officiel en annonce ${announced}.`;
}

export function assertGeneratedWeeksMatchOfficialTotal(
  generatedCount: number,
  announced: number | null | undefined,
): void {
  if (announced == null) return;
  if (generatedCount !== announced) {
    throw new Error(officialCourseWeekCountMismatchMessage(generatedCount, announced));
  }
}

export interface GenerateOfficialCourseWeeksInput {
  startsOn: string;
  endsOn: string;
  exceptions: ReadonlyArray<Pick<SchoolDayException, "date" | "state">>;
}

export interface GenerateOfficialCourseWeeksResult {
  weeks: SchoolWeekEntry[];
  examinedCalendarWeekCount: number;
  excludedFullyClosedWeekCount: number;
}

/**
 * Semaines de cours lundi→dimanche : une semaine est retenue dès qu'un jour
 * lundi–vendredi compris dans l'année n'est pas holiday.
 * Les semaines entièrement fermées n'ont pas de numéro et n'avancent pas A/B.
 * Type : numéro pédagogique impair = A, pair = B.
 */
export function generateOfficialCourseWeeks(
  input: GenerateOfficialCourseWeeksInput,
): GenerateOfficialCourseWeeksResult {
  const holidays = new Set(
    input.exceptions.filter((entry) => entry.state === "holiday").map((entry) => entry.date),
  );
  const weeks: SchoolWeekEntry[] = [];
  let examinedCalendarWeekCount = 0;
  let excludedFullyClosedWeekCount = 0;

  let cursor = mondayOfContainingWeek(input.startsOn);
  const lastMonday = mondayOfContainingWeek(input.endsOn);

  while (cursor <= lastMonday) {
    examinedCalendarWeekCount += 1;
    const schoolDaysInYear: string[] = [];
    for (let offset = 0; offset < 5; offset += 1) {
      const date = addIsoDays(cursor, offset);
      if (date < input.startsOn || date > input.endsOn) continue;
      schoolDaysInYear.push(date);
    }

    if (schoolDaysInYear.length === 0) {
      cursor = addIsoDays(cursor, 7);
      continue;
    }

    const hasOpenDay = schoolDaysInYear.some((date) => !holidays.has(date));
    if (hasOpenDay) {
      const number = weeks.length + 1;
      weeks.push({
        number,
        kind: pedagogicalWeekKind(number),
        monday: cursor,
      });
    } else {
      excludedFullyClosedWeekCount += 1;
    }

    cursor = addIsoDays(cursor, 7);
  }

  return { weeks, examinedCalendarWeekCount, excludedFullyClosedWeekCount };
}

export function formatPedagogicalWeekLabel(week: { number: number; kind: "A" | "B" | null }): string {
  const padded = String(week.number).padStart(2, "0");
  if (week.kind === "A" || week.kind === "B") {
    return `Semaine ${padded}-${week.kind}`;
  }
  return `Semaine ${padded}`;
}
