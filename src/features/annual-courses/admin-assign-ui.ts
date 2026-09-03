import type { SchoolClassRecord } from "../school-catalog/types.ts";
import { isOperationalSchoolClass } from "../school-catalog/class-lifecycle.ts";
import { isAssignmentActiveAt } from "./assignments.ts";
import type { AssignmentRole, TeacherCourseAssignment } from "./types.ts";

export type AssignmentLifecycle = "upcoming" | "active" | "ended";
export type AssignmentDisplayStatus =
  | AssignmentLifecycle
  | "class-archived"
  | "class-inactive"
  | "class-unavailable"
  | "course-archived";
export type AssignConflictChoice = "CO_TEACHER" | "REPLACE" | "TEMPORARY" | "CANCEL";
export type AssignForceStep = "none" | "warn" | "confirm";

export function assignmentLifecycle(
  assignment: Pick<TeacherCourseAssignment, "validFrom" | "validTo" | "endedAt">,
  at = new Date().toISOString(),
): AssignmentLifecycle {
  if (assignment.validFrom > at) return "upcoming";
  if (isAssignmentActiveAt(assignment, at)) return "active";
  return "ended";
}

export function lifecycleLabel(status: AssignmentLifecycle): string {
  if (status === "upcoming") return "À venir";
  if (status === "active") return "Active";
  return "Terminée";
}

/**
 * Libellé d’administration : l’historique date des TCA reste distinct de la
 * disponibilité opérationnelle de la classe. Jamais « Active » si la classe
 * est archivée, désactivée, absente ou hors année.
 */
export function assignmentDisplayStatus(
  assignment: Pick<TeacherCourseAssignment, "validFrom" | "validTo" | "endedAt">,
  options: {
    schoolClass?: Pick<SchoolClassRecord, "isActive" | "isArchived" | "schoolYearId"> | null;
    courseSchoolYearId?: string | null;
    courseIsArchived?: boolean;
    activeSchoolYearId?: string | null;
    at?: string;
  } = {},
): AssignmentDisplayStatus {
  const dateStatus = assignmentLifecycle(assignment, options.at);
  if (dateStatus !== "active") return dateStatus;
  const schoolClass = options.schoolClass ?? null;
  if (schoolClass?.isArchived) return "class-archived";
  if (schoolClass && !schoolClass.isActive) return "class-inactive";
  if (options.courseIsArchived) return "course-archived";
  if (!schoolClass) return "class-unavailable";
  if (!isOperationalSchoolClass(schoolClass, options.courseSchoolYearId ?? schoolClass.schoolYearId)) {
    return "class-unavailable";
  }
  const activeYear = options.activeSchoolYearId?.trim() || null;
  const courseYear = options.courseSchoolYearId?.trim() || null;
  if (activeYear && courseYear && courseYear !== activeYear) return "class-unavailable";
  return "active";
}

export function assignmentDisplayLabel(status: AssignmentDisplayStatus): string {
  if (status === "class-archived") return "Classe archivée";
  if (status === "class-inactive") return "Classe désactivée";
  if (status === "class-unavailable") return "Terminée";
  if (status === "course-archived") return "Cours archivé";
  return lifecycleLabel(status);
}

export type AssignmentDialogDecision =
  | { type: "cancel" }
  | { type: "need-force-confirm"; reason: string }
  | { type: "error"; reason: string }
  | { type: "assign"; role: "PRIMARY" | "CO_TEACHER"; force: boolean }
  | { type: "replace"; force: boolean; effectiveAt: string }
  | { type: "temporary"; force: boolean; validFrom: string; validTo: string };

/**
 * Décision du dialogue d'attribution. Le CANCEL ne s'applique que s'il existe
 * déjà une attribution. Sans professeur, le premier est toujours PRIMARY.
 */
export function decideAssignmentDialogSubmit(input: {
  existingCount: number;
  conflictChoice: AssignConflictChoice;
  forceStep: AssignForceStep;
  tempFrom: string;
  tempTo: string;
  effectiveAt: string;
}): AssignmentDialogDecision {
  const force = input.forceStep === "confirm";
  if (input.forceStep === "warn") {
    return { type: "need-force-confirm", reason: "Confirmez le forçage : cette attribution est incompatible." };
  }

  if (input.existingCount === 0) {
    return { type: "assign", role: "PRIMARY", force };
  }

  if (input.conflictChoice === "CANCEL") {
    return { type: "cancel" };
  }
  if (input.conflictChoice === "CO_TEACHER") {
    return { type: "assign", role: "CO_TEACHER", force };
  }
  if (input.conflictChoice === "REPLACE") {
    if (!input.effectiveAt.trim()) {
      return { type: "error", reason: "Indiquez la date d'effet du remplacement." };
    }
    return { type: "replace", force, effectiveAt: input.effectiveAt };
  }
  if (input.conflictChoice === "TEMPORARY") {
    if (!input.tempFrom.trim() || !input.tempTo.trim()) {
      return { type: "error", reason: "Indiquez le début et la fin du remplacement temporaire." };
    }
    return { type: "temporary", force, validFrom: input.tempFrom, validTo: input.tempTo };
  }
  return { type: "cancel" };
}

export function isClassEligibleForAssignment(options: {
  isActive: boolean;
  isArchived?: boolean;
  schoolYearId: string | null;
  professionId: string | null;
  trainingYear: number | null;
  yearStatus?: "draft" | "active" | "archived" | string | null;
  professionActive?: boolean;
  professionArchived?: boolean;
}): boolean {
  if (options.isArchived) return false;
  if (!options.isActive) return false;
  if (!options.schoolYearId || !options.professionId || options.trainingYear === null) return false;
  if (options.yearStatus === "archived") return false;
  if (options.yearStatus && options.yearStatus !== "draft" && options.yearStatus !== "active") return false;
  if (options.professionActive === false || options.professionArchived === true) return false;
  return true;
}

export function assignmentRoleForFirstTeacher(): AssignmentRole {
  return "PRIMARY";
}

/** Date d'effet pour « Retirer » : validFrom si à venir, sinon maintenant (undefined → serveur). */
export function effectiveAtForEndAssignment(
  assignment: Pick<TeacherCourseAssignment, "validFrom" | "validTo" | "endedAt">,
  at = new Date().toISOString(),
): string | undefined {
  return assignmentLifecycle(assignment, at) === "upcoming" ? assignment.validFrom : undefined;
}
