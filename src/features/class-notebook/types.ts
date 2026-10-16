import type { CampusRichDoc, RichBlock } from "./rich-doc.ts";

export interface TeacherWeekNote {
  id: string;
  text: string;
  /** Document riche optionnel. Absent = texte brut historique. */
  body?: CampusRichDoc;
}

export interface ClassNotesDocumentV1 {
  version: 1;
  /** Clé `${classSetupId}:${schoolWeekNumber}` */
  weeks: Record<string, TeacherWeekNote[]>;
}

export interface ClassNotesDocumentV2 {
  version: 2;
  /** Clé = `CourseSession.key` (`schoolYearId|annualCourseId|date`). */
  sessions: Record<string, TeacherWeekNote[]>;
  /**
   * Notes V1 d’une semaine à plusieurs séances : à attribuer manuellement.
   * Clé historique `${classSetupId}:${schoolWeekNumber}`.
   */
  pendingWeeks?: Record<string, TeacherWeekNote[]>;
  /**
   * Notes d’une CourseSession.key qui n’existe plus dans l’horaire actuel.
   * Jamais supprimées silencieusement ; à réattribuer.
   */
  orphanedSessions?: Record<string, TeacherWeekNote[]>;
}

export type ClassNotesDocument = ClassNotesDocumentV1 | ClassNotesDocumentV2;

export interface NotebookClipboard {
  kind: "publication" | "note" | "line";
  sourceWeekNumber: number;
  sourceSessionKey?: string;
  sourceCardId?: string;
  publicationId?: number;
  noteId?: string;
  noteText?: string;
  mode: "cut" | "copy";
  lineSource?: "publication" | "notes";
  blockIndex?: number;
  itemIndex?: number | null;
  /** Contenu de la ligne, pour couper/coller même après suppression. */
  block?: RichBlock;
}
