export type SchoolWeekKind = "A" | "B";

export function isSchoolWeekKind(value: unknown): value is SchoolWeekKind {
  return value === "A" || value === "B";
}

export function parseSchoolWeekKind(value: unknown): SchoolWeekKind | null {
  return isSchoolWeekKind(value) ? value : null;
}

export interface SchoolWeek {
  number: number;
  /** Alternance A/B si le plan historique existe ; `null` pour une semaine de cours sans A/B. */
  kind: SchoolWeekKind | null;
  monday: Date;
}

/** Jour de présence d'un élève (semaine scolaire + date + indice lundi=0 … vendredi=4). */
export interface CourseDaySlot {
  schoolWeekNumber: number;
  weekKind: SchoolWeekKind | null;
  date: Date;
  dayIndex: number;
}

export interface TmaCourseSchedule {
  mondayIndex: number;
  thursdayIndex: number;
}

export const DEFAULT_TMA_SCHEDULE: TmaCourseSchedule = {
  mondayIndex: 0,
  thursdayIndex: 3,
};
