import { formatSchoolYearLabelFr } from "./official-plan-logic.ts";
import type { SchoolYearRecord } from "./types.ts";

export const ADMIN_WORKING_YEAR_STORAGE_KEY = "campus.adminWorkingSchoolYearId";

export type AdminWorkingYearRef = Pick<SchoolYearRecord, "id" | "label" | "status">;

export const ADMIN_WORKING_YEAR_BADGE_LABELS: Record<AdminWorkingYearRef["status"], string> = {
  active: "Active",
  draft: "Préparation",
  archived: "Archivée",
};

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
  const label = formatSchoolYearLabelFr(year.label);
  if (year.status === "draft") return `${label} — Préparation`;
  if (year.status === "archived") return `${label} — Archivée`;
  return label;
}

export function formatAdminWorkingSectionTitle(
  section: "classes" | "courses",
  year: AdminWorkingYearRef,
): string {
  const label = formatSchoolYearLabelFr(year.label);
  return section === "classes" ? `Classes — ${label}` : `Cours — ${label}`;
}

export function filterBySchoolYearId<T extends { schoolYearId?: string | null }>(
  items: readonly T[],
  schoolYearId: string | null | undefined,
): T[] {
  const yearId = schoolYearId?.trim() || null;
  if (!yearId) return [];
  return items.filter((item) => (item.schoolYearId?.trim() || null) === yearId);
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
