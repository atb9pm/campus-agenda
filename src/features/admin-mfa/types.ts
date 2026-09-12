export const ADMIN_MFA_STATUSES = ["disabled", "pending_setup", "enabled", "reset_required"] as const;

export type AdminMfaStatus = (typeof ADMIN_MFA_STATUSES)[number];

export interface TeacherMfaRecord {
  teacherId: string;
  status: AdminMfaStatus;
  secretEncrypted: string | null;
  pendingSecretEncrypted: string | null;
  recoveryHashes: string[];
  confirmedAt: string | null;
  updatedAt: string;
}

export interface TeacherMfaBackupEntry {
  teacher_id: string;
  status: string;
  secret_encrypted: string | null;
  pending_secret_encrypted: string | null;
  recovery_hashes: string | null;
  confirmed_at: string | null;
  updated_at: string | null;
}

export interface AdminMfaStore {
  get(teacherId: string): Promise<TeacherMfaRecord | null>;
  upsert(record: TeacherMfaRecord): Promise<void>;
  deleteForTeacher(teacherId: string): Promise<void>;
  exportAll(): Promise<TeacherMfaBackupEntry[]>;
  replaceAll(entries: TeacherMfaBackupEntry[]): Promise<void>;
}

export interface AdminMfaClientFlags {
  mfaPending: boolean;
  mfaSetupRequired: boolean;
  mfaChallengeRequired: boolean;
}

export const MFA_PENDING_REASON = "Double authentification requise.";
export const MFA_SETUP_REQUIRED_REASON = "Configuration de la double authentification requise.";
export const MFA_UNAVAILABLE_REASON = "Double authentification indisponible. Contactez l'hébergeur.";
export const MFA_INVALID_CODE_REASON = "Code incorrect.";
export const MFA_INVALID_PASSWORD_REASON = "Mot de passe incorrect.";
export const RESET_2FA_CONFIRM_TOKEN = "RESET-2FA";

export function isAdminMfaStatus(value: string): value is AdminMfaStatus {
  return (ADMIN_MFA_STATUSES as readonly string[]).includes(value);
}

export function isReset2faConfirmToken(value: string): boolean {
  return value.trim() === RESET_2FA_CONFIRM_TOKEN;
}
