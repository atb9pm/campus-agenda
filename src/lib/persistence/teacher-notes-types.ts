import type { ClassNotesDocument } from "../../features/class-notebook/types.ts";
import type { AnnualCourseNote } from "../../features/pedagogical-path/annual-notes.ts";
import type { AnnualCourseNotesStore } from "./pedagogical-path-types.ts";

export interface NotebookState {
  leftover: ClassNotesDocument | null;
  owned: AnnualCourseNote[];
  /** Internal compare-and-swap token, never sent to the client. */
  token: string;
}

export class NotebookConflictError extends Error {
  constructor() {
    super("Les notes ont changé depuis leur chargement. Rechargez le Carnet avant de réessayer.");
  }
}

export interface TeacherNotesBackupEntry {
  teacherId: string;
  document: ClassNotesDocument;
}

export interface TeacherNotesStore {
  readNotebook(
    teacherId: string,
    courseNotes: AnnualCourseNotesStore,
    annualCourseIds: readonly string[],
  ): Promise<NotebookState>;
  /**
   * Atomically replaces leftover JSON + Carnet notes of `replaceCourseIds`.
   * The CAS token covers `annualCourseIds` (typically every accessible course).
   */
  commitNotebook(
    teacherId: string,
    expected: NotebookState,
    leftover: ClassNotesDocument,
    owned: readonly AnnualCourseNote[],
    courseNotes: AnnualCourseNotesStore,
    annualCourseIds: readonly string[],
    replaceCourseIds?: readonly string[],
  ): Promise<void>;
  /** Null si l'enseignant n'a encore rien enregistré côté serveur. */
  getNotes(teacherId: string): Promise<ClassNotesDocument | null>;
  saveNotes(teacherId: string, document: ClassNotesDocument): Promise<ClassNotesDocument>;
  /** Tous les documents de notes (sauvegarde admin). */
  exportAllNotes(): Promise<TeacherNotesBackupEntry[]>;
  /** Remplace entièrement la table (restauration admin). */
  replaceAllNotes(entries: TeacherNotesBackupEntry[]): Promise<void>;
}
