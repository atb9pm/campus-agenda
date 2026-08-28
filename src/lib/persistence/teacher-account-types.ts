import type {
  TeacherAccountInput,
  TeacherAccountPatch,
  TeacherAccountRecord,
  TeacherAccountResult,
  TeacherAccountSecretResult,
  TeacherAuthOutcome,
  TeacherPasswordChangeResult,
} from "../../features/teacher-accounts/types.ts";

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
}
