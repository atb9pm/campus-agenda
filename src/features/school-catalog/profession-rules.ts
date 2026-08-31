import type {
  PedagogicalContextRecord,
  PedagogyMutationResult,
  SchoolProfessionRecord,
} from "./profession-types.ts";
import { resolveSchoolClass } from "./class-resolve.ts";
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

/**
 * Branches prévues pour une classe structurée (admin).
 * Aucun repli silencieux : sans profession/année ou sans CTX → liste vide.
 */
export function listPlannedBranchesForClass(options: {
  schoolClass: SchoolClassRecord | null | undefined;
  branches: SchoolBranchRecord[];
  contexts: PedagogicalContextRecord[];
}): SchoolBranchRecord[] {
  const schoolClass = options.schoolClass;
  if (!schoolClass?.professionId || schoolClass.trainingYear === null) {
    return [];
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
  return options.branches.filter(
    (entry) => entry.isActive && !entry.isArchived && allowedIds.has(entry.id),
  );
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

/**
 * Cohérence Classe → Profession → Année de formation.
 * Legacy autorisé : les deux null. Les états mixtes ou hors durée sont refusés.
 */
export function validateClassProfessionAttachment(options: {
  professionId: string | null;
  trainingYear: number | null;
  professions: SchoolProfessionRecord[];
}): PedagogyMutationResult<{ professionId: string | null; trainingYear: number | null }> {
  const professionId = options.professionId;
  const trainingYear = options.trainingYear;

  if (professionId === null && trainingYear === null) {
    return { ok: true, value: { professionId: null, trainingYear: null } };
  }

  if (professionId === null || trainingYear === null) {
    return {
      ok: false,
      reason:
        "Profession et année de formation doivent être renseignées ensemble (ou toutes deux absentes).",
    };
  }

  const profession = options.professions.find((entry) => entry.id === professionId);
  if (!profession) {
    return { ok: false, reason: "Profession introuvable." };
  }
  if (profession.isArchived) {
    return { ok: false, reason: "Impossible de rattacher une classe à une profession archivée." };
  }
  if (!Number.isInteger(profession.durationYears) || profession.durationYears < 1) {
    return {
      ok: false,
      reason: "Cette profession est dans un état incohérent (durée de formation invalide).",
    };
  }

  const year = Number(trainingYear);
  if (!Number.isInteger(year) || year < 1) {
    return { ok: false, reason: "L'année de formation doit être un entier ≥ 1." };
  }
  if (year > profession.durationYears) {
    return {
      ok: false,
      reason:
        `L'année de formation (${year}) dépasse la durée de la profession` +
        ` (${profession.durationYears} an${profession.durationYears > 1 ? "s" : ""}).`,
    };
  }

  return { ok: true, value: { professionId, trainingYear: year } };
}

/**
 * Contrôle serveur des publications Agenda (complète teacherCanPublish).
 * Résolution : nom de classe → code école, nom de sujet → libellé de branche.
 * Repli : classe absente du référentiel, legacy sans profession/année, ou sujet
 * sans branche catalogue correspondante → autorisé (membership reste le garde-fou).
 */
export function evaluateAgendaBranchForClass(options: {
  classroomName: string | null | undefined;
  subjectName: string | null | undefined;
  classes: SchoolClassRecord[];
  branches: SchoolBranchRecord[];
  contexts: PedagogicalContextRecord[];
  schoolYearId?: string | null;
  /** create = nouvelle publication (refuse inactive). update = mutation existante. */
  purpose?: "create" | "update";
}): PedagogyMutationResult<true> {
  const classroomName = options.classroomName?.trim();
  if (!classroomName) return { ok: true, value: true };

  const schoolClass = resolveSchoolClass({
    classroomName,
    classes: options.classes,
    schoolYearId: options.schoolYearId,
  });

  if (!schoolClass) return { ok: true, value: true };
  if (schoolClass.isArchived) {
    return { ok: false, reason: "Cette classe est archivée. Impossible de publier un nouvel élément." };
  }
  if ((options.purpose ?? "create") !== "update" && !schoolClass.isActive) {
    return { ok: false, reason: "Cette classe est désactivée. Impossible de publier un nouvel élément." };
  }
  if (!schoolClass.professionId || schoolClass.trainingYear === null) {
    return { ok: true, value: true };
  }

  const subjectName = options.subjectName?.trim();
  if (!subjectName) {
    return { ok: false, reason: "Branche de publication introuvable." };
  }

  const normalizedSubject = subjectName.toLowerCase();
  const branch =
    options.branches.find((entry) => entry.label.trim().toLowerCase() === normalizedSubject) ?? null;

  if (!branch) return { ok: true, value: true };

  if (
    isBranchAllowedForClass({
      schoolClass,
      branch,
      contexts: options.contexts,
    })
  ) {
    return { ok: true, value: true };
  }

  return {
    ok: false,
    reason:
      "Cette branche n’est pas autorisée pour la profession et l’année de formation de la classe.",
  };
}

