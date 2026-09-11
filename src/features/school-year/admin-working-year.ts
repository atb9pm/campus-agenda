import type { SchoolYearRecord } from "./types.ts";

export const ADMIN_WORKING_YEAR_STORAGE_KEY = "campus.adminWorkingSchoolYearId";

export type AdminWorkingYearRef = Pick<SchoolYearRecord, "id" | "label" | "status">;

/**
 * Préférence d’affichage Administration uniquement.
 * Ne lit et n’écrit jamais SchoolYear.status.
 */
export function resolveAdminWorkingYearId(
  years: AdminWorkingYearRef[],
  storedId: string | null | undefined,
): string | null {
  if (storedId && years.some((year) => year.id === storedId)) {
    return storedId;
  }
  return years.find((year) => year.status === "active")?.id ?? years[0]?.id ?? null;
}

export function formatAdminWorkingYearOption(year: AdminWorkingYearRef): string {
  if (year.status === "draft") return `${year.label} — Préparation`;
  if (year.status === "archived") return `${year.label} — Archivée`;
  return year.label;
}

export function readAdminWorkingYearId(
  storage: Pick<Storage, "getItem"> | null | undefined,
): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(ADMIN_WORKING_YEAR_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writeAdminWorkingYearId(
  storage: Pick<Storage, "setItem"> | null | undefined,
  schoolYearId: string,
): void {
  if (!storage) return;
  storage.setItem(ADMIN_WORKING_YEAR_STORAGE_KEY, schoolYearId);
}

/** Garde-fou de test : changer l’année de travail n’altère aucun statut. */
export function schoolYearStatusesAfterAdminWorkingYearChange(
  years: AdminWorkingYearRef[],
  _workingYearId: string | null,
): SchoolYearRecord["status"][] {
  return years.map((year) => year.status);
}
