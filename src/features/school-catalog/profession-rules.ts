import type {
  PedagogicalContextRecord,
  PedagogyMutationResult,
  SchoolProfessionRecord,
} from "./profession-types.ts";
import type { SchoolBranchRecord, SchoolClassRecord } from "./types.ts";

export function trainingYearsForDuration(durationYears: number): number[] {
  if (!Number.isInteger(durationYears) || durationYears < 1 || durationYears > 10) {
    return [];
  }
  return Array.from({ length: durationYears }, (_, index) => index + 1);
}

export function canReduceProfessionDuration(options: {
  profession: SchoolProfessionRecord;
  nextDurationYears: number;
  contexts: PedagogicalContextRecord[];
  classes: SchoolClassRecord[];
}): PedagogyMutationResult<true> {
  const { profession, nextDurationYears, contexts, classes } = options;
  if (!Number.isInteger(nextDurationYears) || nextDurationYears < 1) {
    return { ok: false, reason: "La durée de formation doit être un entier ≥ 1." };
  }
  if (nextDurationYears >= profession.durationYears) return { ok: true, value: true };

  const blockedYears = trainingYearsForDuration(profession.durationYears).filter(
    (year) => year > nextDurationYears,
  );
  const contextCount = contexts.filter(
    (entry) =>
      entry.professionId === profession.id &&
      blockedYears.includes(entry.trainingYear) &&
      !entry.isArchived,
  ).length;
  const classCount = classes.filter(
    (entry) =>
      entry.professionId === profession.id &&
      entry.trainingYear !== null &&
      blockedYears.includes(entry.trainingYear),
  ).length;

  if (contextCount === 0 && classCount === 0) return { ok: true, value: true };

  const parts: string[] = [];
  if (contextCount > 0) {
    parts.push(
      `${contextCount} affectation${contextCount > 1 ? "s" : ""} de branche` +
        ` sur les années ${blockedYears.join(", ")}`,
    );
  }
  if (classCount > 0) {
    parts.push(
      `${classCount} classe${classCount > 1 ? "s" : ""} rattachée${classCount > 1 ? "s" : ""}` +
        ` aux années ${blockedYears.join(", ")}`,
    );
  }
  return {
    ok: false,
    reason:
      `Impossible de réduire la durée à ${nextDurationYears} an${nextDurationYears > 1 ? "s" : ""} : ` +
      `${parts.join(" et ")}. Archivez ou retirez ces éléments d’abord.`,
  };
}

export function professionDeleteBlockers(options: {
  professionId: string;
  contexts: PedagogicalContextRecord[];
  classes: SchoolClassRecord[];
}): string | null {
  const contextCount = options.contexts.filter((entry) => entry.professionId === options.professionId).length;
  const classCount = options.classes.filter((entry) => entry.professionId === options.professionId).length;
  if (contextCount === 0 && classCount === 0) return null;
  const parts: string[] = [];
  if (classCount > 0) parts.push(`${classCount} classe${classCount > 1 ? "s" : ""}`);
  if (contextCount > 0) {
    parts.push(`${contextCount} affectation${contextCount > 1 ? "s" : ""} de branche`);
  }
  return `Cette profession est utilisée par ${parts.join(" et ")}. Elle ne peut pas être supprimée définitivement. Vous pouvez l’archiver.`;
}

export function branchDeleteBlockers(options: {
  branchId: string;
  contexts: PedagogicalContextRecord[];
}): string | null {
  const contextCount = options.contexts.filter((entry) => entry.branchId === options.branchId).length;
  if (contextCount === 0) return null;
  return (
    `Cette branche est utilisée par ${contextCount} contexte${contextCount > 1 ? "s" : ""} pédagogique` +
    `${contextCount > 1 ? "s" : ""} (profession + année). Elle ne peut pas être supprimée définitivement. Vous pouvez l’archiver.`
  );
}

/**
 * Filtrage des branches pour une classe.
 * Repli legacy : sans profession/année → toutes les branches actives non archivées.
 */
export function listBranchesForClass(options: {
  schoolClass: SchoolClassRecord | null | undefined;
  branches: SchoolBranchRecord[];
  contexts: PedagogicalContextRecord[];
}): SchoolBranchRecord[] {
  const activeBranches = options.branches.filter((entry) => entry.isActive && !entry.isArchived);
  const schoolClass = options.schoolClass;
  if (!schoolClass?.professionId || schoolClass.trainingYear === null) {
    return activeBranches;
  }
  const allowedIds = new Set(
    options.contexts
      .filter(
        (entry) =>
          !entry.isArchived &&
          entry.isActive &&
          entry.professionId === schoolClass.professionId &&
          entry.trainingYear === schoolClass.trainingYear,
      )
      .map((entry) => entry.branchId),
  );
  return activeBranches.filter((entry) => allowedIds.has(entry.id));
}

export function isBranchAllowedForClass(options: {
  schoolClass: SchoolClassRecord | null | undefined;
  branch: SchoolBranchRecord | null | undefined;
  contexts: PedagogicalContextRecord[];
}): boolean {
  if (!options.branch || !options.branch.isActive || options.branch.isArchived) return false;
  const schoolClass = options.schoolClass;
  if (!schoolClass?.professionId || schoolClass.trainingYear === null) return true;
  return options.contexts.some(
    (entry) =>
      !entry.isArchived &&
      entry.isActive &&
      entry.professionId === schoolClass.professionId &&
      entry.trainingYear === schoolClass.trainingYear &&
      entry.branchId === options.branch!.id,
  );
}
