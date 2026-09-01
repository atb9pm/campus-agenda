import { normalizeClassCode } from "../school-catalog/queries.ts";
import type { SchoolClassRecord } from "../school-catalog/types.ts";
import type { RuntimeClassroom, RuntimeSubject } from "../../lib/persistence/runtime-agenda-types.ts";

function uniqueMatch<T>(items: T[]): T | null {
  return items.length === 1 ? items[0]! : null;
}

function classroomNameMatchesSchoolClass(name: string, schoolClass: SchoolClassRecord): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;
  if (normalizeClassCode(trimmed) === normalizeClassCode(schoolClass.code)) return true;
  return trimmed.toLowerCase() === schoolClass.label.trim().toLowerCase();
}

/**
 * Adoption d'un classroom legacy : uniquement si la correspondance est unique et sûre.
 * Jamais le premier résultat arbitraire.
 */
export function findUniqueAdoptableClassroom(
  classrooms: RuntimeClassroom[],
  schoolClass: SchoolClassRecord,
): RuntimeClassroom | null {
  const unlinked = classrooms.filter((entry) => !entry.schoolClassId);
  const matches = unlinked.filter((entry) => classroomNameMatchesSchoolClass(entry.name, schoolClass));
  return uniqueMatch(matches);
}

function subjectNameMatchesBranchLabel(name: string, branchLabel: string): boolean {
  return name.trim().toLowerCase() === branchLabel.trim().toLowerCase();
}

/**
 * Adoption d'un subject legacy dans le classroom de la SchoolClass.
 * Correspondance exacte (insensible à la casse) sur le libellé de branche.
 * « Moteur » n'est jamais identique à « Con. Prof I ».
 */
export function findUniqueAdoptableSubject(
  subjects: RuntimeSubject[],
  classroomId: string,
  branchLabel: string,
): RuntimeSubject | null {
  const unlinkedInClassroom = subjects.filter(
    (entry) => entry.classroomId === classroomId && !entry.annualCourseId,
  );
  const matches = unlinkedInClassroom.filter((entry) =>
    subjectNameMatchesBranchLabel(entry.name, branchLabel),
  );
  return uniqueMatch(matches);
}
