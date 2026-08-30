import type { PedagogicalContextRecord } from "../school-catalog/profession-types.ts";
import type { SchoolClassRecord } from "../school-catalog/types.ts";
import type { SchoolYearRef } from "../school-catalog/school-year-attachment.ts";
import type { AnnualCourseInput, CourseMutationResult } from "./types.ts";

export function validateAnnualCourseInput(options: {
  input: AnnualCourseInput;
  years: SchoolYearRef[];
  schoolClass: SchoolClassRecord | null | undefined;
  context: PedagogicalContextRecord | null | undefined;
}): CourseMutationResult<AnnualCourseInput> {
  const { input, years, schoolClass, context } = options;
  const schoolYearId = input.schoolYearId.trim();
  const classId = input.classId.trim();
  const contextId = input.contextId.trim();
  if (!schoolYearId || !classId || !contextId) {
    return { ok: false, reason: "schoolYearId, classId et contextId sont obligatoires.", status: 400 };
  }

  const year = years.find((entry) => entry.id === schoolYearId);
  if (!year) {
    return { ok: false, reason: "Année scolaire introuvable.", status: 400 };
  }

  if (!schoolClass) {
    return { ok: false, reason: "Classe introuvable.", status: 400 };
  }

  if (!schoolClass.schoolYearId) {
    return {
      ok: false,
      reason: "Cette classe n'est pas rattachée à une année scolaire. Rattachez-la d'abord.",
      status: 400,
    };
  }
  if (schoolClass.schoolYearId !== schoolYearId) {
    return {
      ok: false,
      reason: "La classe n'appartient pas à cette année scolaire.",
      status: 400,
    };
  }

  if (!schoolClass.professionId || schoolClass.trainingYear === null) {
    return {
      ok: false,
      reason: "La classe doit avoir une profession et une année de formation.",
      status: 400,
    };
  }

  if (!context) {
    return { ok: false, reason: "CTX introuvable.", status: 400 };
  }
  if (context.isArchived || !context.isActive) {
    return { ok: false, reason: "Ce CTX est archivé ou inactif.", status: 400 };
  }
  if (context.professionId !== schoolClass.professionId) {
    return {
      ok: false,
      reason: "La profession du CTX ne correspond pas à celle de la classe.",
      status: 400,
    };
  }
  if (context.trainingYear !== schoolClass.trainingYear) {
    return {
      ok: false,
      reason: "L'année de formation du CTX ne correspond pas à celle de la classe.",
      status: 400,
    };
  }

  return { ok: true, value: { schoolYearId, classId, contextId } };
}
