import { normalizeClassCode } from "../school-catalog/queries.ts";
import type { SchoolClassRecord } from "../school-catalog/types.ts";
import type { RuntimeClassroom, RuntimeSubject } from "../../lib/persistence/runtime-agenda-types.ts";

function uniqueMatch<T>(items: T[]): T | null {
  return items.length === 1 ? items[0]! : null;
}

export function classroomNameMatchesSchoolClass(name: string, schoolClass: SchoolClassRecord): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;
  if (normalizeClassCode(trimmed) === normalizeClassCode(schoolClass.code)) return true;
  return trimmed.toLowerCase() === schoolClass.label.trim().toLowerCase();
}

export function schoolClassesMatchingClassroomName(
  classes: SchoolClassRecord[],
  classroomName: string,
): SchoolClassRecord[] {
  return classes.filter((entry) => classroomNameMatchesSchoolClass(classroomName, entry));
}

/**
 * Adoption d'un classroom legacy : unique et sûre DES DEUX CÔTÉS.
 * - exactement un classroom runtime non lié correspondant ;
 * - exactement une SchoolClass structurée pour ce code/libellé.
 * Jamais le premier résultat, jamais l'ordre des IDs.
 */
export function findUniqueAdoptableClassroom(
  classrooms: RuntimeClassroom[],
  schoolClass: SchoolClassRecord,
  allSchoolClasses: SchoolClassRecord[],
): RuntimeClassroom | null {
  const unlinked = classrooms.filter((entry) => !entry.schoolClassId);
  const matches = unlinked.filter((entry) => classroomNameMatchesSchoolClass(entry.name, schoolClass));
  const classroom = uniqueMatch(matches);
  if (!classroom) return null;

  const claimingClasses = schoolClassesMatchingClassroomName(allSchoolClasses, classroom.name);
  if (claimingClasses.length !== 1) return null;
  if (claimingClasses[0]!.id !== schoolClass.id) return null;
  return classroom;
}

export function subjectNameMatchesBranchLabel(name: string, branchLabel: string): boolean {
  return name.trim().toLowerCase() === branchLabel.trim().toLowerCase();
}

/**
 * Adoption d'un subject legacy dans le classroom de la SchoolClass.
 * Correspondance exacte (insensible à la casse) sur le libellé de branche.
 * « Moteur » n'est jamais identique à « Con. Prof I ».
 * Si plusieurs AnnualCourse pourraient prétendre au même subject : aucun premier résultat.
 */
export function findUniqueAdoptableSubject(
  subjects: RuntimeSubject[],
  classroomId: string,
  branchLabel: string,
  candidateAnnualCourseIds: readonly string[],
): RuntimeSubject | null {
  if (candidateAnnualCourseIds.length !== 1) return null;
  const unlinkedInClassroom = subjects.filter(
    (entry) => entry.classroomId === classroomId && !entry.annualCourseId,
  );
  const matches = unlinkedInClassroom.filter((entry) =>
    subjectNameMatchesBranchLabel(entry.name, branchLabel),
  );
  return uniqueMatch(matches);
}
