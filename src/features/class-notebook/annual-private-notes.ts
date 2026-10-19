/**
 * Convergence Carnet PR3.4 : teacher_notes (legacy) → annual_course_notes (résolu).
 *
 * Source de vérité :
 * - notes V2 rattachées à un CourseSession.key dont l'AnnualCourse existe
 *   → annual_course_notes (ownerTeacherId = enseignant de la session)
 * - V1, pendingWeeks, orphanedSessions, clés invalides, cours manquant
 *   → restent dans teacher_notes
 *
 * Une seule écriture applicative par sauvegarde : le document HTTP est découpé.
 * Pas de double source de vérité pour une note résolue.
 * referenceSessionId n'est jamais inventé.
 */

import { randomUUID } from "node:crypto";

import type { AnnualCourse } from "../annual-courses/types.ts";
import { parseCourseSessionKey } from "../course-sessions/compute.ts";
import {
  createAnnualCourseNote,
  type AnnualCourseNote,
} from "../pedagogical-path/annual-notes.ts";
import type { AnnualCourseStore } from "../../lib/persistence/annual-course-types.ts";
import type { AnnualCourseNotesStore } from "../../lib/persistence/pedagogical-path-types.ts";
import type { TeacherNotesStore } from "../../lib/persistence/teacher-notes-types.ts";
import {
  createEmptyNotesDocument,
  createEmptyNotesDocumentV2,
  isNotesDocumentV1,
  isNotesDocumentV2,
  normalizeClassNotes,
  notesDocumentsEquivalent,
} from "./notes-storage.ts";
import { excerptRichDoc, isEmptyRichDoc, sanitizeRichDoc } from "./rich-doc.ts";
import type { ClassNotesDocument, ClassNotesDocumentV2, TeacherWeekNote } from "./types.ts";

export interface TeacherNotebookNotesDeps {
  teacherNotes: TeacherNotesStore;
  courseNotes: AnnualCourseNotesStore;
  courses: AnnualCourseStore;
}

function weekNoteFromAnnual(note: AnnualCourseNote): TeacherWeekNote {
  const id = note.legacyNoteId?.trim() || note.id;
  if (note.body && !isEmptyRichDoc(note.body)) {
    return { id, text: note.text, body: note.body };
  }
  return { id, text: note.text };
}

function noteTextAndBody(note: TeacherWeekNote): { text: string; body: ReturnType<typeof sanitizeRichDoc> | null } {
  const body = note.body ? sanitizeRichDoc(note.body) : null;
  const text = note.text.trim() || (body ? excerptRichDoc(body) : "");
  return { text, body: body && !isEmptyRichDoc(body) ? body : null };
}

export function annualNotesToSessionMap(notes: readonly AnnualCourseNote[]): Record<string, TeacherWeekNote[]> {
  const sessions: Record<string, TeacherWeekNote[]> = {};
  const sorted = [...notes].sort(
    (left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
  );
  for (const note of sorted) {
    const key = note.courseSessionKey?.trim();
    if (!key) continue;
    sessions[key] = [...(sessions[key] ?? []), weekNoteFromAnnual(note)];
  }
  return sessions;
}

export function composeTeacherNotebookDocument(
  leftover: ClassNotesDocument | null,
  owned: readonly AnnualCourseNote[],
): ClassNotesDocument | null {
  if (!leftover && owned.length === 0) return null;
  const sessionNotes = annualNotesToSessionMap(owned);
  if (!leftover) {
    return { version: 2, sessions: sessionNotes };
  }
  if (isNotesDocumentV1(leftover)) {
    if (!owned.length) return leftover;
    return {
      version: 2,
      sessions: sessionNotes,
      ...(Object.keys(leftover.weeks).length ? { pendingWeeks: leftover.weeks } : {}),
    };
  }
  const sessions = { ...leftover.sessions };
  for (const [key, notes] of Object.entries(sessionNotes)) {
    sessions[key] = [...(sessions[key] ?? []), ...notes];
  }
  return {
    version: 2,
    sessions,
    ...(leftover.pendingWeeks && Object.keys(leftover.pendingWeeks).length
      ? { pendingWeeks: leftover.pendingWeeks }
      : {}),
    ...(leftover.orphanedSessions && Object.keys(leftover.orphanedSessions).length
      ? { orphanedSessions: leftover.orphanedSessions }
      : {}),
  };
}

export async function splitResolvableNotebookNotes(
  teacherId: string,
  document: ClassNotesDocument,
  courses: AnnualCourseStore,
): Promise<{ leftover: ClassNotesDocument; resolved: AnnualCourseNote[] }> {
  const normalized = normalizeClassNotes(document);
  if (isNotesDocumentV1(normalized)) {
    return { leftover: normalized, resolved: [] };
  }

  const leftoverSessions: Record<string, TeacherWeekNote[]> = {};
  const resolved: AnnualCourseNote[] = [];
  const courseCache = new Map<string, AnnualCourse | null>();

  async function courseFor(id: string): Promise<AnnualCourse | null> {
    if (!courseCache.has(id)) {
      courseCache.set(id, await courses.getCourse(id));
    }
    return courseCache.get(id) ?? null;
  }

  for (const [sessionKey, notes] of Object.entries(normalized.sessions)) {
    const parsed = parseCourseSessionKey(sessionKey);
    if (!parsed) {
      leftoverSessions[sessionKey] = notes;
      continue;
    }
    const course = await courseFor(parsed.annualCourseId);
    if (!course || course.schoolYearId !== parsed.schoolYearId) {
      leftoverSessions[sessionKey] = notes;
      continue;
    }
    for (const note of notes) {
      const { text, body } = noteTextAndBody(note);
      if (!text && !body) continue;
      const created = createAnnualCourseNote(`acn-${randomUUID()}`, {
        schoolYearId: course.schoolYearId,
        classId: course.classId,
        contextId: course.contextId,
        referenceSessionId: null,
        authorTeacherId: teacherId,
        ownerTeacherId: teacherId,
        text: text || "Note",
        body,
        courseSessionKey: sessionKey,
        legacyNoteId: note.id,
        annualCourseId: course.id,
      });
      if (!created.ok) {
        leftoverSessions[sessionKey] = [...(leftoverSessions[sessionKey] ?? []), note];
        continue;
      }
      resolved.push(created.value);
    }
  }

  const leftover: ClassNotesDocumentV2 = {
    version: 2,
    sessions: leftoverSessions,
    ...(normalized.pendingWeeks && Object.keys(normalized.pendingWeeks).length
      ? { pendingWeeks: normalized.pendingWeeks }
      : {}),
    ...(normalized.orphanedSessions && Object.keys(normalized.orphanedSessions).length
      ? { orphanedSessions: normalized.orphanedSessions }
      : {}),
  };
  return { leftover, resolved };
}

function leftoverIsEmpty(document: ClassNotesDocument): boolean {
  if (isNotesDocumentV1(document)) return Object.keys(document.weeks).length === 0;
  return (
    Object.keys(document.sessions).length === 0 &&
    Object.keys(document.pendingWeeks ?? {}).length === 0 &&
    Object.keys(document.orphanedSessions ?? {}).length === 0
  );
}

export async function persistTeacherNotebookDocument(
  teacherId: string,
  document: ClassNotesDocument,
  deps: TeacherNotebookNotesDeps,
): Promise<ClassNotesDocument> {
  const { leftover, resolved } = await splitResolvableNotebookNotes(teacherId, document, deps.courses);
  const isV2 = isNotesDocumentV2(normalizeClassNotes(document));
  if (isV2) {
    await deps.courseNotes.replaceOwnedNotebookNotes(teacherId, resolved);
  }
  const leftoverToStore = leftoverIsEmpty(leftover) && isV2 ? createEmptyNotesDocumentV2() : leftover;
  const savedLeftover = await deps.teacherNotes.saveNotes(teacherId, leftoverToStore);
  const owned = await deps.courseNotes.listNotesByOwner(teacherId);
  return composeTeacherNotebookDocument(savedLeftover, owned) ?? createEmptyNotesDocument();
}

export async function loadTeacherNotebookDocument(
  teacherId: string,
  deps: TeacherNotebookNotesDeps,
): Promise<ClassNotesDocument | null> {
  const stored = await deps.teacherNotes.getNotes(teacherId);
  if (stored && isNotesDocumentV2(stored)) {
    const { leftover, resolved } = await splitResolvableNotebookNotes(teacherId, stored, deps.courses);
    if (resolved.length) {
      const current = await deps.courseNotes.listNotesByOwner(teacherId);
      const byLegacy = new Map(
        current
          .filter((note) => note.legacyNoteId)
          .map((note) => [note.legacyNoteId as string, note]),
      );
      const merged = [...current];
      for (const note of resolved) {
        if (!note.legacyNoteId || byLegacy.has(note.legacyNoteId)) continue;
        merged.push(note);
      }
      await deps.courseNotes.replaceOwnedNotebookNotes(teacherId, merged);
      if (!notesDocumentsEquivalent(stored, leftover)) {
        await deps.teacherNotes.saveNotes(teacherId, leftover);
      }
    }
  }
  const leftover = await deps.teacherNotes.getNotes(teacherId);
  const owned = await deps.courseNotes.listNotesByOwner(teacherId);
  return composeTeacherNotebookDocument(leftover, owned);
}
