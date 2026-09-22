export {
  AUTH_SECRET_MIN_BYTES,
  AUTH_SECRET_MISSING_PRODUCTION,
  AUTH_SECRET_WEAK_PRODUCTION,
  DEV_FALLBACK_AUTH_SECRET,
  assertProductionAuthSecret,
  authSecretByteLength,
  getAuthSecret,
} from "./config.ts";
export {
  MFA_KEY_ENV,
  MFA_REQUIRE_KEY_ENV,
  decryptTotpSecret,
  encryptTotpSecret,
  hasExplicitMfaEncryptionKey,
  isMfaEncryptionReady,
  isMfaKeyRequired,
  looksLikeEncryptedTotpSecret,
  parseMfaEncryptionKey,
  resolveMfaEncryptionKey,
  MfaKeyUnavailableError,
} from "./mfa-crypto.ts";
export {
  TOTP_DIGITS,
  TOTP_ISSUER,
  TOTP_PERIOD_SECONDS,
  TOTP_WINDOW,
  generateTotpCode,
  generateTotpSecret,
  normalizeTotpInput,
  totpOtpauthUri,
  verifyTotpCode,
} from "./totp.ts";
export {
  RECOVERY_CODE_COUNT,
  consumeRecoveryCode,
  recoveryCodeIsValid,
  generateRecoveryCodes,
  hashRecoveryCodes,
  normalizeRecoveryCode,
  parseRecoveryHashes,
  parseRecoveryInput,
  serializeRecoveryHashes,
} from "./recovery-codes.ts";
export { constantTimeEquals } from "./password.ts";
export {
  checkPasswordStrength,
  DEFAULT_PBKDF2_ITERATIONS,
  DEMO_TEACHER_PASSWORD,
  demoPasswordAllowed,
  generateTemporaryPassword,
  hashPassword,
  isDemoTeacherPassword,
  isLegacyDemoHash,
  isUsablePasswordHash,
  legacyDemoPasswordHash,
  MIN_DEV_PBKDF2_ITERATIONS,
  MIN_PASSWORD_LENGTH,
  MIN_PRODUCTION_PBKDF2_ITERATIONS,
  resolvePbkdf2Iterations,
  verifyPassword,
} from "./password.ts";
export {
  buildSessionCookie,
  clearSessionCookie,
  createSessionToken,
  getSessionCookieName,
  parseSessionToken,
  readSessionTokenFromRequest,
  REMEMBERED_SESSION_TTL_MS,
  SESSION_TTL_MS,
  sessionTtlMs,
} from "./session.ts";
export {
  canMutateAgenda,
  canReadClassroomAgenda,
  forbiddenResponse,
  unauthorizedResponse,
} from "./permissions.ts";
export { revalidateLiveSession, type LiveSessionLookup } from "./session-live.ts";
export {
  classifyCredentialTimestamp,
  isSessionOlderThanCredential,
  parseCredentialTimestamp,
} from "./session-freshness.ts";
