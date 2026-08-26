import { DEMO_MEMBERSHIPS } from "../../features/classes/demo-data.ts";
import { replaceTeacherMemberships } from "../../features/memberships/replacement.ts";
import type { ReplaceTeacherInput, ReplaceTeacherResult } from "../../features/memberships/replacement.ts";
import type { Membership } from "../../types/membership.ts";
import type { MembershipStore } from "./membership-types.ts";

let memoryMemberships: Membership[] = DEMO_MEMBERSHIPS.map((membership) => ({ ...membership, subjectIds: [...membership.subjectIds] }));

export class MemoryMembershipStore implements MembershipStore {
  async listMemberships(classroomId?: string): Promise<Membership[]> {
    const scoped = classroomId
      ? memoryMemberships.filter((membership) => membership.classroomId === classroomId)
      : memoryMemberships;
    return scoped.map((membership) => ({ ...membership, subjectIds: [...membership.subjectIds] }));
  }

  async replaceTeacher(input: ReplaceTeacherInput): Promise<
    | { ok: true; result: ReplaceTeacherResult }
    | { ok: false; reason: string }
  > {
    const outcome = replaceTeacherMemberships(memoryMemberships, input);
    if ("ok" in outcome && outcome.ok === false) {
      return outcome;
    }
    memoryMemberships = outcome.memberships;
    return { ok: true, result: outcome };
  }
}

export function resetMemoryMembershipStore(): void {
  memoryMemberships = DEMO_MEMBERSHIPS.map((membership) => ({ ...membership, subjectIds: [...membership.subjectIds] }));
}

export function getMemoryMembershipsSnapshot(): Membership[] {
  return memoryMemberships.map((membership) => ({ ...membership, subjectIds: [...membership.subjectIds] }));
}

export function setMemoryMemberships(memberships: Membership[]): void {
  memoryMemberships = memberships.map((membership) => ({ ...membership, subjectIds: [...membership.subjectIds] }));
}
