import type { ClassNotesDocument } from "../../features/class-notebook/types.ts";

export interface TeacherNotesStore {
  /** Null si l'enseignant n'a encore rien enregistré côté serveur. */
  getNotes(teacherId: string): Promise<ClassNotesDocument | null>;
  saveNotes(teacherId: string, document: ClassNotesDocument): Promise<ClassNotesDocument>;
}
