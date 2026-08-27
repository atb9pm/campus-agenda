export interface TeacherWeekNote {
  id: string;
  text: string;
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
