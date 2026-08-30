import { normalizeClassCode } from "../school-catalog/queries.ts";
import type { PedagogicalContextRecord } from "../school-catalog/profession-types.ts";
import type { SchoolBranchRecord, SchoolClassRecord } from "../school-catalog/types.ts";
import type { AnnualCourse } from "./types.ts";

export interface ResolvedPublicationCourse {
  schoolClass: SchoolClassRecord;
  branch: SchoolBranchRecord;
  context: PedagogicalContextRecord;
  course: AnnualCourse;
}

/**
 * Résolution Agenda classe + branche → CTX → AnnualCourse.
 * Retourne null si la correspondance n'est pas assez stable (repli membership).
 */
export function resolveAnnualCourseForPublication(options: {
  classroomName: string | null | undefined;
  subjectName: string | null | undefined;
  classes: SchoolClassRecord[];
  branches: SchoolBranchRecord[];
  contexts: PedagogicalContextRecord[];
  courses: AnnualCourse[];
}): ResolvedPublicationCourse | null {
  const classroomName = options.classroomName?.trim();
  const subjectName = options.subjectName?.trim();
  if (!classroomName || !subjectName) return null;

  const normalizedClass = normalizeClassCode(classroomName);
  const schoolClass =
    options.classes.find((entry) => normalizeClassCode(entry.code) === normalizedClass) ??
    options.classes.find((entry) => normalizeClassCode(entry.label) === normalizedClass) ??
    null;
  if (!schoolClass) return null;
  if (!schoolClass.schoolYearId || !schoolClass.professionId || schoolClass.trainingYear === null) {
    return null;
  }

  const normalizedSubject = subjectName.toLowerCase();
  const branch =
    options.branches.find((entry) => entry.label.trim().toLowerCase() === normalizedSubject) ??
    options.branches.find((entry) => normalizeClassCode(entry.code) === normalizeClassCode(subjectName)) ??
    null;
  if (!branch) return null;

  const context =
    options.contexts.find(
      (entry) =>
        entry.professionId === schoolClass.professionId &&
        entry.trainingYear === schoolClass.trainingYear &&
        entry.branchId === branch.id &&
        entry.isActive &&
        !entry.isArchived,
    ) ?? null;
  if (!context) return null;

  const course =
    options.courses.find(
      (entry) =>
        entry.schoolYearId === schoolClass.schoolYearId &&
        entry.classId === schoolClass.id &&
        entry.contextId === context.id &&
        !entry.isArchived,
    ) ?? null;
  if (!course) return null;

  return { schoolClass, branch, context, course };
}

export function findCatalogContextForClassBranch(options: {
  schoolClass: SchoolClassRecord;
  branchId: string;
  contexts: PedagogicalContextRecord[];
}): PedagogicalContextRecord | null {
  if (!options.schoolClass.professionId || options.schoolClass.trainingYear === null) return null;
  return (
    options.contexts.find(
      (entry) =>
        entry.professionId === options.schoolClass.professionId &&
        entry.trainingYear === options.schoolClass.trainingYear &&
        entry.branchId === options.branchId &&
        entry.isActive &&
        !entry.isArchived,
    ) ?? null
  );
}
