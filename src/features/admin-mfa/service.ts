import {
  encryptTotpSecret,
  decryptTotpSecret,
  isMfaEncryptionReady,
  looksLikeEncryptedTotpSecret,
  MfaKeyUnavailableError,
} from "../../lib/auth/mfa-crypto.ts";
import {
  consumeRecoveryCode,
  generateRecoveryCodes,
  hashRecoveryCodes,
  parseRecoveryInput,
  recoveryHashesLookSafe,
} from "../../lib/auth/recovery-codes.ts";
import { otpauthQrDataUrl } from "../../lib/auth/mfa-qr.ts";
import { generateTotpSecret, totpOtpauthUri, verifyTotpCode } from "../../lib/auth/totp.ts";
import { logOperationalEvent } from "../../lib/observability/index.ts";
import type { AdminMfaClientFlags, AdminMfaStore, TeacherMfaRecord } from "./types.ts";
import { MFA_INVALID_CODE_REASON, MFA_UNAVAILABLE_REASON } from "./types.ts";

export const MFA_UNAVAILABLE_STATUS = 503;
export const MFA_DENIED_STATUS = 403;
export const MFA_INVALID_STATUS = 401;

type MfaFailure =
  | { ok: false; reason: string; status: number };

function unavailable(): MfaFailure {
  return { ok: false, reason: MFA_UNAVAILABLE_REASON, status: MFA_UNAVAILABLE_STATUS };
}

function invalidCode(): MfaFailure {
  return { ok: false, reason: MFA_INVALID_CODE_REASON, status: MFA_INVALID_STATUS };
}

function nowIso(): string {
  return new Date().toISOString();
}

function emptyRecord(teacherId: string): TeacherMfaRecord {
  return {
    teacherId,
    status: "disabled",
    secretEncrypted: null,
    pendingSecretEncrypted: null,
    recoveryHashes: [],
    confirmedAt: null,
    updatedAt: nowIso(),
  };
}

export function describeAdminMfaFlags(
  isAdmin: boolean,
  record: TeacherMfaRecord | null,
  mfaPending: boolean,
): AdminMfaClientFlags {
  if (!isAdmin) {
    return { mfaPending: false, mfaSetupRequired: false, mfaChallengeRequired: false };
  }
  const enabled = record?.status === "enabled";
  return {
    mfaPending,
    mfaSetupRequired: !enabled,
    mfaChallengeRequired: enabled && mfaPending,
  };
}

export function adminNeedsMfaSetup(isAdmin: boolean, record: TeacherMfaRecord | null): boolean {
  return isAdmin && record?.status !== "enabled";
}

export function adminHasVerifiedMfa(isAdmin: boolean, record: TeacherMfaRecord | null, mfaPending: boolean): boolean {
  return isAdmin && record?.status === "enabled" && !mfaPending;
}

export async function loadAdminMfa(store: AdminMfaStore, teacherId: string): Promise<TeacherMfaRecord | null> {
  return store.get(teacherId);
}

async function persist(store: AdminMfaStore, record: TeacherMfaRecord): Promise<void> {
  await store.upsert({ ...record, updatedAt: nowIso() });
}

export interface EnrollmentStart {
  ok: true;
  otpauthUri: string;
  qrDataUrl: string;
  manualKey: string;
}

export async function startAdminMfaEnrollment(
  store: AdminMfaStore,
  teacherId: string,
  accountLabel: string,
): Promise<EnrollmentStart | MfaFailure> {
  if (!isMfaEncryptionReady()) return unavailable();
  try {
    const secret = generateTotpSecret();
    const existing = (await store.get(teacherId)) ?? emptyRecord(teacherId);
    if (existing.status === "enabled") {
      return { ok: false, reason: "La double authentification est déjà activée.", status: 409 };
    }
    const encrypted = await encryptTotpSecret(secret);
    await persist(store, {
      ...existing,
      status: existing.status === "reset_required" ? "reset_required" : "pending_setup",
      secretEncrypted: encrypted,
      pendingSecretEncrypted: null,
      recoveryHashes: [],
      confirmedAt: null,
    });
    const otpauthUri = totpOtpauthUri(secret, accountLabel);
    return {
      ok: true,
      otpauthUri,
      qrDataUrl: await otpauthQrDataUrl(otpauthUri),
      manualKey: secret,
    };
  } catch (error) {
    if (error instanceof MfaKeyUnavailableError) return unavailable();
    throw error;
  }
}

export interface EnrollmentConfirm {
  ok: true;
  recoveryCodes: string[];
}

export async function confirmAdminMfaEnrollment(
  store: AdminMfaStore,
  teacherId: string,
  code: string,
): Promise<EnrollmentConfirm | MfaFailure> {
  if (!isMfaEncryptionReady()) return unavailable();
  const existing = await store.get(teacherId);
  if (!existing?.secretEncrypted || existing.status === "enabled") {
    return { ok: false, reason: "Aucune configuration 2FA en cours.", status: 400 };
  }
  try {
    const secret = await decryptTotpSecret(existing.secretEncrypted);
    if (!verifyTotpCode(secret, code)) return invalidCode();
    const recoveryCodes = generateRecoveryCodes();
    const recoveryHashes = await hashRecoveryCodes(recoveryCodes);
    await persist(store, {
      ...existing,
      status: "enabled",
      pendingSecretEncrypted: null,
      recoveryHashes,
      confirmedAt: nowIso(),
    });
    logOperationalEvent("admin_mfa_activated", { teacherId });
    return { ok: true, recoveryCodes };
  } catch (error) {
    if (error instanceof MfaKeyUnavailableError) return unavailable();
    throw error;
  }
}

export async function verifyAdminMfaChallenge(
  store: AdminMfaStore,
  teacherId: string,
  code: string,
): Promise<{ ok: true; usedRecovery: boolean } | MfaFailure> {
  if (!isMfaEncryptionReady()) return unavailable();
  const existing = await store.get(teacherId);
  if (!existing || existing.status !== "enabled" || !existing.secretEncrypted) {
    return { ok: false, reason: MFA_INVALID_CODE_REASON, status: MFA_INVALID_STATUS };
  }
  try {
    const recovery = parseRecoveryInput(code);
    if (recovery) {
      const consumed = await consumeRecoveryCode(recovery, existing.recoveryHashes);
      if (!consumed.ok) return invalidCode();
      await persist(store, { ...existing, recoveryHashes: consumed.remaining });
      logOperationalEvent("admin_mfa_recovery_used", { teacherId });
      return { ok: true, usedRecovery: true };
    }
    const secret = await decryptTotpSecret(existing.secretEncrypted);
    if (!verifyTotpCode(secret, code)) return invalidCode();
    return { ok: true, usedRecovery: false };
  } catch (error) {
    if (error instanceof MfaKeyUnavailableError) return unavailable();
    throw error;
  }
}

export async function startAdminMfaReconfigure(
  store: AdminMfaStore,
  teacherId: string,
  accountLabel: string,
  proof: string,
): Promise<EnrollmentStart | MfaFailure> {
  if (!isMfaEncryptionReady()) return unavailable();
  const existing = await store.get(teacherId);
  if (!existing || existing.status !== "enabled" || !existing.secretEncrypted) {
    return { ok: false, reason: "La double authentification n'est pas activée.", status: 400 };
  }
  const verified = await verifyAdminMfaChallenge(store, teacherId, proof);
  if (!verified.ok) return verified;
  try {
    const secret = generateTotpSecret();
    const latest = (await store.get(teacherId)) ?? existing;
    await persist(store, {
      ...latest,
      pendingSecretEncrypted: await encryptTotpSecret(secret),
    });
    const otpauthUri = totpOtpauthUri(secret, accountLabel);
    return {
      ok: true,
      otpauthUri,
      qrDataUrl: await otpauthQrDataUrl(otpauthUri),
      manualKey: secret,
    };
  } catch (error) {
    if (error instanceof MfaKeyUnavailableError) return unavailable();
    throw error;
  }
}

export async function confirmAdminMfaReconfigure(
  store: AdminMfaStore,
  teacherId: string,
  code: string,
): Promise<EnrollmentConfirm | MfaFailure> {
  if (!isMfaEncryptionReady()) return unavailable();
  const existing = await store.get(teacherId);
  if (!existing?.pendingSecretEncrypted || existing.status !== "enabled") {
    return { ok: false, reason: "Aucune reconfiguration 2FA en cours.", status: 400 };
  }
  try {
    const secret = await decryptTotpSecret(existing.pendingSecretEncrypted);
    if (!verifyTotpCode(secret, code)) return invalidCode();
    const recoveryCodes = generateRecoveryCodes();
    await persist(store, {
      ...existing,
      secretEncrypted: existing.pendingSecretEncrypted,
      pendingSecretEncrypted: null,
      recoveryHashes: await hashRecoveryCodes(recoveryCodes),
      confirmedAt: nowIso(),
    });
    logOperationalEvent("admin_mfa_reconfigured", { teacherId });
    return { ok: true, recoveryCodes };
  } catch (error) {
    if (error instanceof MfaKeyUnavailableError) return unavailable();
    throw error;
  }
}

export async function regenerateAdminRecoveryCodes(
  store: AdminMfaStore,
  teacherId: string,
  totpCode: string,
): Promise<EnrollmentConfirm | MfaFailure> {
  if (!isMfaEncryptionReady()) return unavailable();
  const existing = await store.get(teacherId);
  if (!existing || existing.status !== "enabled" || !existing.secretEncrypted) {
    return { ok: false, reason: "La double authentification n'est pas activée.", status: 400 };
  }
  try {
    const secret = await decryptTotpSecret(existing.secretEncrypted);
    if (!verifyTotpCode(secret, totpCode)) return invalidCode();
    const recoveryCodes = generateRecoveryCodes();
    await persist(store, {
      ...existing,
      recoveryHashes: await hashRecoveryCodes(recoveryCodes),
    });
    logOperationalEvent("admin_mfa_recovery_regenerated", { teacherId });
    return { ok: true, recoveryCodes };
  } catch (error) {
    if (error instanceof MfaKeyUnavailableError) return unavailable();
    throw error;
  }
}

export function adminMfaStatusView(record: TeacherMfaRecord | null): {
  status: TeacherMfaRecord["status"] | "disabled";
  enabled: boolean;
  recoveryRemaining: number;
} {
  if (!record) return { status: "disabled", enabled: false, recoveryRemaining: 0 };
  return {
    status: record.status,
    enabled: record.status === "enabled",
    recoveryRemaining: record.status === "enabled" ? record.recoveryHashes.length : 0,
  };
}

export function assertSecretsNotPlaintext(record: TeacherMfaRecord, plaintextSecret: string, codes: string[]): boolean {
  const blobs = [record.secretEncrypted, record.pendingSecretEncrypted, record.recoveryHashes.join("\n")];
  if (blobs.some((blob) => blob && blob.includes(plaintextSecret))) return false;
  if (!looksLikeEncryptedTotpSecret(record.secretEncrypted) && record.secretEncrypted) return false;
  return recoveryHashesLookSafe(record.recoveryHashes, codes);
}

export { MFA_INVALID_CODE_REASON, MFA_UNAVAILABLE_REASON };
