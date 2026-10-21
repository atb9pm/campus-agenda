import type { AnnualCourseNote } from "../../features/pedagogical-path/annual-notes.ts";

/** Fail before mutating either store. Ambiguous legacy notes stay in the JSON upstream. */
export function validateOwnedNotes(owner: string, notes: readonly AnnualCourseNote[]): void {
  const ids = new Set<string>();
  const legacyIds = new Set<string>();
  for (const note of notes) {
    if (note.ownerTeacherId !== owner || ids.has(note.id)) throw new Error("Invalid notebook ownership or identity");
    ids.add(note.id);
    if (note.legacyNoteId !== null) {
      if (!note.legacyNoteId.trim() || legacyIds.has(note.legacyNoteId)) throw new Error("Ambiguous notebook identity");
      legacyIds.add(note.legacyNoteId);
    }
  }
}

/** Content edits cannot reset provenance supplied only by the server. */
export function preserveNotebookMetadata(note: AnnualCourseNote, current?: AnnualCourseNote): AnnualCourseNote {
  if (!current) return note;
  return {
    ...note,
    id: current.id,
    createdAt: current.createdAt,
    authorTeacherId: current.authorTeacherId,
    sourceNoteId: current.sourceNoteId,
    sourceSchoolYearId: current.sourceSchoolYearId,
    inheritedAt: current.inheritedAt,
    referenceSessionId: current.referenceSessionId,
  };
}
