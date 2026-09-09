export interface StudentAccess {
  id: string;
  classroomId: string;
  label: string;
  schoolClassId?: string | null;
}

export type StudentAccessUiStatus = "none" | "active" | "prepared" | "revoked" | "historical";

/** Métadonnées sûres pour l'API admin : jamais de hash ni de code. */
export interface StudentAccessMetadata {
  accessId: string;
  schoolClassId: string;
  classroomId: string;
  createdAt: string | null;
  updatedAt: string | null;
  revokedAt: string | null;
  status: StudentAccessUiStatus;
}

/** Vue lecture seule pour Mes cours : jamais de hash, jamais de chiffrement. */
export type TeacherClassAccessStatus = "active" | "none" | "revoked" | "needs_admin";

export interface TeacherClassAccessView {
  schoolClassId: string;
  code: string | null;
  status: TeacherClassAccessStatus;
}
