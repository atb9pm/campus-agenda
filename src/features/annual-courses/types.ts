import type { TeachingType } from "../teaching-types/index.ts";

export const ASSIGNMENT_ROLES = ["PRIMARY", "CO_TEACHER", "REPLACEMENT"] as const;

export type AssignmentRole = (typeof ASSIGNMENT_ROLES)[number];

export const ASSIGNMENT_ROLE_LABELS: Record<AssignmentRole, string> = {
  PRIMARY: "Titulaire",
  CO_TEACHER: "Coenseignant",
  REPLACEMENT: "Remplaçant",
};

export const ASSIGNMENT_EVENT_KINDS = [
  "ASSIGNED",
  "ENDED",
  "REPLACED",
  "TEMPORARY_REPLACEMENT",
  "OVERRIDE",
] as const;

export type AssignmentEventKind = (typeof ASSIGNMENT_EVENT_KINDS)[number];

export interface AnnualCourse {
  id: string;
  schoolYearId: string;
  classId: string;
  contextId: string;
  isArchived: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AnnualCourseInput {
  schoolYearId: string;
  classId: string;
  contextId: string;
}

export interface TeacherCourseAssignment {
  id: string;
  annualCourseId: string;
  teacherId: string;
  role: AssignmentRole;
  validFrom: string;
  validTo: string | null;
  createdByAdminId: string;
  createdAt: string;
  endedAt: string | null;
  /** Provenance d'un forçage type professeur / branche. */
  overrideReason: string | null;
  overrideByAdminId: string | null;
}

export interface TeacherCourseAssignmentInput {
  annualCourseId: string;
  teacherId: string;
  role: AssignmentRole;
  validFrom?: string;
  validTo?: string | null;
  createdByAdminId: string;
  forceIncompatible?: boolean;
  overrideReason?: string | null;
}

export interface TeacherCourseAssignmentEvent {
  id: string;
  annualCourseId: string;
  assignmentId: string | null;
  teacherId: string;
  adminId: string;
  kind: AssignmentEventKind;
  role: AssignmentRole | null;
  detail: string;
  createdAt: string;
}

export type CourseMutationOk<T> = { ok: true; value: T; warning?: TypeMismatchWarning | null };
export type CourseMutationErr = {
  ok: false;
  reason: string;
  status?: number;
  code?: "EXISTING_TEACHERS" | "TYPE_MISMATCH" | "PRIMARY_TAKEN" | "USED";
  existing?: TeacherCourseAssignment[];
};
export type CourseMutationResult<T> = CourseMutationOk<T> | CourseMutationErr;

export interface TypeMismatchWarning {
  branchType: TeachingType;
  teacherType: TeachingType;
  message: string;
}
