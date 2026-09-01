import type {
  TeacherAccountInput,
  TeacherAccountPatch,
  TeacherAccountRecord,
  TeacherAccountResult,
  TeacherAccountSecretResult,
  TeacherAuthOutcome,
  TeacherPasswordChangeResult,
} from "../../features/teacher-accounts/types.ts";

/** Compte tel qu'exporté dans une sauvegarde admin (empreinte incluse, jamais le clair). */
export interface TeacherAccountBackupEntry {
  id: string;
  displayName: string;
  initials: string;
  isAdmin: boolean;
  isActive: boolean;
  mustChangePassword: boolean;
  passwordHash: string;
  createdAt: string | null;
  passwordUpdatedAt: string | null;
  archivedAt?: string | null;
  lastLoginAt?: string | null;
}

export interface TeacherAccountStore {
  listAccounts(): Promise<TeacherAccountRecord[]>;
  findAccount(teacherId: string): Promise<TeacherAccountRecord | null>;
  findAccountByInitials(initials: string): Promise<TeacherAccountRecord | null>;
  /** Création par un administrateur : renvoie le mot de passe provisoire à afficher. */
  createAccount(input: TeacherAccountInput): Promise<TeacherAccountSecretResult>;
  updateAccount(teacherId: string, patch: TeacherAccountPatch): Promise<TeacherAccountResult>;
  /** Réinitialisation par un administrateur : nouveau mot de passe provisoire. */
  resetPassword(teacherId: string): Promise<TeacherAccountSecretResult>;
  /** Changement par l'enseignant lui-même : exige le mot de passe courant. */
  changeOwnPassword(
    teacherId: string,
    currentPassword: string,
    nextPassword: string,
  ): Promise<TeacherPasswordChangeResult>;
  /** Applique un mot de passe connu (amorçage administrateur uniquement). */
  setPassword(teacherId: string, password: string, mustChangePassword: boolean): Promise<boolean>;
  authenticate(initialsOrId: string, password: string): Promise<TeacherAuthOutcome>;
  mustChangePassword(teacherId: string): Promise<boolean>;
  /** Tous les comptes avec empreintes (sauvegarde admin). */
  exportAllAccounts(): Promise<TeacherAccountBackupEntry[]>;
  /**
   * Upsert des comptes depuis une sauvegarde (empreintes incluses).
   * Ne supprime pas les enseignants absents du snapshot (contraintes FK).
   */
  replaceAllAccounts(entries: TeacherAccountBackupEntry[]): Promise<void>;
}
