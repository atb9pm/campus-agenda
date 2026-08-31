import { formatTrainingYearLabel } from "./class-codes.ts";
import type { SchoolProfessionRecord } from "./profession-types.ts";
import type { SchoolClassRecord } from "./types.ts";

/** Abréviation métier telle que configurée — jamais tronquée à 3 caractères. */
export function formatProfessionPrefixBadge(
  prefix: string | null | undefined,
  fallbackLabel?: string,
): string {
  const trimmed = prefix?.trim() ?? "";
  if (trimmed) return trimmed;
  const fallback = fallbackLabel?.trim() ?? "";
  return fallback ? fallback.slice(0, 3).toUpperCase() : "";
}

/** Titre secondaire : nom de profession (source de vérité) ou libellé legacy. */
export function classDisplayProfessionLabel(
  schoolClass: SchoolClassRecord,
  profession: SchoolProfessionRecord | null | undefined,
): string {
  if (profession?.label.trim()) return profession.label.trim();
  return schoolClass.label.trim() || schoolClass.code;
}

export function classDisplayGroupLabel(parallelCode: string | null): string {
  return parallelCode ? `Groupe ${parallelCode}` : "Groupe : aucun";
}

export function classDisplaySchoolYearLabel(schoolClass: SchoolClassRecord): string {
  const label = schoolClass.schoolYearLabel?.trim();
  if (label) return label;
  if (schoolClass.schoolYearId) return schoolClass.schoolYearId;
  return "Année non renseignée";
}

export function classDisplayTrainingYearLabel(trainingYear: number | null): string {
  if (trainingYear === null) return "Année de formation non renseignée";
  return formatTrainingYearLabel(trainingYear);
}

export function classDisplayMeta(schoolClass: SchoolClassRecord): string {
  return [
    classDisplayTrainingYearLabel(schoolClass.trainingYear),
    classDisplayGroupLabel(schoolClass.parallelCode),
    classDisplaySchoolYearLabel(schoolClass),
  ].join(" · ");
}
