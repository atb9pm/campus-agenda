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

function uniqueMatch<T>(items: T[], predicate: (entry: T) => boolean): T | null {
  const hits = items.filter(predicate);
  return hits.length === 1 ? hits[0]! : null;
}

function resolveSchoolClass(
  classes: SchoolClassRecord[],
  classroomName: string,
): SchoolClassRecord | null {
  const normalized = normalizeClassCode(classroomName);
  const byCode = uniqueMatch(classes, (entry) => normalizeClassCode(entry.code) === normalized);
  if (byCode) return byCode;
  return uniqueMatch(classes, (entry) => normalizeClassCode(entry.label) === normalized);
}

function resolveBranch(
  branches: SchoolBranchRecord[],
  subjectName: string,
): SchoolBranchRecord | null {
  const normalizedCode = normalizeClassCode(subjectName);
  const byCode = uniqueMatch(branches, (entry) => normalizeClassCode(entry.code) === normalizedCode);
  if (byCode) return byCode;
  const normalizedLabel = subjectName.trim().toLowerCase();
  return uniqueMatch(branches, (entry) => entry.label.trim().toLowerCase() === normalizedLabel);
}

/**
 * Résolution Agenda classe + branche → CTX → AnnualCourse.
 * Retourne null si la correspondance n'est pas unique (jamais le premier arbitraire).
 * Un cours archivé est renvoyé tel quel : l'appelant refuse la publication
 * au lieu de tomber sur Membership.
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

  const schoolClass = resolveSchoolClass(options.classes, classroomName);
  if (!schoolClass) return null;
  if (!schoolClass.schoolYearId || !schoolClass.professionId || schoolClass.trainingYear === null) {
    return null;
  }

  const branch = resolveBranch(options.branches, subjectName);
  if (!branch) return null;

  const context = uniqueMatch(
    options.contexts,
    (entry) =>
      entry.professionId === schoolClass.professionId &&
      entry.trainingYear === schoolClass.trainingYear &&
      entry.branchId === branch.id,
  );
  if (!context) return null;

  const course = uniqueMatch(
    options.courses,
    (entry) =>
      entry.schoolYearId === schoolClass.schoolYearId &&
      entry.classId === schoolClass.id &&
      entry.contextId === context.id,
  );
  if (!course) return null;

  return { schoolClass, branch, context, course };
}

export function findCatalogContextForClassBranch(options: {
  schoolClass: SchoolClassRecord;
  branchId: string;
  contexts: PedagogicalContextRecord[];
}): PedagogicalContextRecord | null {
  if (!options.schoolClass.professionId || options.schoolClass.trainingYear === null) return null;
  return uniqueMatch(
    options.contexts,
    (entry) =>
      entry.professionId === options.schoolClass.professionId &&
      entry.trainingYear === options.schoolClass.trainingYear &&
      entry.branchId === options.branchId &&
      entry.isActive &&
      !entry.isArchived,
  );
}
