/**
 * Convergence Carnet : teacher_notes (legacy) → annual_course_notes (résolu).
 *
 * Appartenance fonctionnelle : AnnualCourse, pas l'enseignant.
 * `ownerTeacherId` reste une provenance legacy ; l'accès suit l'attribution au cours.
 *
 * Source de vérité :
 * - notes V2 rattachées à un CourseSession.key dont l'AnnualCourse existe
 *   et que l'enseignant peut consulter → annual_course_notes
 * - V1, pendingWeeks, orphanedSessions, clés invalides, cours manquant / non autorisé
 *   → restent dans teacher_notes
 *
 * Une seule écriture applicative par sauvegarde : le document HTTP est découpé.
 * Le replace est scoped par AnnualCourse.
 * referenceSessionId n'est jamais inventé.
 */

import { createHash, randomUUID } from "node:crypto";

import { isAssignmentActiveAt } from "../annual-courses/assignments.ts";
import type { AnnualCourse } from "../annual-courses/types.ts";
import { parseCourseSessionKey } from "../course-sessions/compute.ts";
import {
  createAnnualCourseNote,
  type AnnualCourseNote,
} from "../pedagogical-path/annual-notes.ts";
import { listTeacherCourses } from "../teacher-workspace/service.ts";
import type { AnnualCourseStore } from "../../lib/persistence/annual-course-types.ts";
import type { AnnualCourseNotesStore } from "../../lib/persistence/pedagogical-path-types.ts";
import type { SchoolCatalogStore } from "../../lib/persistence/school-catalog-types.ts";
import type { SchoolYearStore } from "../../lib/persistence/school-year-types.ts";
import { NotebookConflictError, type TeacherNotesStore } from "../../lib/persistence/teacher-notes-types.ts";
import { preserveNotebookMetadata } from "../../lib/persistence/notebook-state.ts";
import {
  createEmptyNotesDocument,
  createEmptyNotesDocumentV2,
  isNotesDocumentV1,
  isNotesDocumentV2,
  normalizeClassNotes,
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
    (left, right) => (left.notebookPosition ?? Number.MAX_SAFE_INTEGER) - (right.notebookPosition ?? Number.MAX_SAFE_INTEGER)
      || left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
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

export async function accessibleAnnualCourseIdsForTeacher(
  courses: AnnualCourseStore,
  teacherId: string,
  at = new Date().toISOString(),
): Promise<string[]> {
  const assignments = await courses.listAssignmentsForTeacher(teacherId);
  const ids = new Set<string>();
  for (const assignment of assignments) {
    if (isAssignmentActiveAt(assignment, at)) ids.add(assignment.annualCourseId);
  }
  return [...ids].sort();
}

export interface NotebookConsultAccessDeps {
  courses: AnnualCourseStore;
  catalog?: SchoolCatalogStore;
  years?: SchoolYearStore;
}

export interface NotebookConsultAccessOptions {
  teacherId: string;
  at?: string;
  schoolYearId?: string | null;
  isAdmin?: boolean;
  adminConsult?: boolean;
}

/**
 * NORMAL : attributions actives à la date donnée.
 * ADMIN_CONSULT : cours de l’année explicitement consultée, résolus comme Mes cours.
 * `consult` sans compte administrateur retombe sur le mode normal.
 */
export async function accessibleAnnualCourseIdsForNotebookConsult(
  deps: NotebookConsultAccessDeps,
  options: NotebookConsultAccessOptions,
): Promise<string[]> {
  const catalog = deps.catalog;
  const years = deps.years;
  if (!(options.adminConsult === true && options.isAdmin === true && catalog && years)) {
    return accessibleAnnualCourseIdsForTeacher(deps.courses, options.teacherId, options.at);
  }
  const workspace = await listTeacherCourses(
    { courses: deps.courses, catalog, years },
    {
      teacherId: options.teacherId,
      schoolYearId: options.schoolYearId,
      isAdmin: true,
      adminConsult: true,
      at: options.at,
    },
  );
  return [...new Set(workspace.courses.map((course) => course.annualCourseId))].sort();
}

/** Cours explicitement présents dans le document V2 (y compris séances vidées). */
export function annualCourseIdsTouchedByNotebookDocument(
  document: ClassNotesDocument,
  allowedCourseIds: ReadonlySet<string>,
): string[] {
  if (!isNotesDocumentV2(document)) return [];
  const ids = new Set<string>();
  for (const sessionKey of Object.keys(document.sessions ?? {})) {
    const parsed = parseCourseSessionKey(sessionKey);
    if (parsed && allowedCourseIds.has(parsed.annualCourseId)) ids.add(parsed.annualCourseId);
  }
  return [...ids].sort();
}

export async function splitResolvableNotebookNotes(
  teacherId: string,
  document: ClassNotesDocument,
  courses: AnnualCourseStore,
  blockedIds: ReadonlySet<string> = new Set(),
  allowedCourseIds?: ReadonlySet<string>,
): Promise<{ leftover: ClassNotesDocument; resolved: AnnualCourseNote[] }> {
  const normalized = normalizeClassNotes(document);
  if (isNotesDocumentV1(normalized)) {
    return { leftover: normalized, resolved: [] };
  }

  const identityCounts = new Map<string, number>();
  for (const notes of [...Object.values(normalized.sessions), ...Object.values(normalized.pendingWeeks ?? {}),
    ...Object.values(normalized.orphanedSessions ?? {})]) {
    for (const note of notes) identityCounts.set(note.id.trim(), (identityCounts.get(note.id.trim()) ?? 0) + 1);
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
    // Keep the entire list when ambiguous: splitting it would also change its order.
    if (notes.some(note => !note.id.trim() || note.id !== note.id.trim()
      || identityCounts.get(note.id.trim()) !== 1 || blockedIds.has(note.id))) {
      leftoverSessions[sessionKey] = notes;
      continue;
    }
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
    if (allowedCourseIds && !allowedCourseIds.has(course.id)) {
      leftoverSessions[sessionKey] = notes;
      continue;
    }
    for (const [position, note] of notes.entries()) {
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
        notebookPosition: position,
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

/** Public revision is content-derived; it contains no note text or internal SQL state. */
export function notebookRevision(document: ClassNotesDocument | null): string {
  function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") return Object.fromEntries(
      Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]),
    );
    return value;
  }
  return createHash("sha256").update(JSON.stringify(canonical(document))).digest("hex");
}

export async function persistTeacherNotebookDocument(
  teacherId: string,
  document: ClassNotesDocument,
  deps: TeacherNotebookNotesDeps,
  expectedRevision?: string,
): Promise<ClassNotesDocument> {
  const courseIds = await accessibleAnnualCourseIdsForTeacher(deps.courses, teacherId);
  const allowed = new Set(courseIds);
  const state = await deps.teacherNotes.readNotebook(teacherId, deps.courseNotes, courseIds);
  const previous = composeTeacherNotebookDocument(state.leftover, state.owned);
  if (expectedRevision !== undefined && notebookRevision(previous) !== expectedRevision) throw new NotebookConflictError();
  const { leftover, resolved } = await splitResolvableNotebookNotes(
    teacherId,
    document,
    deps.courses,
    new Set(),
    allowed,
  );
  const isV2 = isNotesDocumentV2(normalizeClassNotes(document));
  const owned = isV2 ? [
    // Notes without a calendar location are not represented in the HTTP document.
    ...state.owned.filter(note => !note.courseSessionKey),
    ...resolved.map(note => preserveNotebookMetadata(note, state.owned.find(current =>
      (current.legacyNoteId || current.id) === note.legacyNoteId))),
  ] : state.owned;
  const leftoverToStore = leftoverIsEmpty(leftover) && isV2 ? createEmptyNotesDocumentV2() : leftover;
  const touchedCourseIds = isV2 ? annualCourseIdsTouchedByNotebookDocument(document, allowed) : [];
  await deps.teacherNotes.commitNotebook(
    teacherId,
    state,
    leftoverToStore,
    owned,
    deps.courseNotes,
    courseIds,
    touchedCourseIds,
  );
  return composeTeacherNotebookDocument(leftoverToStore, owned) ?? createEmptyNotesDocument();
}

export async function loadTeacherNotebookDocument(
  teacherId: string,
  deps: TeacherNotebookNotesDeps,
  options?: Omit<NotebookConsultAccessOptions, "teacherId"> & {
    catalog?: SchoolCatalogStore;
    years?: SchoolYearStore;
  },
): Promise<ClassNotesDocument | null> {
  const catalog = options?.catalog;
  const years = options?.years;
  if (options?.adminConsult === true && options.isAdmin === true && catalog && years) {
    const courseIds = await accessibleAnnualCourseIdsForNotebookConsult(
      { courses: deps.courses, catalog, years },
      {
        teacherId,
        at: options.at,
        schoolYearId: options.schoolYearId,
        isAdmin: true,
        adminConsult: true,
      },
    );
    const notes = (
      await Promise.all(courseIds.map((annualCourseId) => deps.courseNotes.listNotesByAnnualCourse(annualCourseId)))
    ).flat();
    if (notes.length === 0) return null;
    return composeTeacherNotebookDocument(null, notes);
  }

  const courseIds = await accessibleAnnualCourseIdsForTeacher(deps.courses, teacherId, options?.at);
  const allowed = new Set(courseIds);
  for (let attempt = 0; attempt < 4; attempt++) {
    const state = await deps.teacherNotes.readNotebook(teacherId, deps.courseNotes, courseIds);
    if (!state.leftover || !isNotesDocumentV2(state.leftover)) {
      return composeTeacherNotebookDocument(state.leftover, state.owned);
    }
    // An identity already present in annual storage is ambiguous, never silently discarded.
    const blocked = new Set(state.owned.map(note => note.legacyNoteId || note.id));
    const { leftover, resolved } = await splitResolvableNotebookNotes(
      teacherId,
      state.leftover,
      deps.courses,
      blocked,
      allowed,
    );
    if (!resolved.length) return composeTeacherNotebookDocument(state.leftover, state.owned);
    const owned = [...state.owned, ...resolved];
    try {
      await deps.teacherNotes.commitNotebook(teacherId, state, leftover, owned, deps.courseNotes, courseIds);
      return composeTeacherNotebookDocument(leftover, owned);
    } catch (error) {
      if (!(error instanceof NotebookConflictError)) throw error;
      // Re-read both halves; never retry a stale replacement.
    }
  }
  throw new NotebookConflictError();
}
