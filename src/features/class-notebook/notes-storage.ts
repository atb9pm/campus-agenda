import {
  excerptRichDoc,
  isEmptyRichDoc,
  sanitizeRichDoc,
  type CampusRichDoc,
} from "./rich-doc.ts";
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

/** Efface la copie locale après migration réussie vers le serveur. */
export function clearNotesFromBrowser(teacherId: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(classNotesStorageKey(teacherId));
  } catch {
    // localStorage indisponible
  }
}

/**
 * Charge la copie locale uniquement si une entrée existe.
 * Distingue « jamais enregistré » d'un document vide déjà créé.
 */
export function peekNotesFromBrowser(teacherId: string): ClassNotesDocument | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(classNotesStorageKey(teacherId));
    if (raw === null) return null;
    return parseStoredNotes(raw) ?? createEmptyNotesDocument();
  } catch {
    return null;
  }
}

export function serializeClassNotes(document: ClassNotesDocument): string {
  return JSON.stringify(document);
}

/** Nettoie textes vides et garantit la forme version 1. */
export function normalizeClassNotes(document: ClassNotesDocument): ClassNotesDocument {
  const weeks: ClassNotesDocument["weeks"] = {};
  for (const [weekKey, notes] of Object.entries(document.weeks ?? {})) {
    if (!Array.isArray(notes)) continue;
    const cleaned = notes
      .filter((note) => note && typeof note === "object" && typeof note.id === "string")
      .map((note) =>
        normalizeWeekNote({
          id: note.id,
          text: typeof note.text === "string" ? note.text : "",
          body: note.body,
        }),
      )
      .filter((note): note is TeacherWeekNote => note !== null);
    if (cleaned.length) weeks[weekKey] = cleaned;
  }
  return { version: 1, weeks };
}

/** Vérifie qu'un payload HTTP ressemble à un document de notes. */
export function isClassNotesPayload(value: unknown): value is ClassNotesDocument {
  if (!value || typeof value !== "object") return false;
  const candidate = value as ClassNotesDocument;
  if (candidate.version !== 1 || !candidate.weeks || typeof candidate.weeks !== "object") {
    return false;
  }
  return Object.values(candidate.weeks).every(
    (notes) =>
      Array.isArray(notes) &&
      notes.every(
        (note) =>
          note &&
          typeof note === "object" &&
          typeof note.id === "string" &&
          typeof note.text === "string" &&
          (note.body === undefined || isNotesBodyShape(note.body)),
      ),
  );
}

function isNotesBodyShape(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { format?: unknown; blocks?: unknown };
  return candidate.format === "campus-rich-v1" && Array.isArray(candidate.blocks);
}

function normalizeWeekNote(note: TeacherWeekNote): TeacherWeekNote | null {
  const body = note.body ? sanitizeRichDoc(note.body) : undefined;
  const text = note.text.trim() || (body ? excerptRichDoc(body) : "");
  if (!text && (!body || isEmptyRichDoc(body))) return null;
  return body && !isEmptyRichDoc(body) ? { id: note.id, text, body } : { id: note.id, text };
}

export function composeWeekNotesDoc(notes: readonly TeacherWeekNote[]): CampusRichDoc {
  const withBody = notes.find((note) => note.body && !isEmptyRichDoc(note.body));
  if (withBody?.body) {
    return sanitizeRichDoc(withBody.body);
  }
  return sanitizeRichDoc({
    format: "campus-rich-v1",
    blocks: notes
      .filter((note) => note.text.trim())
      .map((note) => ({ type: "paragraph" as const, inlines: [{ text: note.text.trim() }] })),
  });
}

export function setWeekRichNote(
  document: ClassNotesDocument,
  weekKey: string,
  body: CampusRichDoc,
): ClassNotesDocument {
  const clean = sanitizeRichDoc(body);
  if (isEmptyRichDoc(clean)) {
    const weeks = { ...document.weeks };
    delete weeks[weekKey];
    return { version: 1, weeks };
  }
  const current = listWeekNotes(document, weekKey);
  const id = current[0]?.id ?? `note-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  return {
    version: 1,
    weeks: {
      ...document.weeks,
      [weekKey]: [{ id, text: excerptRichDoc(clean) || "Note", body: clean }],
    },
  };
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
