import { randomUUID } from "node:crypto";

import type { Membership } from "../../types/membership.ts";
import { isMembershipActiveAt } from "./validity.ts";

export interface ReplaceTeacherInput {
  classroomId: string;
  outgoingTeacherId: string;
  incomingTeacherId: string;
  subjectIds: string[];
  effectiveAt?: string;
}

export interface ReplaceTeacherResult {
  memberships: Membership[];
  closedIds: string[];
  created: Membership;
}

export function replaceTeacherMemberships(
  memberships: Membership[],
  input: ReplaceTeacherInput,
): ReplaceTeacherResult | { ok: false; reason: string } {
  const effectiveAt = input.effectiveAt ?? new Date().toISOString();
  const subjectSet = new Set(input.subjectIds);

  if (input.outgoingTeacherId === input.incomingTeacherId) {
    return { ok: false, reason: "Le remplaçant doit être un autre enseignant." };
  }

  const activeOutgoing = memberships.filter(
    (membership) =>
      membership.classroomId === input.classroomId
      && membership.teacherId === input.outgoingTeacherId
      && isMembershipActiveAt(membership, effectiveAt),
  );

  const transferable = activeOutgoing.flatMap((membership) =>
    membership.subjectIds
      .filter((subjectId) => subjectSet.has(subjectId))
      .map((subjectId) => ({ membership, subjectId })),
  );

  if (transferable.length === 0) {
    return { ok: false, reason: "Aucune branche active à transférer pour cet enseignant." };
  }

  const transferredSubjectIds = [...new Set(transferable.map((entry) => entry.subjectId))];
  const next = memberships.map((membership) => ({ ...membership, subjectIds: [...membership.subjectIds] }));
  const closedIds: string[] = [];

  for (const membership of activeOutgoing) {
    const toTransfer = membership.subjectIds.filter((subjectId) => subjectSet.has(subjectId));
    if (toTransfer.length === 0) continue;

    const index = next.findIndex((candidate) => candidate.id === membership.id);
    if (index < 0) continue;

    const remaining = membership.subjectIds.filter((subjectId) => !subjectSet.has(subjectId));
    next[index] = { ...next[index], validTo: effectiveAt };

    if (remaining.length > 0) {
      next.push({
        id: randomUUID(),
        teacherId: membership.teacherId,
        classroomId: membership.classroomId,
        subjectIds: remaining,
        validFrom: effectiveAt,
        validTo: null,
      });
    }

    closedIds.push(membership.id);
  }

  const created: Membership = {
    id: randomUUID(),
    teacherId: input.incomingTeacherId,
    classroomId: input.classroomId,
    subjectIds: transferredSubjectIds,
    validFrom: effectiveAt,
    validTo: null,
  };
  next.push(created);

  return { memberships: next, closedIds, created };
}
