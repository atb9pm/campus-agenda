import { decideAgendaPublishAccess } from "../annual-courses/agenda-access.ts";
import { isAssignmentActiveAt } from "../annual-courses/assignments.ts";
import type { ResolvedPublicationCourse } from "../annual-courses/resolve.ts";
import type { AnnualCourse, TeacherCourseAssignment } from "../annual-courses/types.ts";
import type { TeacherAccountRecord } from "../teacher-accounts/types.ts";
import { isOperationalSchoolClass } from "../school-catalog/class-lifecycle.ts";
import type { SchoolClassRecord } from "../school-catalog/types.ts";
import type { SchoolYearRecord } from "../school-year/types.ts";
import type { ClassroomAgendaBinding } from "./reconcile.ts";

export function assignmentInstantForSessionDate(date: string): string {
  return `${date}T12:00:00.000Z`;
}

/**
 * Lecture Agenda d'une SchoolClass structurée via TeacherCourseAssignment.
 * Année active : attribution effective.
 * Année archivée : une ancienne attribution à cette classe suffit (historique).
 */
export function teacherHasStructuredClassroomReadAccess(options: {
  teacherId: string;
  schoolClass: SchoolClassRecord;
  courses: AnnualCourse[];
  assignments: TeacherCourseAssignment[];
  years: SchoolYearRecord[];
  at?: string;
}): boolean {
  if (!isOperationalSchoolClass(options.schoolClass, options.schoolClass.schoolYearId)) return false;

  const classCourses = options.courses.filter((course) => course.classId === options.schoolClass.id);
  if (classCourses.length === 0) return false;
  const courseIds = new Set(classCourses.map((course) => course.id));
  const teacherAssignments = options.assignments.filter(
    (assignment) => assignment.teacherId === options.teacherId && courseIds.has(assignment.annualCourseId),
  );
  if (teacherAssignments.length === 0) return false;

  const year = options.schoolClass.schoolYearId
    ? options.years.find((entry) => entry.id === options.schoolClass.schoolYearId) ?? null
    : null;
  if (year?.status === "archived") return true;

  const at = options.at ?? new Date().toISOString();
  return teacherAssignments.some((assignment) => isAssignmentActiveAt(assignment, at));
}

/** Publication pédagogique : TCA valable à la date de la CourseSession. Pas de privilège admin. */
export function teacherHasStructuredPublishAccess(options: {
  teacherId: string;
  annualCourseId: string;
  assignments: TeacherCourseAssignment[];
  at: string;
}): boolean {
  return options.assignments.some(
    (assignment) =>
      assignment.annualCourseId === options.annualCourseId &&
      assignment.teacherId === options.teacherId &&
      isAssignmentActiveAt(assignment, options.at),
  );
}

/**
 * Classroom structuré : TCA à la date cible uniquement. Membership et noms interdits.
 * Classroom legacy (school_class_id null) : comportement historique.
 */
export function evaluateTeacherAgendaPublishAccess(options: {
  binding: ClassroomAgendaBinding;
  teacherId: string;
  assignments: TeacherCourseAssignment[];
  targetAt: string | null;
  teacher: TeacherAccountRecord | null | undefined;
  legacyResolved: ResolvedPublicationCourse | null;
  legacyMembershipAllows: boolean;
}): boolean {
  if (options.binding.kind === "structured-incomplete") return false;
  if (options.binding.kind === "structured") {
    if (
      !isOperationalSchoolClass(options.binding.target.schoolClass) ||
      options.binding.target.course.isArchived
    ) {
      return false;
    }
    if (!options.targetAt) return false;
    return teacherHasStructuredPublishAccess({
      teacherId: options.teacherId,
      annualCourseId: options.binding.target.course.id,
      assignments: options.assignments,
      at: options.targetAt,
    });
  }

  return decideAgendaPublishAccess({
    resolved: options.legacyResolved,
    teacher: options.teacher,
    assignments: options.assignments,
    legacyMembershipAllows: options.legacyMembershipAllows,
    at: options.targetAt ?? undefined,
  });
}
