import {
  describeAdminMfaFlags,
  loadAdminMfa,
} from "@campus/features/admin-mfa/index.ts";
import type { TeacherSession } from "@campus/lib/persistence/types.ts";
import { getAdminMfaStore } from "@campus/lib/persistence/store-factory.ts";

import { getTeacherAccountsStore, getStore } from "./api.ts";

export async function buildTeacherClientSession(
  teacherId: string,
  session: Pick<TeacherSession, "teacherId" | "mfaPending">,
) {
  const [accounts, store, mfaStore] = await Promise.all([
    getTeacherAccountsStore(),
    getStore(),
    getAdminMfaStore(),
  ]);
  const account = await accounts.findAccount(teacherId);
  const isAdmin = await store.teacherIsAdmin(teacherId);
  const record = await loadAdminMfa(mfaStore, teacherId);
  const flags = describeAdminMfaFlags(isAdmin, record, Boolean(session.mfaPending));
  return {
    kind: "teacher" as const,
    teacherId,
    displayName: account?.displayName ?? "Enseignant",
    initials: account?.initials ?? "??",
    isAdmin,
    mustChangePassword: Boolean(account?.mustChangePassword),
    ...flags,
  };
}
