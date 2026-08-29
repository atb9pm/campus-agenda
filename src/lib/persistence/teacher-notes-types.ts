import type { ClassNotesDocument } from "../../features/class-notebook/types.ts";

export interface TeacherNotesBackupEntry {
  teacherId: string;
  document: ClassNotesDocument;
}

export interface TeacherNotesStore {
  /** Null si l'enseignant n'a encore rien enregistré côté serveur. */
  getNotes(teacherId: string): Promise<ClassNotesDocument | null>;
  saveNotes(teacherId: string, document: ClassNotesDocument): Promise<ClassNotesDocument>;
  /** Tous les documents de notes (sauvegarde admin). */
  exportAllNotes(): Promise<TeacherNotesBackupEntry[]>;
  /** Remplace entièrement la table (restauration admin). */
  replaceAllNotes(entries: TeacherNotesBackupEntry[]): Promise<void>;
}
