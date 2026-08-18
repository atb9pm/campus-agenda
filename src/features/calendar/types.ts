export type SchoolWeekKind = "A" | "B";

export interface SchoolWeek {
  number: number;
  kind: SchoolWeekKind;
  monday: Date;
}

/** Jour de présence d'un élève (semaine scolaire + date + indice lundi=0 … vendredi=4). */
export interface CourseDaySlot {
  schoolWeekNumber: number;
  weekKind: SchoolWeekKind;
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
