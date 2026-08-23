import type { Membership } from "../../types/membership.ts";
import type { ReplaceTeacherInput, ReplaceTeacherResult } from "../../features/memberships/replacement.ts";

export interface MembershipStore {
  listMemberships(classroomId?: string): Promise<Membership[]>;
  replaceTeacher(input: ReplaceTeacherInput): Promise<
    | { ok: true; result: ReplaceTeacherResult }
    | { ok: false; reason: string }
  >;
}
