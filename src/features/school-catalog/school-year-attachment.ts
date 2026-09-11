import type { PedagogyMutationResult } from "./profession-types.ts";

export const ARCHIVED_YEAR_MUTATION_REASON =
  "Cette année scolaire est archivée. Les créations et modifications sont refusées.";

export const CLASS_YEAR_MOVE_REASON =
  "Impossible de déplacer une classe vers une autre année scolaire.";

/** Sous-ensemble minimal d'une année scolaire pour la résolution classe ↔ année. */
export interface SchoolYearRef {
  id: string;
  label: string;
  status?: "draft" | "active" | "archived";
}

/**
 * Résout le couple schoolYearId / schoolYearLabel.
 * - schoolYearId null → legacy autorisé (label libre conservé).
 * - schoolYearId défini → l'année doit exister ; le label est synchronisé depuis l'année
 *   (l'ID est la référence technique principale).
 */
export function resolveClassSchoolYearAttachment(options: {
  schoolYearId: string | null;
  schoolYearLabel?: string | null;
  years: SchoolYearRef[];
}): PedagogyMutationResult<{ schoolYearId: string | null; schoolYearLabel: string | null }> {
  const schoolYearId = options.schoolYearId;

  if (schoolYearId === null) {
    const label =
      options.schoolYearLabel === undefined || options.schoolYearLabel === null
        ? null
        : options.schoolYearLabel.trim() || null;
    return { ok: true, value: { schoolYearId: null, schoolYearLabel: label } };
  }

  const trimmedId = schoolYearId.trim();
  if (!trimmedId) {
    return { ok: false, reason: "Identifiant d'année scolaire invalide." };
  }

  const year = options.years.find((entry) => entry.id === trimmedId);
  if (!year) {
    return { ok: false, reason: "Année scolaire introuvable." };
  }

  return {
    ok: true,
    value: {
      schoolYearId: year.id,
      schoolYearLabel: year.label,
    },
  };
}

export function assertSchoolYearWritable(
  year: SchoolYearRef | null | undefined,
): PedagogyMutationResult<true> {
  if (!year) {
    return { ok: false, reason: "Année scolaire introuvable." };
  }
  if (year.status === "archived") {
    return { ok: false, reason: ARCHIVED_YEAR_MUTATION_REASON };
  }
  return { ok: true, value: true };
}

export function assertClassStaysInSchoolYear(options: {
  currentSchoolYearId: string | null | undefined;
  nextSchoolYearId: string | null | undefined;
}): PedagogyMutationResult<true> {
  const current = options.currentSchoolYearId?.trim() || null;
  const next = options.nextSchoolYearId?.trim() || null;
  if (current && next && current !== next) {
    return { ok: false, reason: CLASS_YEAR_MOVE_REASON };
  }
  return { ok: true, value: true };
}

/**
 * Backfill prudent : retourne l'ID uniquement si exactement une année
 * porte le même label (correspondance certaine et unique).
 */
export function findUniqueSchoolYearIdForLabel(
  label: string | null | undefined,
  years: SchoolYearRef[],
): string | null {
  if (label == null) return null;
  const normalized = label.trim();
  if (!normalized) return null;
  const matches = years.filter((entry) => entry.label.trim() === normalized);
  return matches.length === 1 ? matches[0]!.id : null;
}

/** Années proposées pour une nouvelle classe : brouillon et active uniquement. */
export function listSelectableSchoolYearsForNewClass(years: SchoolYearRef[]): SchoolYearRef[] {
  return years.filter((entry) => entry.status === "draft" || entry.status === "active");
}

/**
 * Années proposées à l'édition : brouillon + active, plus l'année déjà liée
 * (même archivée) pour ne pas casser les rattachements historiques.
 */
export function listSelectableSchoolYearsForClassEdit(
  years: SchoolYearRef[],
  currentSchoolYearId: string | null,
): SchoolYearRef[] {
  const selectable = listSelectableSchoolYearsForNewClass(years);
  if (!currentSchoolYearId) return selectable;
  if (selectable.some((entry) => entry.id === currentSchoolYearId)) return selectable;
  const current = years.find((entry) => entry.id === currentSchoolYearId);
  return current ? [current, ...selectable] : selectable;
}
