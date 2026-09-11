import { isAssignmentActiveAt } from "../annual-courses/assignments.ts";
import type { AnnualCourse, TeacherCourseAssignment } from "../annual-courses/types.ts";
import { isOperationalSchoolClass } from "../school-catalog/class-lifecycle.ts";
import type { SchoolClassRecord } from "../school-catalog/types.ts";
import type { SchoolYearRecord } from "../school-year/types.ts";

export const NOTEBOOK_PUBLISH_COURSE_MISSING = "Ce cours est introuvable.";
export const NOTEBOOK_PUBLISH_NOT_ASSIGNED = "Ce cours n’est plus attribué à votre compte.";
export const NOTEBOOK_PUBLISH_FUTURE = "Cette attribution n’est pas encore active.";
export const NOTEBOOK_PUBLISH_ENDED = "Ce cours n’est plus attribué à votre compte.";
export const NOTEBOOK_PUBLISH_ARCHIVED = "Ce cours est archivé.";
export const NOTEBOOK_PUBLISH_CLASS_UNAVAILABLE = "Cette classe n’est pas disponible pour l’année active.";
export const NOTEBOOK_PUBLISH_YEAR_INACTIVE =
  "Ce cours n’appartient pas à l’année scolaire active.";

export type NotebookPublishAccess =
  | { canPublish: true }
  | { canPublish: false; reason: string };

/**
 * Droit de publier dans le Carnet à partir d’un AnnualCourse réel.
 * Un Subject/runtime n’intervient pas : il n’est qu’un adaptateur technique.
 */
export function evaluateNotebookPublishAccess(options: {
  teacherId: string;
  annualCourse: Pick<AnnualCourse, "id" | "schoolYearId" | "classId" | "isArchived"> | null | undefined;
  schoolClass: Pick<SchoolClassRecord, "id" | "isActive" | "isArchived" | "schoolYearId"> | null | undefined;
  activeYear: Pick<SchoolYearRecord, "id" | "status"> | null | undefined;
  assignments: readonly TeacherCourseAssignment[];
  at?: string;
}): NotebookPublishAccess {
  const at = options.at ?? new Date().toISOString();
  const course = options.annualCourse ?? null;
  if (!course) {
    return { canPublish: false, reason: NOTEBOOK_PUBLISH_COURSE_MISSING };
  }
  if (course.isArchived) {
    return { canPublish: false, reason: NOTEBOOK_PUBLISH_ARCHIVED };
  }

  const activeYear = options.activeYear ?? null;
  if (!activeYear || activeYear.status !== "active" || course.schoolYearId !== activeYear.id) {
    return { canPublish: false, reason: NOTEBOOK_PUBLISH_YEAR_INACTIVE };
  }

  if (!isOperationalSchoolClass(options.schoolClass, activeYear.id)) {
    return { canPublish: false, reason: NOTEBOOK_PUBLISH_CLASS_UNAVAILABLE };
  }

  const teacherAssignments = options.assignments.filter(
    (assignment) =>
      assignment.annualCourseId === course.id && assignment.teacherId === options.teacherId,
  );
  if (teacherAssignments.length === 0) {
    return { canPublish: false, reason: NOTEBOOK_PUBLISH_NOT_ASSIGNED };
  }
  if (teacherAssignments.some((assignment) => isAssignmentActiveAt(assignment, at))) {
    return { canPublish: true };
  }
  if (teacherAssignments.some((assignment) => assignment.validFrom > at)) {
    return { canPublish: false, reason: NOTEBOOK_PUBLISH_FUTURE };
  }
  return { canPublish: false, reason: NOTEBOOK_PUBLISH_ENDED };
}

export function workspaceAllowsNotebookPublish(
  courses: readonly { annualCourseId: string }[],
  annualCourseId: string | null | undefined,
): boolean {
  const id = annualCourseId?.trim() || "";
  if (!id) return false;
  return courses.some((course) => course.annualCourseId === id);
}

export function implicitNotebookPublishCourse<T extends { classId: string }>(
  courses: readonly T[],
  classId: string | null | undefined,
): T | null {
  const wanted = classId?.trim() || "";
  if (!wanted) return null;
  return courses.find((course) => course.classId === wanted) ?? null;
}

export function notebookPublishBlockedReason(options: {
  hasOpenClass: boolean;
  annualCourseId: string | null;
  assignedToCourse: boolean;
  classroomId: string | null;
  subjectId: string | null;
}): string | undefined {
  if (!options.hasOpenClass) return undefined;
  if (options.annualCourseId) {
    return options.assignedToCourse ? undefined : NOTEBOOK_PUBLISH_NOT_ASSIGNED;
  }
  if (!options.classroomId) {
    return "Cette classe n'est pas reliée au catalogue — publications élèves indisponibles.";
  }
  if (!options.subjectId) {
    return "Aucune branche enseignée trouvée pour publier.";
  }
  return undefined;
}
