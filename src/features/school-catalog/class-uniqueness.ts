import { normalizeClassCode } from "./queries.ts";
import type { PedagogyMutationResult } from "./profession-types.ts";
import type { SchoolClassRecord } from "./types.ts";

/**
 * Unicité annuelle pour une classe structurée, unicité globale pour le legacy.
 * N'interdit pas MMA1A en 2026-2027 et MMA1A en 2027-2028.
 */
export function assertClassCodeAvailable(options: {
  code: string;
  schoolYearId: string | null;
  classes: SchoolClassRecord[];
  excludeId?: string;
}): PedagogyMutationResult<true> {
  const code = normalizeClassCode(options.code);
  const clash = options.classes.find((entry) => {
    if (options.excludeId && entry.id === options.excludeId) return false;
    if (normalizeClassCode(entry.code) !== code) return false;
    if (options.schoolYearId) {
      return entry.schoolYearId === options.schoolYearId;
    }
    return entry.schoolYearId === null;
  });
  if (!clash) return { ok: true, value: true };
  if (options.schoolYearId) {
    return {
      ok: false,
      reason: `Le code ${code} existe déjà pour cette année scolaire.`,
    };
  }
  return {
    ok: false,
    reason: `Le code ${code} est déjà utilisé par une classe legacy.`,
  };
}

export function isStructuredClassKey(entry: {
  schoolYearId: string | null;
  professionId: string | null;
  trainingYear: number | null;
}): boolean {
  return Boolean(entry.schoolYearId && entry.professionId && entry.trainingYear !== null);
}

/**
 * Unicité structurelle pour la récupération future (CTX + parallelCode).
 * Legacy (année / profession / année de formation manquante) : non concerné.
 */
export function assertStructuredGroupAvailable(options: {
  schoolYearId: string | null;
  professionId: string | null;
  trainingYear: number | null;
  parallelCode: string | null;
  classes: SchoolClassRecord[];
  excludeId?: string;
}): PedagogyMutationResult<true> {
  if (!isStructuredClassKey(options)) return { ok: true, value: true };

  const clash = options.classes.find((entry) => {
    if (options.excludeId && entry.id === options.excludeId) return false;
    if (!isStructuredClassKey(entry)) return false;
    if (entry.schoolYearId !== options.schoolYearId) return false;
    if (entry.professionId !== options.professionId) return false;
    if (entry.trainingYear !== options.trainingYear) return false;
    if (options.parallelCode === null) return entry.parallelCode === null;
    return entry.parallelCode === options.parallelCode;
  });
  if (!clash) return { ok: true, value: true };
  if (options.parallelCode === null) {
    return {
      ok: false,
      reason:
        "Une classe unique existe déjà pour cette profession et cette année de formation.",
    };
  }
  return {
    ok: false,
    reason: `Le groupe ${options.parallelCode} existe déjà pour cette profession et cette année scolaire.`,
  };
}

export function assertProfessionPrefixAvailable(options: {
  prefix: string;
  professions: Array<{ id: string; classCodePrefix: string | null }>;
  excludeId?: string;
}): PedagogyMutationResult<true> {
  const clash = options.professions.find(
    (entry) =>
      entry.classCodePrefix === options.prefix &&
      entry.id !== options.excludeId,
  );
  if (clash) {
    return { ok: false, reason: `L'abréviation ${options.prefix} est déjà utilisée.` };
  }
  return { ok: true, value: true };
}
