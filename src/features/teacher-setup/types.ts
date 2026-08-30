/** Lundi = 1 … Vendredi = 5 (ISO). */
export type WeekdayIndex = 1 | 2 | 3 | 4 | 5;

export interface TeacherClassSetup {
  id: string;
  name: string;
  programLabel: string;
  dayOfWeek: WeekdayIndex;
  branchNames: string[];
  icon: string;
}

/**
 * Préférence d'affichage personnelle.
 * Ce n'est PAS une autorisation : le professeur ne s'attribue pas
 * une classe, une profession, une branche ou un CTX.
 */
export interface TeacherSetupConfig {
  version: 1;
  classes: TeacherClassSetup[];
}

export const WEEKDAY_LABELS: Record<WeekdayIndex, string> = {
  1: "Lundi",
  2: "Mardi",
  3: "Mercredi",
  4: "Jeudi",
  5: "Vendredi",
};

export const WEEKDAY_SHORT_LABELS: Record<WeekdayIndex, string> = {
  1: "Lun",
  2: "Mar",
  3: "Mer",
  4: "Jeu",
  5: "Ven",
};
