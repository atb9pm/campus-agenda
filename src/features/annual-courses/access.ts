import type { TeacherAccountRecord } from "../teacher-accounts/types.ts";
import { isAssignmentActiveAt } from "./assignments.ts";
import type { AnnualCourse, TeacherCourseAssignment } from "./types.ts";

export function teacherCanAccessAnnualCourse(options: {
  teacher: TeacherAccountRecord | null | undefined;
  course: AnnualCourse | null | undefined;
  assignments: TeacherCourseAssignment[];
  at?: string;
  isAdmin?: boolean;
  isStudent?: boolean;
}): boolean {
  if (options.isStudent) return false;
  if (!options.teacher || !options.course) return false;
  if (options.course.isArchived) {
    return Boolean(options.isAdmin);
  }
  if (options.isAdmin && options.teacher.isActive && !options.teacher.isArchived) {
    return true;
  }
  if (!options.teacher.isActive || options.teacher.isArchived) return false;

  const at = options.at ?? new Date().toISOString();
  return options.assignments.some(
    (assignment) =>
      assignment.annualCourseId === options.course!.id &&
      assignment.teacherId === options.teacher!.id &&
      isAssignmentActiveAt(assignment, at),
  );
}

export function studentMayAccessCourseNotes(): false {
  return false;
}
