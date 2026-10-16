import type { CourseSession } from "../course-sessions/types.ts";
import {
  excerptRichDoc,
  isEmptyRichDoc,
  sanitizeRichDoc,
  type CampusRichDoc,
} from "./rich-doc.ts";
import type {
  ClassNotesDocument,
  ClassNotesDocumentV1,
  ClassNotesDocumentV2,
  TeacherWeekNote,
} from "./types.ts";

export const CLASS_NOTES_STORAGE_PREFIX = "campus-agenda-class-notes";

export function classNotesStorageKey(teacherId: string): string {
  return `${CLASS_NOTES_STORAGE_PREFIX}:${teacherId}`;
}

export function createEmptyNotesDocument(): ClassNotesDocument {
  return { version: 1, weeks: {} };
}

export function createEmptyNotesDocumentV2(): ClassNotesDocumentV2 {
  return { version: 2, sessions: {}, pendingWeeks: {} };
}

export function isNotesDocumentV1(document: ClassNotesDocument): document is ClassNotesDocumentV1 {
  return document.version === 1;
}

export function isNotesDocumentV2(document: ClassNotesDocument): document is ClassNotesDocumentV2 {
  return document.version === 2;
}

export function parseStoredNotes(raw: string | null): ClassNotesDocument | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ClassNotesDocument;
    if (parsed?.version === 1 && parsed.weeks && typeof parsed.weeks === "object") return parsed;
    if (parsed?.version === 2 && parsed.sessions && typeof parsed.sessions === "object") return parsed;
    return null;
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

function isNotesBodyShape(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { format?: unknown; blocks?: unknown };
  return candidate.format === "campus-rich-v1" && Array.isArray(candidate.blocks);
}

function isNoteShape(note: unknown): note is TeacherWeekNote {
  if (!note || typeof note !== "object") return false;
  const candidate = note as TeacherWeekNote;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.text === "string" &&
    (candidate.body === undefined || isNotesBodyShape(candidate.body))
  );
}

function cleanNotesList(notes: unknown): TeacherWeekNote[] {
  if (!Array.isArray(notes)) return [];
  return notes
    .filter((note) => note && typeof note === "object" && typeof (note as TeacherWeekNote).id === "string")
    .map((note) =>
      normalizeWeekNote({
        id: (note as TeacherWeekNote).id,
        text: typeof (note as TeacherWeekNote).text === "string" ? (note as TeacherWeekNote).text : "",
        body: (note as TeacherWeekNote).body,
      }),
    )
    .filter((note): note is TeacherWeekNote => note !== null);
}

function cleanNotesMap(source: Record<string, TeacherWeekNote[]> | undefined): Record<string, TeacherWeekNote[]> {
  const result: Record<string, TeacherWeekNote[]> = {};
  for (const [key, notes] of Object.entries(source ?? {})) {
    const cleaned = cleanNotesList(notes);
    if (cleaned.length) result[key] = cleaned;
  }
  return result;
}

/** Nettoie textes vides et garantit la forme version 1 ou 2. */
export function normalizeClassNotes(document: ClassNotesDocument): ClassNotesDocument {
  if (document.version === 2) {
    const sessions = cleanNotesMap(document.sessions);
    const pendingWeeks = cleanNotesMap(document.pendingWeeks);
    return {
      version: 2,
      sessions,
      ...(Object.keys(pendingWeeks).length ? { pendingWeeks } : {}),
    };
  }
  return { version: 1, weeks: cleanNotesMap(document.weeks) };
}

function notesArrayValid(notes: unknown): boolean {
  return Array.isArray(notes) && notes.every(isNoteShape);
}

/** Vérifie qu'un payload HTTP ressemble à un document de notes. */
export function isClassNotesPayload(value: unknown): value is ClassNotesDocument {
  if (!value || typeof value !== "object") return false;
  const candidate = value as ClassNotesDocument;
  if (candidate.version === 2) {
    if (!candidate.sessions || typeof candidate.sessions !== "object") return false;
    if (candidate.pendingWeeks && typeof candidate.pendingWeeks !== "object") return false;
    const sessionOk = Object.values(candidate.sessions).every(notesArrayValid);
    const pendingOk = !candidate.pendingWeeks || Object.values(candidate.pendingWeeks).every(notesArrayValid);
    return sessionOk && pendingOk;
  }
  if (candidate.version !== 1 || !candidate.weeks || typeof candidate.weeks !== "object") {
    return false;
  }
  return Object.values(candidate.weeks).every(notesArrayValid);
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

export function listWeekNotes(document: ClassNotesDocument, weekKey: string): TeacherWeekNote[] {
  if (document.version === 2) {
    return document.pendingWeeks?.[weekKey] ?? [];
  }
  return document.weeks[weekKey] ?? [];
}

export function listSessionNotes(document: ClassNotesDocument, sessionKey: string): TeacherWeekNote[] {
  if (document.version !== 2) return [];
  return document.sessions[sessionKey] ?? [];
}

export function listPendingWeekNotes(document: ClassNotesDocument, weekKey: string): TeacherWeekNote[] {
  if (document.version !== 2) return listWeekNotes(document, weekKey);
  return document.pendingWeeks?.[weekKey] ?? [];
}

function writeV1Weeks(
  document: ClassNotesDocumentV1,
  weekKey: string,
  notes: TeacherWeekNote[],
): ClassNotesDocumentV1 {
  const weeks = { ...document.weeks };
  if (!notes.length) delete weeks[weekKey];
  else weeks[weekKey] = notes;
  return { version: 1, weeks };
}

function writeV2Sessions(
  document: ClassNotesDocumentV2,
  sessionKey: string,
  notes: TeacherWeekNote[],
): ClassNotesDocumentV2 {
  const sessions = { ...document.sessions };
  if (!notes.length) delete sessions[sessionKey];
  else sessions[sessionKey] = notes;
  return { ...document, version: 2, sessions };
}

export function setWeekRichNote(
  document: ClassNotesDocument,
  weekKey: string,
  body: CampusRichDoc,
): ClassNotesDocument {
  const clean = sanitizeRichDoc(body);
  if (document.version === 2) {
    return setSessionRichNote(document, weekKey, clean);
  }
  if (isEmptyRichDoc(clean)) {
    return writeV1Weeks(document, weekKey, []);
  }
  const current = listWeekNotes(document, weekKey);
  const id = current[0]?.id ?? `note-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  return writeV1Weeks(document, weekKey, [{ id, text: excerptRichDoc(clean) || "Note", body: clean }]);
}

export function setSessionRichNote(
  document: ClassNotesDocument,
  sessionKey: string,
  body: CampusRichDoc,
): ClassNotesDocument {
  const key = sessionKey.trim();
  if (!key) return document;
  const asV2: ClassNotesDocumentV2 =
    document.version === 2 ? document : migrateClassNotesToSessions(document, [], "").document;
  const clean = sanitizeRichDoc(body);
  if (isEmptyRichDoc(clean)) {
    return writeV2Sessions(asV2, key, []);
  }
  const current = listSessionNotes(asV2, key);
  const id = current[0]?.id ?? `note-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  return writeV2Sessions(asV2, key, [{ id, text: excerptRichDoc(clean) || "Note", body: clean }]);
}

export function appendWeekNote(
  document: ClassNotesDocument,
  weekKey: string,
  text: string,
): ClassNotesDocument {
  const trimmed = text.trim();
  if (!trimmed) return document;
  const nextNote: TeacherWeekNote = {
    id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    text: trimmed,
  };
  if (document.version === 2) {
    const current = listSessionNotes(document, weekKey);
    return writeV2Sessions(document, weekKey, [...current, nextNote]);
  }
  const current = listWeekNotes(document, weekKey);
  return writeV1Weeks(document, weekKey, [...current, nextNote]);
}

export function removeWeekNote(
  document: ClassNotesDocument,
  weekKey: string,
  noteId: string,
): ClassNotesDocument {
  if (document.version === 2) {
    return writeV2Sessions(
      document,
      weekKey,
      listSessionNotes(document, weekKey).filter((note) => note.id !== noteId),
    );
  }
  return writeV1Weeks(
    document,
    weekKey,
    listWeekNotes(document, weekKey).filter((note) => note.id !== noteId),
  );
}

export function moveWeekNote(
  document: ClassNotesDocument,
  fromKey: string,
  toKey: string,
  noteId: string,
): ClassNotesDocument {
  if (document.version === 2) {
    const fromNotes = listSessionNotes(document, fromKey);
    const note = fromNotes.find((entry) => entry.id === noteId);
    if (!note) return document;
    const without = writeV2Sessions(
      document,
      fromKey,
      fromNotes.filter((entry) => entry.id !== noteId),
    );
    return writeV2Sessions(without, toKey, [...listSessionNotes(without, toKey), note]);
  }
  const fromNotes = listWeekNotes(document, fromKey);
  const note = fromNotes.find((entry) => entry.id === noteId);
  if (!note) return document;
  const without = removeWeekNote(document, fromKey, noteId);
  if (without.version !== 1) return without;
  const target = listWeekNotes(without, toKey);
  return writeV1Weeks(without, toKey, [...target, note]);
}

export function assignPendingWeekNotes(
  document: ClassNotesDocument,
  weekKey: string,
  sessionKey: string,
): ClassNotesDocument {
  const target = sessionKey.trim();
  if (!target) return document;
  const pending = listPendingWeekNotes(document, weekKey);
  if (!pending.length) return document;
  const asV2: ClassNotesDocumentV2 =
    document.version === 2 ? document : { version: 2, sessions: {}, pendingWeeks: { [weekKey]: pending } };
  const pendingWeeks = { ...(asV2.pendingWeeks ?? {}) };
  delete pendingWeeks[weekKey];
  const sessions = {
    ...asV2.sessions,
    [target]: [...(asV2.sessions[target] ?? []), ...pending],
  };
  return {
    version: 2,
    sessions,
    ...(Object.keys(pendingWeeks).length ? { pendingWeeks } : {}),
  };
}

export function notesDocumentsEquivalent(left: ClassNotesDocument, right: ClassNotesDocument): boolean {
  return serializeClassNotes(normalizeClassNotes(left)) === serializeClassNotes(normalizeClassNotes(right));
}

export function cloneClassNotesDocument(document: ClassNotesDocument): ClassNotesDocument {
  const normalized = normalizeClassNotes(document);
  if (normalized.version === 2) {
    return {
      version: 2,
      sessions: { ...normalized.sessions },
      ...(normalized.pendingWeeks ? { pendingWeeks: { ...normalized.pendingWeeks } } : {}),
    };
  }
  return { version: 1, weeks: { ...normalized.weeks } };
}

/** Clés historiques `${classSetupId}:${schoolWeekNumber}` (V1 weeks ou V2 pendingWeeks). */
export function weekKeyedNotesMap(document: ClassNotesDocument): Record<string, TeacherWeekNote[]> {
  if (document.version === 2) return { ...(document.pendingWeeks ?? {}) };
  return { ...document.weeks };
}

export function replaceWeekKeyedNotes(
  document: ClassNotesDocument,
  weeks: Record<string, TeacherWeekNote[]>,
): ClassNotesDocument {
  if (document.version === 2) {
    return {
      version: 2,
      sessions: document.sessions,
      ...(Object.keys(weeks).length ? { pendingWeeks: weeks } : {}),
    };
  }
  return { version: 1, weeks };
}

export function classNotesTouchClassroom(
  document: ClassNotesDocument,
  classroomIds: readonly string[],
): boolean {
  return Object.keys(weekKeyedNotesMap(document)).some((key) =>
    classroomIds.some((classroomId) => key.startsWith(`${classroomId}:`)),
  );
}

export function stripClassNotesForClassrooms(
  document: ClassNotesDocument,
  classroomIds: readonly string[],
): { document: ClassNotesDocument; changed: boolean } {
  const weeks = weekKeyedNotesMap(document);
  let changed = false;
  for (const key of Object.keys(weeks)) {
    if (classroomIds.some((classroomId) => key.startsWith(`${classroomId}:`))) {
      delete weeks[key];
      changed = true;
    }
  }
  if (!changed) return { document, changed: false };
  return { document: replaceWeekKeyedNotes(document, weeks), changed: true };
}

/**
 * Passe un document V1 vers V2 à partir des CourseSession d’un AnnualCourse.
 * Semaine à une séance → migration automatique.
 * Semaine à plusieurs séances → pendingWeeks (pas d’attribution silencieuse).
 */
export function migrateClassNotesToSessions(
  document: ClassNotesDocument,
  sessions: readonly CourseSession[],
  classSetupId: string,
): { document: ClassNotesDocumentV2; changed: boolean } {
  if (document.version === 2) {
    return { document: normalizeClassNotes(document) as ClassNotesDocumentV2, changed: false };
  }
  const sessionsBag: Record<string, TeacherWeekNote[]> = {};
  const pendingWeeks: Record<string, TeacherWeekNote[]> = {};
  const prefix = `${classSetupId}:`;
  for (const [weekKey, notes] of Object.entries(document.weeks ?? {})) {
    const cleaned = cleanNotesList(notes);
    if (!cleaned.length) continue;
    if (!weekKey.startsWith(prefix)) {
      pendingWeeks[weekKey] = cleaned;
      continue;
    }
    const weekNumber = Number(weekKey.slice(prefix.length));
    const weekSessions = sessions.filter((session) => session.schoolWeekNumber === weekNumber);
    if (weekSessions.length === 1) {
      const key = weekSessions[0]!.key;
      sessionsBag[key] = [...(sessionsBag[key] ?? []), ...cleaned];
    } else {
      pendingWeeks[weekKey] = cleaned;
    }
  }
  const next: ClassNotesDocumentV2 = {
    version: 2,
    sessions: sessionsBag,
    ...(Object.keys(pendingWeeks).length ? { pendingWeeks } : {}),
  };
  return { document: next, changed: true };
}
