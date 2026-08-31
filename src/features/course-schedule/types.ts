export const COURSE_WEEK_KINDS = ["all", "A", "B"] as const;
export type CourseWeekKind = (typeof COURSE_WEEK_KINDS)[number];

export const COURSE_WEEK_KIND_LABELS: Record<CourseWeekKind, string> = {
  all: "Toutes",
  A: "A",
  B: "B",
};

export const COURSE_WEEK_KIND_LONG_LABELS: Record<CourseWeekKind, string> = {
  all: "Toutes les semaines",
  A: "Semaine A",
  B: "Semaine B",
};

/** ISO : Lundi = 1 … Vendredi = 5. */
export type CourseWeekday = 1 | 2 | 3 | 4 | 5;

export const COURSE_WEEKDAY_LABELS: Record<CourseWeekday, string> = {
  1: "Lundi",
  2: "Mardi",
  3: "Mercredi",
  4: "Jeudi",
  5: "Vendredi",
};

export interface CourseScheduleSlot {
  id: string;
  annualCourseId: string;
  dayOfWeek: CourseWeekday;
  periodStart: number;
  periodEnd: number;
  weekKind: CourseWeekKind;
  /**
   * Réservé au futur support des changements d’horaire en cours d’année.
   * Non utilisé pour les conflits ni l’affichage en 2.25.0.
   * Les créations normales restent null.
   */
  validFrom: string | null;
  /**
   * Réservé au futur support des changements d’horaire en cours d’année.
   * Non utilisé pour les conflits ni l’affichage en 2.25.0.
   * Les créations normales restent null.
   */
  validTo: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CourseScheduleSlotInput {
  annualCourseId: string;
  dayOfWeek: CourseWeekday;
  periodStart: number;
  periodEnd: number;
  weekKind: CourseWeekKind;
  /** Réservé au futur support des changements d’horaire en cours d’année. */
  validFrom?: string | null;
  /** Réservé au futur support des changements d’horaire en cours d’année. */
  validTo?: string | null;
}

export type ScheduleMutationOk<T> = { ok: true; value: T };
export type ScheduleMutationErr = { ok: false; reason: string; status?: number; code?: string };
export type ScheduleMutationResult<T> = ScheduleMutationOk<T> | ScheduleMutationErr;
