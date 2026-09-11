import type { CampusRichDoc } from "./rich-doc.ts";

export interface TeacherWeekNote {
  id: string;
  text: string;
  /** Document riche optionnel. Absent = texte brut historique. */
  body?: CampusRichDoc;
}

export interface ClassNotesDocument {
  version: 1;
  /** Clé `${classSetupId}:${schoolWeekNumber}` */
  weeks: Record<string, TeacherWeekNote[]>;
}

export interface NotebookClipboard {
  kind: "publication" | "note";
  sourceWeekNumber: number;
  publicationId?: number;
  noteId?: string;
  noteText?: string;
  mode: "cut" | "copy";
}
