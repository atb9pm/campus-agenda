import type { CampusRichDoc, RichBlock } from "./rich-doc.ts";

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
  kind: "publication" | "note" | "line";
  sourceWeekNumber: number;
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
