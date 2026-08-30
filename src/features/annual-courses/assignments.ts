import type { TeacherAccountRecord } from "../teacher-accounts/types.ts";
import type { TeachingType } from "../teaching-types/index.ts";
import {
  ASSIGNMENT_ROLES,
  type AssignmentRole,
  type CourseMutationResult,
  type TeacherCourseAssignment,
  type TypeMismatchWarning,
} from "./types.ts";

export function isAssignmentRole(value: unknown): value is AssignmentRole {
  return (ASSIGNMENT_ROLES as readonly string[]).includes(String(value));
}

export function isAssignmentActiveAt(
  assignment: TeacherCourseAssignment,
  at = new Date().toISOString(),
): boolean {
  if (assignment.endedAt) return false;
  if (assignment.validFrom > at) return false;
  if (assignment.validTo !== null && assignment.validTo < at) return false;
  return true;
}

export function assignmentsOverlap(
  left: Pick<TeacherCourseAssignment, "validFrom" | "validTo" | "endedAt">,
  right: Pick<TeacherCourseAssignment, "validFrom" | "validTo" | "endedAt">,
): boolean {
  if (left.endedAt || right.endedAt) return false;
  const leftEnd = left.validTo ?? "9999-12-31T23:59:59.999Z";
  const rightEnd = right.validTo ?? "9999-12-31T23:59:59.999Z";
  return left.validFrom <= rightEnd && right.validFrom <= leftEnd;
}

export function teacherIsAssignable(account: TeacherAccountRecord | null | undefined): CourseMutationResult<true> {
  if (!account) return { ok: false, reason: "Enseignant introuvable.", status: 400 };
  if (account.isArchived) return { ok: false, reason: "Cet enseignant est archivé.", status: 400 };
  if (!account.isActive) return { ok: false, reason: "Cet enseignant est désactivé.", status: 400 };
  if (!account.teachingType) {
    return {
      ok: false,
      reason: "Cet enseignant n'a pas de type d'enseignement configuré. Configurez-le avant toute attribution.",
      status: 400,
    };
  }
  return { ok: true, value: true };
}

export function evaluateTeachingTypeGuard(options: {
  branchType: TeachingType | null;
  teacherType: TeachingType | null;
  forceIncompatible?: boolean;
}): CourseMutationResult<{ warning: TypeMismatchWarning | null }> {
  if (!options.branchType || !options.teacherType) {
    return { ok: true, value: { warning: null } };
  }
  if (options.branchType === options.teacherType) {
    return { ok: true, value: { warning: null } };
  }

  const message =
    options.branchType === "TECHNICAL"
      ? "Cette branche est technique mais l'enseignant sélectionné est enregistré comme professeur de branche générale."
      : "Cette branche est générale mais l'enseignant sélectionné est enregistré comme professeur technique.";

  if (!options.forceIncompatible) {
    return { ok: false, reason: message, status: 409 };
  }

  return {
    ok: true,
    value: {
      warning: {
        branchType: options.branchType,
        teacherType: options.teacherType,
        message,
      },
    },
  };
}

export function findDuplicateAssignment(
  existing: TeacherCourseAssignment[],
  candidate: Pick<TeacherCourseAssignment, "annualCourseId" | "teacherId" | "validFrom" | "validTo" | "endedAt">,
): TeacherCourseAssignment | undefined {
  return existing.find(
    (entry) =>
      entry.annualCourseId === candidate.annualCourseId &&
      entry.teacherId === candidate.teacherId &&
      assignmentsOverlap(entry, candidate),
  );
}

export function findActivePrimary(
  existing: TeacherCourseAssignment[],
  annualCourseId: string,
  at = new Date().toISOString(),
): TeacherCourseAssignment | undefined {
  return existing.find(
    (entry) =>
      entry.annualCourseId === annualCourseId &&
      entry.role === "PRIMARY" &&
      isAssignmentActiveAt(entry, at),
  );
}

export function findOverlappingPrimary(
  existing: TeacherCourseAssignment[],
  candidate: Pick<TeacherCourseAssignment, "annualCourseId" | "validFrom" | "validTo" | "endedAt">,
): TeacherCourseAssignment | undefined {
  return existing.find(
    (entry) =>
      entry.annualCourseId === candidate.annualCourseId &&
      entry.role === "PRIMARY" &&
      assignmentsOverlap(entry, candidate),
  );
}

export function endAssignment(
  assignment: TeacherCourseAssignment,
  endedAt: string,
): TeacherCourseAssignment {
  return {
    ...assignment,
    validTo: endedAt,
    endedAt,
  };
}

export function preferredTeachersForBranch<T extends { teachingType: TeachingType | null }>(
  teachers: T[],
  branchType: TeachingType | null,
  includeMismatched: boolean,
): T[] {
  const assignable = teachers.filter((entry) => entry.teachingType !== null);
  if (!branchType) return includeMismatched ? assignable : assignable;
  if (includeMismatched) return assignable;
  return assignable.filter((entry) => entry.teachingType === branchType);
}
