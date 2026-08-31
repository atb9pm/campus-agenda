import { isVerifiedAdminTeacher, teacherCanAccessAnnualCourse } from "./access.ts";
import type { ResolvedPublicationCourse } from "./resolve.ts";
import type { TeacherAccountRecord } from "../teacher-accounts/types.ts";
import type { TeacherCourseAssignment } from "./types.ts";

/**
 * Décision Agenda : un AnnualCourse structuré (même archivé) prime.
 * Membership n'est un repli que s'il n'existe aucun cours fiable.
 */
export function decideAgendaPublishAccess(options: {
  resolved: ResolvedPublicationCourse | null;
  teacher: TeacherAccountRecord | null | undefined;
  assignments: TeacherCourseAssignment[];
  legacyMembershipAllows: boolean;
  at?: string;
}): boolean {
  if (options.resolved) {
    if (options.resolved.schoolClass.isArchived) return false;
    if (options.resolved.course.isArchived) return false;
    return teacherCanAccessAnnualCourse({
      teacher: options.teacher,
      course: options.resolved.course,
      assignments: options.assignments,
      isAdmin: isVerifiedAdminTeacher(options.teacher, options.teacher?.isAdmin),
      at: options.at,
    });
  }
  return options.legacyMembershipAllows;
}
