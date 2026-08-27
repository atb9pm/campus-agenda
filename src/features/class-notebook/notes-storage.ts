import type { ClassNotesDocument, TeacherWeekNote } from "./types.ts";

export const CLASS_NOTES_STORAGE_PREFIX = "campus-agenda-class-notes";

export function classNotesStorageKey(teacherId: string): string {
  return `${CLASS_NOTES_STORAGE_PREFIX}:${teacherId}`;
}

export function createEmptyNotesDocument(): ClassNotesDocument {
  return { version: 1, weeks: {} };
}

export function parseStoredNotes(raw: string | null): ClassNotesDocument | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ClassNotesDocument;
    if (parsed?.version !== 1 || typeof parsed.weeks !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function loadNotesFromBrowser(teacherId: string): ClassNotesDocument {
  if (typeof window === "undefined") return createEmptyNotesDocument();
  try {
    return parseStoredNotes(localStorage.getItem(classNotesStorageKey(teacherId))) ?? createEmptyNotesDocument();
  } catch {
    return createEmptyNotesDocument();
  }
}

export function saveNotesToBrowser(teacherId: string, document: ClassNotesDocument): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(classNotesStorageKey(teacherId), JSON.stringify(document));
  } catch {
    // localStorage indisponible
  }
}

export function listWeekNotes(
  document: ClassNotesDocument,
  weekKey: string,
): TeacherWeekNote[] {
  return document.weeks[weekKey] ?? [];
}

export function appendWeekNote(
  document: ClassNotesDocument,
  weekKey: string,
  text: string,
): ClassNotesDocument {
  const trimmed = text.trim();
  if (!trimmed) return document;
  const current = listWeekNotes(document, weekKey);
  const nextNote: TeacherWeekNote = {
    id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    text: trimmed,
  };
  return {
    ...document,
    weeks: {
      ...document.weeks,
      [weekKey]: [...current, nextNote],
    },
  };
}

export function removeWeekNote(
  document: ClassNotesDocument,
  weekKey: string,
  noteId: string,
): ClassNotesDocument {
  const current = listWeekNotes(document, weekKey);
  return {
    ...document,
    weeks: {
      ...document.weeks,
      [weekKey]: current.filter((note) => note.id !== noteId),
    },
  };
}

export function moveWeekNote(
  document: ClassNotesDocument,
  fromKey: string,
  toKey: string,
  noteId: string,
): ClassNotesDocument {
  const fromNotes = listWeekNotes(document, fromKey);
  const note = fromNotes.find((entry) => entry.id === noteId);
  if (!note) return document;

  const without = removeWeekNote(document, fromKey, noteId);
  const target = listWeekNotes(without, toKey);
  return {
    ...without,
    weeks: {
      ...without.weeks,
      [toKey]: [...target, note],
    },
  };
}
