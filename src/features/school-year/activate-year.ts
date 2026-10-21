import type { SchoolYearRecord } from "./types.ts";

export const SCHOOL_YEAR_ACTIVATE_INCOMPLETE =
  "Impossible d'activer une année incomplète (38 semaines requises).";
export const SCHOOL_YEAR_ALREADY_ACTIVE = "Cette année est déjà l’année active.";

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
