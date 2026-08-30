import type {
  AnnualCourseNote,
  AnnualCourseNoteFilter,
  AnnualCourseNoteInput,
  ReferencePedagogicalPath,
} from "../../features/pedagogical-path/index.ts";

export interface PedagogicalPathStore {
  getPathByContextId(contextId: string): Promise<ReferencePedagogicalPath | null>;
  listPaths(): Promise<ReferencePedagogicalPath[]>;
  savePath(path: ReferencePedagogicalPath): Promise<ReferencePedagogicalPath>;
  deletePathByContextId(contextId: string): Promise<boolean>;
}

export interface AnnualCourseNotesStore {
  listNotes(filter: AnnualCourseNoteFilter): Promise<AnnualCourseNote[]>;
  getNote(id: string): Promise<AnnualCourseNote | null>;
  createNote(id: string, input: AnnualCourseNoteInput): Promise<AnnualCourseNote>;
  deleteNote(id: string): Promise<boolean>;
  /** Efface uniquement les notes importées (héritées) pour le cours courant. */
  deleteInheritedNotes(filter: AnnualCourseNoteFilter): Promise<number>;
  countByContextId(contextId: string): Promise<number>;
  /** Lie les notes déjà présentes (même année + classe + CTX) à un AnnualCourse. */
  attachAnnualCourseId(filter: AnnualCourseNoteFilter, annualCourseId: string): Promise<number>;
}
