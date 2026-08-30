import { endAssignment, findDuplicateAssignment, isAssignmentActiveAt } from "./assignments.ts";
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
  effectiveAt?: string;
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
 * Remplacement définitif : clôture l'attribution sortante, crée l'entrante
 * sur le même AnnualCourse. Aucune copie ni suppression de données pédagogiques.
 * Adapté de replaceTeacherMemberships (memberships/replacement.ts).
 */
export function replaceTeacherOnAnnualCourse(
  assignments: TeacherCourseAssignment[],
  input: ReplaceAnnualCourseTeacherInput,
): CourseMutationResult<ReplaceAnnualCourseTeacherResult> {
  const effectiveAt = input.effectiveAt ?? new Date().toISOString();
  if (input.outgoingTeacherId === input.incomingTeacherId) {
    return { ok: false, reason: "Le remplaçant doit être un autre enseignant.", status: 400 };
  }

  const outgoing = assignments.filter(
    (entry) =>
      entry.annualCourseId === input.annualCourseId &&
      entry.teacherId === input.outgoingTeacherId &&
      isAssignmentActiveAt(entry, effectiveAt),
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
    validFrom: effectiveAt,
    validTo: input.incomingValidTo ?? null,
    createdByAdminId: input.createdByAdminId,
    createdAt: effectiveAt,
    endedAt: null,
    overrideReason: input.overrideReason ?? null,
    overrideByAdminId: input.forceIncompatible ? input.createdByAdminId : null,
  };

  const duplicate = findDuplicateAssignment(assignments, created);
  if (duplicate) {
    return {
      ok: false,
      reason: "Cet enseignant a déjà une attribution active sur ce cours.",
      status: 409,
    };
  }

  const closed = outgoing.map((entry) => endAssignment(entry, effectiveAt));
  const next = assignments.map((entry) => {
    const replacement = closed.find((item) => item.id === entry.id);
    return replacement ?? entry;
  });
  next.push(created);

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
  if (!input.validFrom || !input.validTo) {
    return { ok: false, reason: "Un remplacement temporaire exige validFrom et validTo.", status: 400 };
  }
  if (input.validTo < input.validFrom) {
    return { ok: false, reason: "La fin du remplacement doit être postérieure au début.", status: 400 };
  }

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
