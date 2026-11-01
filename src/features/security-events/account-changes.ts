import type { SecurityEventType } from "./catalog.ts";

export interface AccountSecurityState {
  initials: string;
  isAdmin: boolean;
  isActive: boolean;
  isArchived: boolean;
}

/** Changements de sécurité d'un compte enseignant ; le nom affiché n'en fait pas partie. */
export function accountSecurityChanges(before: AccountSecurityState, after: AccountSecurityState): SecurityEventType[] {
  const changes: SecurityEventType[] = [];
  if (!before.isAdmin && after.isAdmin) changes.push("TEACHER_ADMIN_ROLE_GRANTED");
  if (before.isAdmin && !after.isAdmin) changes.push("TEACHER_ADMIN_ROLE_REVOKED");
  if (before.isActive && !after.isActive) changes.push("TEACHER_ACCOUNT_DISABLED");
  if (!before.isActive && after.isActive) changes.push("TEACHER_ACCOUNT_ENABLED");
  if (!before.isArchived && after.isArchived) changes.push("TEACHER_ACCOUNT_ARCHIVED");
  if (before.isArchived && !after.isArchived) changes.push("TEACHER_ACCOUNT_UNARCHIVED");
  if (before.initials !== after.initials) changes.push("TEACHER_LOGIN_IDENTIFIER_CHANGED");
  return changes;
}
