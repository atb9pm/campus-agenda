import type { SchoolWeekKind } from "./types.ts";

/** Lundis de référence — année scolaire 2026-2027 (plan des semaines). */
export const SCHOOL_WEEK_MONDAYS: ReadonlyArray<{
  number: number;
  kind: SchoolWeekKind;
  monday: string;
}> = [
  { number: 1, kind: "A", monday: "2026-08-17" },
  { number: 2, kind: "B", monday: "2026-08-24" },
  { number: 3, kind: "A", monday: "2026-08-31" },
  { number: 4, kind: "B", monday: "2026-09-07" },
  { number: 5, kind: "A", monday: "2026-09-14" },
  { number: 6, kind: "B", monday: "2026-09-21" },
  { number: 7, kind: "A", monday: "2026-09-28" },
  { number: 8, kind: "B", monday: "2026-10-05" },
  { number: 9, kind: "A", monday: "2026-10-26" },
  { number: 10, kind: "B", monday: "2026-11-02" },
  { number: 11, kind: "A", monday: "2026-11-09" },
  { number: 12, kind: "B", monday: "2026-11-16" },
  { number: 13, kind: "A", monday: "2026-11-23" },
  { number: 14, kind: "B", monday: "2026-11-30" },
  { number: 15, kind: "A", monday: "2026-12-07" },
  { number: 16, kind: "B", monday: "2026-12-14" },
  { number: 17, kind: "A", monday: "2027-01-04" },
  { number: 18, kind: "B", monday: "2027-01-11" },
  { number: 19, kind: "A", monday: "2027-01-18" },
  { number: 20, kind: "B", monday: "2027-01-25" },
  { number: 21, kind: "A", monday: "2027-02-01" },
  { number: 22, kind: "B", monday: "2027-02-15" },
  { number: 23, kind: "A", monday: "2027-02-22" },
  { number: 24, kind: "B", monday: "2027-03-01" },
  { number: 25, kind: "A", monday: "2027-03-08" },
  { number: 26, kind: "B", monday: "2027-03-15" },
  { number: 27, kind: "A", monday: "2027-03-22" },
  { number: 28, kind: "B", monday: "2027-04-05" },
  { number: 29, kind: "A", monday: "2027-04-12" },
  { number: 30, kind: "B", monday: "2027-04-19" },
  { number: 31, kind: "A", monday: "2027-04-26" },
  { number: 32, kind: "B", monday: "2027-05-03" },
  { number: 33, kind: "A", monday: "2027-05-10" },
  { number: 34, kind: "B", monday: "2027-05-17" },
  { number: 35, kind: "A", monday: "2027-05-24" },
  { number: 36, kind: "B", monday: "2027-05-31" },
  { number: 37, kind: "A", monday: "2027-06-07" },
  { number: 38, kind: "B", monday: "2027-06-14" },
];

export const SCHOOL_WEEKS_TOTAL = SCHOOL_WEEK_MONDAYS.length;
