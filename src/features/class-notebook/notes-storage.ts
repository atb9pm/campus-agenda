import { parseCourseSessionKey } from "../course-sessions/compute.ts";
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

function finishV2(
  sessions: Record<string, TeacherWeekNote[]>,
  pendingWeeks?: Record<string, TeacherWeekNote[]>,
  orphanedSessions?: Record<string, TeacherWeekNote[]>,
): ClassNotesDocumentV2 {
  const nextSessions = cleanNotesMap(sessions);
  const nextPending = cleanNotesMap(pendingWeeks);
  const nextOrphaned = cleanNotesMap(orphanedSessions);
  return {
    version: 2,
    sessions: nextSessions,
    ...(Object.keys(nextPending).length ? { pendingWeeks: nextPending } : {}),
    ...(Object.keys(nextOrphaned).length ? { orphanedSessions: nextOrphaned } : {}),
  };
}

/** Nettoie textes vides et garantit la forme version 1 ou 2. */
export function normalizeClassNotes(document: ClassNotesDocument): ClassNotesDocument {
  if (document.version === 2) {
    return finishV2(document.sessions, document.pendingWeeks, document.orphanedSessions);
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
    if (candidate.orphanedSessions && typeof candidate.orphanedSessions !== "object") return false;
    const sessionOk = Object.values(candidate.sessions).every(notesArrayValid);
    const pendingOk = !candidate.pendingWeeks || Object.values(candidate.pendingWeeks).every(notesArrayValid);
    const orphanedOk =
      !candidate.orphanedSessions || Object.values(candidate.orphanedSessions).every(notesArrayValid);
    return sessionOk && pendingOk && orphanedOk;
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
  if (document.version !== 2) return [];
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
  return finishV2(sessions, document.pendingWeeks, document.orphanedSessions);
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
  return finishV2(sessions, pendingWeeks, asV2.orphanedSessions);
}

export function listOrphanedSessionNotes(
  document: ClassNotesDocument,
  sessionKey?: string,
): TeacherWeekNote[] {
  if (document.version !== 2) return [];
  if (sessionKey) return document.orphanedSessions?.[sessionKey] ?? [];
  return Object.values(document.orphanedSessions ?? {}).flat();
}

export function orphanedSessionNotesForCourse(
  document: ClassNotesDocument,
  annualCourseId: string,
): Array<{ sessionKey: string; notes: TeacherWeekNote[] }> {
  if (document.version !== 2 || !annualCourseId.trim()) return [];
  const wanted = annualCourseId.trim();
  const rows: Array<{ sessionKey: string; notes: TeacherWeekNote[] }> = [];
  for (const [sessionKey, notes] of Object.entries(document.orphanedSessions ?? {})) {
    const parsed = parseCourseSessionKey(sessionKey);
    if (parsed?.annualCourseId !== wanted && !sessionKey.includes(`|${wanted}|`)) continue;
    if (notes.length) rows.push({ sessionKey, notes });
  }
  return rows;
}

export function assignOrphanedSessionNotes(
  document: ClassNotesDocument,
  orphanedKey: string,
  sessionKey: string,
): ClassNotesDocument {
  if (document.version !== 2) return document;
  const target = sessionKey.trim();
  const source = orphanedKey.trim();
  if (!target || !source) return document;
  const orphaned = document.orphanedSessions?.[source] ?? [];
  if (!orphaned.length) return document;
  const orphanedSessions = { ...(document.orphanedSessions ?? {}) };
  delete orphanedSessions[source];
  const sessions = {
    ...document.sessions,
    [target]: [...(document.sessions[target] ?? []), ...orphaned],
  };
  return finishV2(sessions, document.pendingWeeks, orphanedSessions);
}

export function pendingWeekNotesWithoutSession(
  document: ClassNotesDocument,
  classSetupId: string,
  sessions: readonly CourseSession[],
): Array<{ weekKey: string; weekNumber: number; notes: TeacherWeekNote[] }> {
  const prefix = `${classSetupId}:`;
  const weekNumbers = new Set(sessions.map((session) => session.schoolWeekNumber));
  const rows: Array<{ weekKey: string; weekNumber: number; notes: TeacherWeekNote[] }> = [];
  for (const [weekKey, notes] of Object.entries(weekKeyedNotesMap(document))) {
    if (!weekKey.startsWith(prefix) || !notes.length) continue;
    const weekNumber = Number(weekKey.slice(prefix.length));
    if (weekNumbers.has(weekNumber)) continue;
    rows.push({ weekKey, weekNumber, notes });
  }
  return rows;
}

export function notesDocumentsEquivalent(left: ClassNotesDocument, right: ClassNotesDocument): boolean {
  return serializeClassNotes(normalizeClassNotes(left)) === serializeClassNotes(normalizeClassNotes(right));
}

export function cloneClassNotesDocument(document: ClassNotesDocument): ClassNotesDocument {
  const normalized = normalizeClassNotes(document);
  if (normalized.version === 2) {
    return finishV2(
      { ...normalized.sessions },
      normalized.pendingWeeks ? { ...normalized.pendingWeeks } : undefined,
      normalized.orphanedSessions ? { ...normalized.orphanedSessions } : undefined,
    );
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
    return finishV2(document.sessions, weeks, document.orphanedSessions);
  }
  return { version: 1, weeks };
}

export interface ClassNotesCatalogScope {
  classroomIds?: readonly string[];
  annualCourseIds?: readonly string[];
}

function sessionKeyMatchesAnnualCourse(sessionKey: string, annualCourseIds: readonly string[]): boolean {
  const parsed = parseCourseSessionKey(sessionKey);
  if (parsed) return annualCourseIds.includes(parsed.annualCourseId);
  return annualCourseIds.some((annualCourseId) => sessionKey.includes(`|${annualCourseId}|`));
}

export function classNotesTouchCatalog(
  document: ClassNotesDocument,
  scope: ClassNotesCatalogScope,
): boolean {
  const classroomIds = scope.classroomIds ?? [];
  const annualCourseIds = scope.annualCourseIds ?? [];
  if (
    classroomIds.length &&
    Object.keys(weekKeyedNotesMap(document)).some((key) =>
      classroomIds.some((classroomId) => key.startsWith(`${classroomId}:`)),
    )
  ) {
    return true;
  }
  if (!annualCourseIds.length || document.version !== 2) return false;
  return (
    Object.keys(document.sessions).some((key) => sessionKeyMatchesAnnualCourse(key, annualCourseIds)) ||
    Object.keys(document.orphanedSessions ?? {}).some((key) => sessionKeyMatchesAnnualCourse(key, annualCourseIds))
  );
}

export function classNotesTouchClassroom(
  document: ClassNotesDocument,
  classroomIds: readonly string[],
): boolean {
  return classNotesTouchCatalog(document, { classroomIds });
}

export function stripClassNotesForCatalog(
  document: ClassNotesDocument,
  scope: ClassNotesCatalogScope,
): { document: ClassNotesDocument; changed: boolean } {
  const classroomIds = scope.classroomIds ?? [];
  const annualCourseIds = scope.annualCourseIds ?? [];
  let changed = false;
  const weeks = weekKeyedNotesMap(document);
  for (const key of Object.keys(weeks)) {
    if (classroomIds.some((classroomId) => key.startsWith(`${classroomId}:`))) {
      delete weeks[key];
      changed = true;
    }
  }
  if (document.version !== 2) {
    if (!changed) return { document, changed: false };
    return { document: { version: 1, weeks }, changed: true };
  }
  const sessions = { ...document.sessions };
  const orphanedSessions = { ...(document.orphanedSessions ?? {}) };
  for (const key of Object.keys(sessions)) {
    if (sessionKeyMatchesAnnualCourse(key, annualCourseIds)) {
      delete sessions[key];
      changed = true;
    }
  }
  for (const key of Object.keys(orphanedSessions)) {
    if (sessionKeyMatchesAnnualCourse(key, annualCourseIds)) {
      delete orphanedSessions[key];
      changed = true;
    }
  }
  if (!changed) return { document, changed: false };
  return { document: finishV2(sessions, weeks, orphanedSessions), changed: true };
}

export function stripClassNotesForClassrooms(
  document: ClassNotesDocument,
  classroomIds: readonly string[],
): { document: ClassNotesDocument; changed: boolean } {
  return stripClassNotesForCatalog(document, { classroomIds });
}

export interface MigrateClassNotesToSessionsOptions {
  /** AnnualCourse actuellement ouvert. Requis pour orpheliner les clés disparues, même si `sessions` est vide. */
  annualCourseId?: string;
  /**
   * AnnualCourse actifs de la classe.
   * Une note V1 `${classSetupId}:${week}` n’est auto-attribuée que si cette liste
   * contient exactement un cours (appartenance non ambiguë).
   */
  classAnnualCourseIds?: readonly string[];
}

function uniqueCourseIds(ids: readonly string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
}

/**
 * Identifiants AnnualCourse de la classe (cours attribués + sujets runtime + cours ouvert).
 * Une note V1 n’est auto-attribuée que si cette liste contient exactement un cours.
 */
export function collectClassAnnualCourseIds(
  teacherAnnualCourseIds: readonly string[] = [],
  subjectAnnualCourseIds: readonly (string | null | undefined)[] = [],
  openedAnnualCourseId?: string | null,
): string[] {
  return uniqueCourseIds([
    openedAnnualCourseId ?? "",
    ...teacherAnnualCourseIds,
    ...subjectAnnualCourseIds.map((id) => id ?? ""),
  ]);
}

/** V1 / pending : auto seulement si la classe n’a qu’un AnnualCourse (jamais déduit du seul cours ouvert). */
export function classNotesWeekCanAutoBind(classAnnualCourseIds: readonly string[] | undefined): boolean {
  return uniqueCourseIds(classAnnualCourseIds ?? []).length === 1;
}

function placeWeekNotes(
  sessionsBag: Record<string, TeacherWeekNote[]>,
  pendingWeeks: Record<string, TeacherWeekNote[]>,
  weekKey: string,
  notes: TeacherWeekNote[],
  sessions: readonly CourseSession[],
  classPrefix: string,
  allowAutoAssign: boolean,
): boolean {
  if (!weekKey.startsWith(classPrefix)) {
    pendingWeeks[weekKey] = [...(pendingWeeks[weekKey] ?? []), ...notes];
    return false;
  }
  const weekNumber = Number(weekKey.slice(classPrefix.length));
  const weekSessions = sessions.filter((session) => session.schoolWeekNumber === weekNumber);
  if (allowAutoAssign && weekSessions.length === 1) {
    const key = weekSessions[0]!.key;
    sessionsBag[key] = [...(sessionsBag[key] ?? []), ...notes];
    return true;
  }
  pendingWeeks[weekKey] = [...(pendingWeeks[weekKey] ?? []), ...notes];
  return false;
}

/**
 * Migration incrémentale vers V2, scoped au classSetupId et à l’AnnualCourse ouverts.
 * V1 / pendingWeeks : auto-attribution seulement si la classe n’a qu’un cours
 * et la semaine une seule CourseSession.
 * Clés `sessions` du cours ouvert absentes de l’horaire actuel (y compris 0 séance)
 * → orphanedSessions. Jamais de suppression silencieuse.
 */
export function migrateClassNotesToSessions(
  document: ClassNotesDocument,
  sessions: readonly CourseSession[],
  classSetupId: string,
  options: string | MigrateClassNotesToSessionsOptions = "",
): { document: ClassNotesDocumentV2; changed: boolean } {
  const opts: MigrateClassNotesToSessionsOptions =
    typeof options === "string" ? { annualCourseId: options } : options;
  const openedCourseId = opts.annualCourseId?.trim() || "";
  const allowAutoAssign = classNotesWeekCanAutoBind(opts.classAnnualCourseIds);
  const prefix = `${classSetupId}:`;
  const currentKeys = new Set(sessions.map((session) => session.key));
  let changed = false;
  const sessionsBag: Record<string, TeacherWeekNote[]> = {};
  const pendingWeeks: Record<string, TeacherWeekNote[]> = {};
  const orphanedSessions: Record<string, TeacherWeekNote[]> = {};

  if (document.version === 1) {
    changed = true;
    for (const [weekKey, notes] of Object.entries(document.weeks ?? {})) {
      const cleaned = cleanNotesList(notes);
      if (!cleaned.length) continue;
      placeWeekNotes(sessionsBag, pendingWeeks, weekKey, cleaned, sessions, prefix, allowAutoAssign);
    }
  } else {
    Object.assign(sessionsBag, document.sessions);
    Object.assign(pendingWeeks, document.pendingWeeks ?? {});
    Object.assign(orphanedSessions, document.orphanedSessions ?? {});
    if (allowAutoAssign) {
      for (const weekKey of Object.keys(pendingWeeks)) {
        if (!weekKey.startsWith(prefix)) continue;
        const notes = cleanNotesList(pendingWeeks[weekKey]);
        if (!notes.length) {
          delete pendingWeeks[weekKey];
          changed = true;
          continue;
        }
        const weekNumber = Number(weekKey.slice(prefix.length));
        const weekSessions = sessions.filter((session) => session.schoolWeekNumber === weekNumber);
        if (weekSessions.length !== 1) continue;
        delete pendingWeeks[weekKey];
        const key = weekSessions[0]!.key;
        sessionsBag[key] = [...(sessionsBag[key] ?? []), ...notes];
        changed = true;
      }
    }
  }

  if (openedCourseId) {
    for (const sessionKey of Object.keys(sessionsBag)) {
      const notes = sessionsBag[sessionKey] ?? [];
      const parsed = parseCourseSessionKey(sessionKey);
      const courseId = parsed?.annualCourseId;
      if (courseId !== openedCourseId && !sessionKey.includes(`|${openedCourseId}|`)) continue;
      if (currentKeys.has(sessionKey)) continue;
      delete sessionsBag[sessionKey];
      orphanedSessions[sessionKey] = [...(orphanedSessions[sessionKey] ?? []), ...notes];
      changed = true;
    }
  }

  const next = finishV2(sessionsBag, pendingWeeks, orphanedSessions);
  if (!changed) {
    return { document: next, changed: false };
  }
  return { document: next, changed: true };
}
