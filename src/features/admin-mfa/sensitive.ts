import type { TeacherAccountStore } from "../../lib/persistence/teacher-account-types.ts";
import {
  regenerateAdminRecoveryCodes,
  startAdminMfaPendingReconfigure,
  startAdminMfaReconfigure,
  startAdminMfaReconfigureWithRecovery,
  type EnrollmentConfirm,
  type EnrollmentStart,
} from "./service.ts";
import type { AdminMfaStore } from "./types.ts";
import { MFA_INVALID_PASSWORD_REASON } from "./types.ts";

type SensitiveFailure = { ok: false; reason: string; status: number };

async function requirePassword(
  accounts: TeacherAccountStore,
  teacherId: string,
  password: string,
): Promise<{ ok: true } | SensitiveFailure> {
  if (!(await accounts.verifyCredentials(teacherId, password))) {
    return { ok: false, reason: MFA_INVALID_PASSWORD_REASON, status: 401 };
  }
  return { ok: true };
}

export async function startAdminMfaReconfigureWithPassword(
  store: AdminMfaStore,
  accounts: TeacherAccountStore,
  teacherId: string,
  accountLabel: string,
  password: string,
  totp: string,
): Promise<EnrollmentStart | SensitiveFailure> {
  const gate = await requirePassword(accounts, teacherId, password);
  if (!gate.ok) return gate;
  return startAdminMfaReconfigure(store, teacherId, accountLabel, totp);
}

export async function startAdminMfaLostPhoneReconfigure(
  store: AdminMfaStore,
  accounts: TeacherAccountStore,
  teacherId: string,
  accountLabel: string,
  password: string,
  recoveryCode: string,
  options: { recoveryRecentlyVerified?: boolean } = {},
): Promise<EnrollmentStart | SensitiveFailure> {
  const gate = await requirePassword(accounts, teacherId, password);
  if (!gate.ok) return gate;
  if (options.recoveryRecentlyVerified) {
    return startAdminMfaPendingReconfigure(store, teacherId, accountLabel);
  }
  return startAdminMfaReconfigureWithRecovery(store, teacherId, accountLabel, recoveryCode);
}

export async function regenerateAdminRecoveryCodesWithPassword(
  store: AdminMfaStore,
  accounts: TeacherAccountStore,
  teacherId: string,
  password: string,
  totp: string,
): Promise<EnrollmentConfirm | SensitiveFailure> {
  const gate = await requirePassword(accounts, teacherId, password);
  if (!gate.ok) return gate;
  return regenerateAdminRecoveryCodes(store, teacherId, totp);
}
