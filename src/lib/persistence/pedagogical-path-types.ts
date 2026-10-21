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
  countByClassId(classId: string): Promise<number>;
  /** Lie les notes déjà présentes (même année + classe + CTX) à un AnnualCourse. */
  attachAnnualCourseId(filter: AnnualCourseNoteFilter, annualCourseId: string): Promise<number>;
  /** Notes du document Carnet d'un enseignant (ownerTeacherId, legacy / transition N→N+1). */
  listNotesByOwner(ownerTeacherId: string): Promise<AnnualCourseNote[]>;
  /** Notes rattachées à un AnnualCourse, tous enseignants confondus. */
  listNotesByAnnualCourse(annualCourseId: string): Promise<AnnualCourseNote[]>;
  findByOwnerLegacyNote(ownerTeacherId: string, legacyNoteId: string): Promise<AnnualCourseNote | null>;
  /**
   * Remplace les notes Carnet d'un propriétaire.
   * Ne touche pas les notes d'un autre enseignant ni les notes sans owner.
   * Conservé pour la transition annuelle ; le Carnet utilise `replaceNotebookNotesForAnnualCourse`.
   */
  replaceOwnedNotebookNotes(ownerTeacherId: string, notes: readonly AnnualCourseNote[]): Promise<void>;
  /**
   * Remplace atomiquement les notes Carnet d’un AnnualCourse.
   * Ne touche pas les autres cours ni les notes structurelles (sans session / legacy / owner).
   */
  replaceNotebookNotesForAnnualCourse(annualCourseId: string, notes: readonly AnnualCourseNote[]): Promise<void>;
}
