import type { PedagogicalContextRecord, SchoolProfessionRecord } from "../school-catalog/profession-types.ts";
import type { SchoolYearRef } from "../school-catalog/school-year-attachment.ts";
import type { SchoolBranchRecord, SchoolClassRecord } from "../school-catalog/types.ts";
import type { AnnualCourseInput, CourseMutationResult } from "./types.ts";

export function validateAnnualCourseInput(options: {
  input: AnnualCourseInput;
  years: SchoolYearRef[];
  schoolClass: SchoolClassRecord | null | undefined;
  context: PedagogicalContextRecord | null | undefined;
  profession?: SchoolProfessionRecord | null;
  branch?: SchoolBranchRecord | null;
}): CourseMutationResult<AnnualCourseInput> {
  const { input, years, schoolClass, context } = options;
  const schoolYearId = input.schoolYearId.trim();
  const classId = input.classId.trim();
  const contextId = input.contextId.trim();
  if (!schoolYearId || !classId || !contextId) {
    return { ok: false, reason: "schoolYearId, classId et contextId sont obligatoires.", status: 400 };
  }

  const year = years.find((entry) => entry.id === schoolYearId) ?? null;
  const referential = validateAttributionReferential({
    year,
    schoolClass,
    profession: options.profession,
    context,
    branch: options.branch,
  });
  if (!referential.ok) return referential;

  if (!schoolClass!.schoolYearId) {
    return {
      ok: false,
      reason: "Cette classe n'est pas rattachée à une année scolaire. Rattachez-la d'abord.",
      status: 400,
    };
  }
  if (schoolClass!.schoolYearId !== schoolYearId) {
    return {
      ok: false,
      reason: "La classe n'appartient pas à cette année scolaire.",
      status: 400,
    };
  }

  if (!schoolClass!.professionId || schoolClass!.trainingYear === null) {
    return {
      ok: false,
      reason: "La classe doit avoir une profession et une année de formation.",
      status: 400,
    };
  }

  if (context!.professionId !== schoolClass!.professionId) {
    return {
      ok: false,
      reason: "La profession du CTX ne correspond pas à celle de la classe.",
      status: 400,
    };
  }
  if (context!.trainingYear !== schoolClass!.trainingYear) {
    return {
      ok: false,
      reason: "L'année de formation du CTX ne correspond pas à celle de la classe.",
      status: 400,
    };
  }

  return { ok: true, value: { schoolYearId, classId, contextId } };
}

export function validateAttributionReferential(options: {
  year: SchoolYearRef | null | undefined;
  schoolClass: SchoolClassRecord | null | undefined;
  profession?: SchoolProfessionRecord | null | undefined;
  context: PedagogicalContextRecord | null | undefined;
  branch?: SchoolBranchRecord | null | undefined;
}): CourseMutationResult<true> {
  if (!options.year) {
    return { ok: false, reason: "Année scolaire introuvable.", status: 400 };
  }
  if (options.year.status === "archived") {
    return { ok: false, reason: "Cette année scolaire est archivée. Aucune nouvelle attribution n'est possible.", status: 400 };
  }

  if (!options.schoolClass) {
    return { ok: false, reason: "Classe introuvable.", status: 400 };
  }
  if (options.schoolClass.isArchived) {
    return { ok: false, reason: "Cette classe est archivée.", status: 400 };
  }
  if (!options.schoolClass.isActive) {
    return { ok: false, reason: "Cette classe est inactive.", status: 400 };
  }

  if (options.schoolClass.professionId && options.profession === null) {
    return { ok: false, reason: "Profession introuvable.", status: 400 };
  }
  if (options.profession) {
    if (options.profession.isArchived || !options.profession.isActive) {
      return { ok: false, reason: "Cette profession est archivée ou inactive.", status: 400 };
    }
  }

  if (!options.context) {
    return { ok: false, reason: "CTX introuvable.", status: 400 };
  }
  if (options.context.isArchived || !options.context.isActive) {
    return { ok: false, reason: "Ce CTX est archivé ou inactif.", status: 400 };
  }

  if (options.context && options.branch === null) {
    return { ok: false, reason: "Branche introuvable.", status: 400 };
  }
  if (options.branch) {
    if (options.branch.isArchived || !options.branch.isActive) {
      return { ok: false, reason: "Cette branche est archivée ou inactive.", status: 400 };
    }
    if (!options.branch.teachingType) {
      return {
        ok: false,
        reason: "Configurez d'abord le type de cette branche dans le Catalogue des branches.",
        status: 400,
      };
    }
  }

  return { ok: true, value: true };
}
