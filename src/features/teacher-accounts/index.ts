export {
  checkPasswordStrength,
  DEMO_TEACHER_PASSWORD,
  isDemoTeacherPassword,
  MIN_PASSWORD_LENGTH,
  type PasswordCheck,
} from "./password-policy.ts";
export {
  buildTeacherId,
  checkAccountInput,
  initialsKey,
  normalizeDisplayName,
  normalizeInitials,
  sameInitials,
  sortAccounts,
  wouldRemoveLastAdmin,
} from "./rules.ts";
export type { AccountInputCheck } from "./rules.ts";
export type {
  TeacherAccountInput,
  TeacherAccountPatch,
  TeacherAccountRecord,
  TeacherAccountResult,
  TeacherAccountSecretResult,
  TeacherAccountWithSecret,
  TeacherAuthOutcome,
  TeacherPasswordChangeResult,
} from "./types.ts";
