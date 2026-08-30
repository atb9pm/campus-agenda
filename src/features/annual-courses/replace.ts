import { endAssignment, findDuplicateAssignment, findOverlappingPrimary, isAssignmentActiveAt } from "./assignments.ts";
import type {
  AssignmentRole,
  CourseMutationResult,
  TeacherCourseAssignment,
} from "./types.ts";

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export interface ReplaceAnnualCourseTeacherInput {
  annualCourseId: string;
  outgoingTeacherId: string;
  incomingTeacherId: string;
  createdByAdminId: string;
  createdAt: string;
  effectiveAt: string;
  incomingRole?: AssignmentRole;
  incomingValidTo?: string | null;
  forceIncompatible?: boolean;
  overrideReason?: string | null;
}

export interface ReplaceAnnualCourseTeacherResult {
  closed: TeacherCourseAssignment[];
  created: TeacherCourseAssignment;
  assignments: TeacherCourseAssignment[];
}

/**
 * Remplacement définitif : calcule l'état prospectif, refuse tout chevauchement,
 * puis seulement clôture + création. createdAt = date administrative, pas effectiveAt.
 */
export function replaceTeacherOnAnnualCourse(
  assignments: TeacherCourseAssignment[],
  input: ReplaceAnnualCourseTeacherInput,
): CourseMutationResult<ReplaceAnnualCourseTeacherResult> {
  if (input.outgoingTeacherId === input.incomingTeacherId) {
    return { ok: false, reason: "Le remplaçant doit être un autre enseignant.", status: 400 };
  }

  const outgoing = assignments.filter(
    (entry) =>
      entry.annualCourseId === input.annualCourseId &&
      entry.teacherId === input.outgoingTeacherId &&
      isAssignmentActiveAt(entry, input.effectiveAt),
  );
  if (outgoing.length === 0) {
    return {
      ok: false,
      reason: "Aucune attribution active à transférer pour cet enseignant.",
      status: 400,
    };
  }

  const created: TeacherCourseAssignment = {
    id: createId("tca"),
    annualCourseId: input.annualCourseId,
    teacherId: input.incomingTeacherId,
    role: input.incomingRole ?? "PRIMARY",
    validFrom: input.effectiveAt,
    validTo: input.incomingValidTo ?? null,
    createdByAdminId: input.createdByAdminId,
    createdAt: input.createdAt,
    endedAt: null,
    overrideReason: input.overrideReason ?? null,
    overrideByAdminId: input.forceIncompatible ? input.createdByAdminId : null,
  };

  const closed = outgoing.map((entry) => endAssignment(entry, input.effectiveAt));
  const prospective = assignments.map((entry) => {
    const replacement = closed.find((item) => item.id === entry.id);
    return replacement ?? entry;
  });

  const duplicate = findDuplicateAssignment(prospective, created);
  if (duplicate) {
    return {
      ok: false,
      reason: "Cet enseignant a déjà une attribution qui recouvre cette période.",
      status: 409,
    };
  }

  if (created.role === "PRIMARY") {
    const primary = findOverlappingPrimary(prospective, created);
    if (primary) {
      return {
        ok: false,
        reason: "Ce cours a déjà un titulaire sur cette période. Le remplacement est refusé.",
        status: 409,
        code: "PRIMARY_TAKEN",
        existing: [primary],
      };
    }
  }

  const next = [...prospective, created];
  return {
    ok: true,
    value: {
      closed,
      created,
      assignments: next,
    },
  };
}

export interface TemporaryReplacementInput {
  annualCourseId: string;
  teacherId: string;
  createdByAdminId: string;
  validFrom: string;
  validTo: string;
  forceIncompatible?: boolean;
  overrideReason?: string | null;
}

export function buildTemporaryReplacement(
  existing: TeacherCourseAssignment[],
  input: TemporaryReplacementInput,
  createdAt = new Date().toISOString(),
): CourseMutationResult<TeacherCourseAssignment> {
  const created: TeacherCourseAssignment = {
    id: createId("tca"),
    annualCourseId: input.annualCourseId,
    teacherId: input.teacherId,
    role: "REPLACEMENT",
    validFrom: input.validFrom,
    validTo: input.validTo,
    createdByAdminId: input.createdByAdminId,
    createdAt,
    endedAt: null,
    overrideReason: input.overrideReason ?? null,
    overrideByAdminId: input.forceIncompatible ? input.createdByAdminId : null,
  };

  const duplicate = findDuplicateAssignment(existing, created);
  if (duplicate) {
    return {
      ok: false,
      reason: "Cet enseignant a déjà une attribution qui recouvre cette période.",
      status: 409,
    };
  }

  return { ok: true, value: created };
}
