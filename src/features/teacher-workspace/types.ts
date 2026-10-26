import type { AttendanceRole, CourseWeekKind, CourseWeekday } from "../course-schedule/types.ts";
import type { AssignmentRole } from "../annual-courses/types.ts";
import type { TeachingType } from "../teaching-types/index.ts";

export const TEACHER_COURSES_EMPTY_MESSAGE = "Aucun cours ne vous est encore attribué.";

export const TEACHER_WEEK_EMPTY_CLASSES_MESSAGE = "Aucune classe configurée.";

export const CONTROL_COURSES_UNAVAILABLE_MESSAGE = "Aucun cours disponible.";

export const SCHOOL_YEAR_UNCONFIGURED_MESSAGE = "Aucune année scolaire configurée.";

/**
 * Rôle affiché dans l’espace enseignant.
 * `ADMIN_CONSULT` n’est jamais persisté : ce n’est pas un TeacherCourseAssignment.
 */
export type WorkspaceDisplayRole = AssignmentRole | "ADMIN_CONSULT";

/** Libellés d’affichage. `ADMIN_CONSULT` reste hors du référentiel d’attribution. */
export const WORKSPACE_ASSIGNMENT_ROLE_LABELS: Record<WorkspaceDisplayRole, string> = {
  PRIMARY: "Titulaire",
  CO_TEACHER: "Co-enseignant",
  REPLACEMENT: "Remplacement temporaire",
  ADMIN_CONSULT: "Consultation admin",
};

/** Plan officiel de jours, sans identifiants internes — source de « Ma semaine ». */
export interface TeacherCourseMeetingDay {
  dayOfWeek: CourseWeekday;
  weekKind: CourseWeekKind;
  role: AttendanceRole;
}

/**
 * Cours attribué, calculé côté serveur.
 * N’est pas persisté : jointure TeacherCourseAssignment → AnnualCourse → classe → CTX → branche.
 */
export interface TeacherCourseWorkspaceEntry {
  annualCourseId: string;
  assignmentId: string;
  role: WorkspaceDisplayRole;
  validFrom: string;
  validTo: string | null;
  schoolYearId: string;
  schoolYearLabel: string;
  classId: string;
  classCode: string;
  classLabel: string;
  classSortOrder: number;
  professionId: string | null;
  professionLabel: string | null;
  professionClassCodePrefix: string | null;
  trainingYear: number | null;
  parallelCode: string | null;
  contextId: string;
  branchId: string;
  branchCode: string;
  branchLabel: string;
  branchSortOrder: number;
  teachingType: TeachingType | null;
  /** Absent ou vide : aucun plan de cours officiel. */
  meetingDays?: TeacherCourseMeetingDay[];
  /**
   * Jours officiels de la classe (`ClassAttendanceDay`).
   * Ignorés dès que `meetingDays` contient au moins un créneau.
   */
  classAttendanceDays?: TeacherCourseMeetingDay[];
}

export interface TeacherCourseWorkspaceResult {
  schoolYearId: string | null;
  courses: TeacherCourseWorkspaceEntry[];
}

export interface TeacherCourseClassGroup {
  classId: string;
  classCode: string;
  classLabel: string;
  professionLabel: string | null;
  trainingYear: number | null;
  parallelCode: string | null;
  courses: TeacherCourseWorkspaceEntry[];
}
