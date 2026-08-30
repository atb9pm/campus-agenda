/** Compte enseignant tel qu'exposé à l'administration (jamais l'empreinte). */
export interface TeacherAccountRecord {
  id: string;
  displayName: string;
  initials: string;
  isAdmin: boolean;
  isActive: boolean;
  /** Compte mis de côté (hors liste courante, connexion refusée). */
  isArchived: boolean;
  /** Horodatage d'archivage, null si non archivé. */
  archivedAt: string | null;
  /** Dernière connexion réussie, null si jamais observée. */
  lastLoginAt: string | null;
  /** Le compte doit choisir un mot de passe personnel avant toute autre action. */
  mustChangePassword: boolean;
  /** Vrai dès qu'un mot de passe personnel haché est enregistré. */
  hasPassword: boolean;
  createdAt: string | null;
  passwordUpdatedAt: string | null;
  /**
   * TECHNICAL | GENERAL. Null = à configurer (legacy / bootstrap).
   * Ce n'est PAS un troisième type.
   */
  teachingType: "TECHNICAL" | "GENERAL" | null;
}

export interface TeacherAccountInput {
  displayName: string;
  initials: string;
  isAdmin?: boolean;
  /** Absent = compatibilité bootstrap / legacy (null). L'API admin l'exige. */
  teachingType?: "TECHNICAL" | "GENERAL";
}

export interface TeacherAccountPatch {
  displayName?: string;
  initials?: string;
  isAdmin?: boolean;
  isActive?: boolean;
  isArchived?: boolean;
  teachingType?: "TECHNICAL" | "GENERAL" | null;
}

/** Création ou réinitialisation : le mot de passe provisoire n'est montré qu'une fois. */
export interface TeacherAccountWithSecret {
  account: TeacherAccountRecord;
  temporaryPassword: string;
}

export type TeacherAccountResult =
  | { ok: true; account: TeacherAccountRecord }
  | { ok: false; reason: string; status: 400 | 404 | 409 };

export type TeacherAccountSecretResult =
  | { ok: true; account: TeacherAccountRecord; temporaryPassword: string }
  | { ok: false; reason: string; status: 400 | 404 | 409 };

export type TeacherPasswordChangeResult =
  | { ok: true }
  | { ok: false; reason: string; status: 400 | 401 | 404 };

export interface TeacherAuthOutcome {
  ok: boolean;
  teacherId?: string;
  reason?: string;
  mustChangePassword?: boolean;
}
