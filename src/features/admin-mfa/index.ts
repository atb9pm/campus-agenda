export type {
  AdminMfaClientFlags,
  AdminMfaStatus,
  AdminMfaStore,
  TeacherMfaBackupEntry,
  TeacherMfaRecord,
} from "./types.ts";
export {
  ADMIN_MFA_STATUSES,
  MFA_INVALID_CODE_REASON,
  MFA_PENDING_REASON,
  MFA_SETUP_REQUIRED_REASON,
  MFA_UNAVAILABLE_REASON,
  RESET_2FA_CONFIRM_TOKEN,
  isAdminMfaStatus,
  isReset2faConfirmToken,
} from "./types.ts";
export { resetAdminMfa } from "./reset.ts";
export {
  acknowledgeMfaRecoveryCodes,
  shouldShowMfaEnrollmentScreen,
} from "./recovery-continue.ts";
export type {
  AcknowledgedMfaRecovery,
  MfaEnrollmentScreenState,
} from "./recovery-continue.ts";
export { evaluateAdminMfaAccess, evaluateAdminMfaKeyGate } from "./guard.ts";
export type { AdminMfaGateResult } from "./guard.ts";
export {
  adminHasVerifiedMfa,
  adminMfaStatusView,
  adminNeedsMfaSetup,
  assertSecretsNotPlaintext,
  confirmAdminMfaEnrollment,
  confirmAdminMfaReconfigure,
  describeAdminMfaFlags,
  loadAdminMfa,
  regenerateAdminRecoveryCodes,
  startAdminMfaEnrollment,
  startAdminMfaReconfigure,
  verifyAdminMfaChallenge,
} from "./service.ts";
