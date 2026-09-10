import type { AssignmentRole } from "../annual-courses/types.ts";
import type { TeachingType } from "../teaching-types/index.ts";

export const TEACHER_COURSES_EMPTY_MESSAGE = "Aucun cours ne vous est encore attribué.";

export const TEACHER_WEEK_EMPTY_CLASSES_MESSAGE = "Aucune classe configurée.";

export const CONTROL_COURSES_UNAVAILABLE_MESSAGE = "Aucun cours disponible.";

export const SCHOOL_YEAR_UNCONFIGURED_MESSAGE = "Aucune année scolaire configurée.";

/** Libellés d’affichage de l’espace enseignant — pas de nouveaux rôles. */
export const WORKSPACE_ASSIGNMENT_ROLE_LABELS: Record<AssignmentRole, string> = {
  PRIMARY: "Titulaire",
  CO_TEACHER: "Co-enseignant",
  REPLACEMENT: "Remplacement temporaire",
};

/**
 * Cours attribué, calculé côté serveur.
 * N’est pas persisté : jointure TeacherCourseAssignment → AnnualCourse → classe → CTX → branche.
 */
export interface TeacherCourseWorkspaceEntry {
  annualCourseId: string;
  assignmentId: string;
  role: AssignmentRole;
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
  trainingYear: number | null;
  parallelCode: string | null;
  contextId: string;
  branchId: string;
  branchCode: string;
  branchLabel: string;
  branchSortOrder: number;
  teachingType: TeachingType | null;
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
