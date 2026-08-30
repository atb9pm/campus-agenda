import type { PedagogyMutationResult, SchoolProfessionRecord } from "./profession-types.ts";
import { validateClassProfessionAttachment } from "./profession-rules.ts";
import type { SchoolYearRef } from "./school-year-attachment.ts";
import { resolveClassSchoolYearAttachment } from "./school-year-attachment.ts";

/**
 * Création administrative d'une nouvelle classe structurée.
 * Les trois valeurs forment un seul bloc. Legacy (null) reste possible
 * uniquement hors de cette voie (seeds, bases historiques, store).
 */
export function validateAdminClassCreate(options: {
  schoolYearId: string | null | undefined;
  professionId: string | null | undefined;
  trainingYear: number | null | undefined;
  years: SchoolYearRef[];
  professions: SchoolProfessionRecord[];
}): PedagogyMutationResult<{
  schoolYearId: string;
  schoolYearLabel: string;
  professionId: string;
  trainingYear: number;
}> {
  const year = resolveClassSchoolYearAttachment({
    schoolYearId: options.schoolYearId ?? null,
    schoolYearLabel: null,
    years: options.years,
  });
  if (!year.ok) return year;
  if (!year.value.schoolYearId) {
    return { ok: false, reason: "L'année scolaire est obligatoire pour une nouvelle classe." };
  }

  if (!options.professionId || options.trainingYear === null || options.trainingYear === undefined) {
    return {
      ok: false,
      reason: "La profession et l'année de formation sont obligatoires pour une nouvelle classe.",
    };
  }

  const attachment = validateClassProfessionAttachment({
    professionId: options.professionId,
    trainingYear: options.trainingYear,
    professions: options.professions,
  });
  if (!attachment.ok) return attachment;
  if (!attachment.value.professionId || attachment.value.trainingYear === null) {
    return {
      ok: false,
      reason: "La profession et l'année de formation sont obligatoires pour une nouvelle classe.",
    };
  }

  return {
    ok: true,
    value: {
      schoolYearId: year.value.schoolYearId,
      schoolYearLabel: year.value.schoolYearLabel ?? "",
      professionId: attachment.value.professionId,
      trainingYear: attachment.value.trainingYear,
    },
  };
}
