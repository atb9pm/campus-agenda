/** État d'un jour du calendrier scolaire. */
export type SchoolDayState = "class" | "holiday";

export interface PublicHoliday {
  date: string;
  label: string;
}

/** Correction manuelle d'un jour, enregistrée pour une année scolaire. */
export interface SchoolDayException {
  date: string;
  state: SchoolDayState;
  label: string | null;
}

export interface SchoolDayCell {
  date: string;
  /** 1 = lundi … 5 = vendredi. */
  weekdayIndex: number;
  state: SchoolDayState;
  label: string | null;
  /** Vrai quand l'état vient d'une correction manuelle et non du calcul. */
  isManual: boolean;
}

export interface SchoolDayWeekRow {
  kind: "week";
  number: number;
  weekKind: "A" | "B";
  monday: string;
  days: SchoolDayCell[];
}

export interface SchoolDayBreakRow {
  kind: "break";
  /** Premier lundi non scolaire de la coupure. */
  fromMonday: string;
  /** Nombre de semaines sautées entre deux semaines scolaires. */
  weekCount: number;
  afterWeekNumber: number;
}

export type SchoolDayPlanRow = SchoolDayWeekRow | SchoolDayBreakRow;
