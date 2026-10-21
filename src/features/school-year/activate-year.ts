import type { SchoolYearRecord } from "./types.ts";

/** Plafond des semaines de cours : une année valide peut en avoir moins, jamais plus. */
export const SCHOOL_COURSE_WEEKS_MAX = 38;

export const SCHOOL_YEAR_ACTIVATE_INCOMPLETE =
  "Impossible d'activer une année sans calendrier de cours.";
export const SCHOOL_YEAR_ACTIVATE_TOO_MANY_WEEKS =
  "Impossible d'activer une année de plus de 38 semaines de cours.";
export const SCHOOL_YEAR_ALREADY_ACTIVE = "Cette année est déjà l’année active.";

export function schoolYearActivationWeekIssue(weekCount: number): string | null {
  if (!Number.isInteger(weekCount) || weekCount <= 0) return SCHOOL_YEAR_ACTIVATE_INCOMPLETE;
  if (weekCount > SCHOOL_COURSE_WEEKS_MAX) return SCHOOL_YEAR_ACTIVATE_TOO_MANY_WEEKS;
  return null;
}

/**
 * Lors d’une activation vers une année en préparation, l’année quittée est archivée.
 * Lors d’une réactivation d’une année antérieure, l’année quittée reste en préparation.
 */
export function previousActiveStatusAfterSwitch(
  targetStatus: SchoolYearRecord["status"],
): SchoolYearRecord["status"] | null {
  if (targetStatus === "active") return null;
  if (targetStatus === "archived") return "draft";
  return "archived";
}
