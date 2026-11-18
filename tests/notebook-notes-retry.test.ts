import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  loadTeacherNotebookDocument,
  notebookRevision,
  persistTeacherNotebookDocument,
} from "../src/features/class-notebook/annual-private-notes.ts";
import { normalizeClassNotes } from "../src/features/class-notebook/notes-storage.ts";
import type { AnnualCourse, TeacherCourseAssignment } from "../src/features/annual-courses/types.ts";
import type { ClassNotesDocument, TeacherWeekNote } from "../src/features/class-notebook/types.ts";
import { MemoryAnnualCourseStore } from "../src/lib/persistence/memory-annual-course-store.ts";
import {
  getMemoryAnnualCourseNotesStore,
  resetMemoryPedagogicalPathStore,
} from "../src/lib/persistence/memory-pedagogical-path-store.ts";
import {
  getMemoryTeacherNotesStore,
  resetMemoryTeacherNotesStore,
} from "../src/lib/persistence/memory-teacher-notes-store.ts";
import { NotebookConflictError } from "../src/lib/persistence/teacher-notes-types.ts";
import { fetchTeacherNotesApi, saveTeacherNotesApi } from "../web/lib/api-client.ts";
import {
  NOTES_SAVE_UNREACHABLE_MESSAGE,
  NotesSaveConflictError,
  NotesSaveUnreachableError,
  notesContentKey,
  notesRetryDelay,
  notesSaveFailureKind,
} from "../web/lib/notebook-autosave.ts";

const TEACHER = "teacher-a";
const YEAR = "year-2026";
const COURSE = "ac-ma1-moteur";
const SESSION = `${YEAR}|${COURSE}|2026-11-16`;
const OTHER_SESSION = `${YEAR}|${COURSE}|2026-11-09`;

function course(): AnnualCourse {
  return {
    id: COURSE,
    schoolYearId: YEAR,
    classId: "class-ma1",
    contextId: "ctx-moteur",
    isArchived: false,
    archivedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function assignment(): TeacherCourseAssignment {
  return {
    id: "asg-a",
    annualCourseId: COURSE,
    teacherId: TEACHER,
    role: "PRIMARY",
    validFrom: "2020-01-01T00:00:00.000Z",
    validTo: null,
    createdByAdminId: "admin-1",
    createdAt: "2020-01-01T00:00:00.000Z",
    endedAt: null,
    overrideReason: null,
    overrideByAdminId: null,
  };
}

function doc(sessions: Record<string, TeacherWeekNote[]>): ClassNotesDocument {
  return { version: 2, sessions };
}

type NetworkMode = "normal" | "offline" | "lose-response" | "server-error";

/** Le vrai stockage des notes derrière un faux réseau, pour rejouer une coupure. */
async function notesServer() {
  resetMemoryTeacherNotesStore();
  resetMemoryPedagogicalPathStore();
  const courses = new MemoryAnnualCourseStore();
  await courses.createCourse(course());
  await courses.createAssignment(assignment());
  const world = { courses, teacherNotes: getMemoryTeacherNotesStore(), courseNotes: getMemoryAnnualCourseNotesStore() };
  const network = { mode: "normal" as NetworkMode, puts: 0 };

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (network.mode === "offline") throw new TypeError("Failed to fetch");
    if (network.mode === "server-error") return new Response("<html>Bad gateway</html>", { status: 502 });
    if ((init?.method ?? "GET") === "GET") {
      const notes = await loadTeacherNotebookDocument(TEACHER, world);
      return json({ ok: true, notes, revision: notebookRevision(notes) });
    }
    network.puts += 1;
    const body = JSON.parse(String(init?.body)) as { notes: ClassNotesDocument; revision?: string };
    try {
      const notes = await persistTeacherNotebookDocument(TEACHER, normalizeClassNotes(body.notes), world, body.revision);
      if (network.mode === "lose-response") {
        network.mode = "normal";
        throw new TypeError("Failed to fetch");
      }
      return json({ ok: true, notes, revision: notebookRevision(notes) });
    } catch (error) {
      if (!(error instanceof NotebookConflictError)) throw error;
      return json({ ok: false, code: "NOTES_CONFLICT", reason: error.message }, 409);
    }
  }) as typeof fetch;

  const serverNotes = () => loadTeacherNotebookDocument(TEACHER, world);
  const otherTabSaves = (notes: ClassNotesDocument) => persistTeacherNotebookDocument(TEACHER, notes, world);
  return { network, serverNotes, otherTabSaves };
}

const hier = { id: "n-hier", text: "Notes d’hier, déjà enregistrées." };
const matin = { id: "n-matin", text: "Notes de ce matin." };
const quatorzeHeures = { id: "n-14h", text: "Phrase écrite vers 14 h." };

test("réponse perdue : la frappe suivante reprend sans bandeau et sans rien écraser", async () => {
  const server = await notesServer();
  await server.otherTabSaves(doc({ [OTHER_SESSION]: [hier] }));
  await fetchTeacherNotesApi();

  server.network.mode = "lose-response";
  const sent = doc({ [OTHER_SESSION]: [hier], [SESSION]: [matin] });
  await assert.rejects(saveTeacherNotesApi(sent), NotesSaveUnreachableError);
  assert.deepEqual(await server.serverNotes(), sent);

  const next = doc({ [OTHER_SESSION]: [hier], [SESSION]: [matin, quatorzeHeures] });
  assert.deepEqual(await saveTeacherNotesApi(next), next);
  assert.deepEqual(await server.serverNotes(), next);
});

test("réponse perdue puis renvoi automatique du même texte : enregistré une seule fois", async () => {
  const server = await notesServer();
  await fetchTeacherNotesApi();
  const sent = doc({ [SESSION]: [matin] });
  server.network.mode = "lose-response";
  await assert.rejects(saveTeacherNotesApi(sent), NotesSaveUnreachableError);
  const putsBefore = server.network.puts;

  assert.deepEqual(await saveTeacherNotesApi(sent), sent);
  assert.equal(server.network.puts - putsBefore, 2, "un 409 relu, puis un seul renvoi accepté");
  assert.deepEqual(await server.serverNotes(), sent);
});

test("un autre onglet a enregistré : le conflit reste affiché et le serveur n’est pas écrasé", async () => {
  const server = await notesServer();
  await server.otherTabSaves(doc({ [SESSION]: [hier] }));
  await fetchTeacherNotesApi();

  const otherTab = doc({ [SESSION]: [hier, { id: "n-onglet", text: "Écrit dans l’autre onglet." }] });
  await server.otherTabSaves(otherTab);

  const screen = doc({ [SESSION]: [hier, quatorzeHeures] });
  const error = await saveTeacherNotesApi(screen).then(() => null, (caught: unknown) => caught);
  assert.ok(error instanceof NotesSaveConflictError);
  assert.equal(notesSaveFailureKind(error), "conflict");
  assert.match(String((error as Error).message), /Les notes ont changé depuis leur chargement/);
  assert.deepEqual(await server.serverNotes(), otherTab);
});

test("un autre onglet après une réponse perdue : le conflit reste affiché", async () => {
  const server = await notesServer();
  await fetchTeacherNotesApi();
  server.network.mode = "lose-response";
  await assert.rejects(saveTeacherNotesApi(doc({ [SESSION]: [matin] })), NotesSaveUnreachableError);

  const otherTab = doc({ [SESSION]: [matin, { id: "n-onglet", text: "Écrit ailleurs." }] });
  await server.otherTabSaves(otherTab);
  await assert.rejects(saveTeacherNotesApi(doc({ [SESSION]: [matin, quatorzeHeures] })), NotesSaveConflictError);
  assert.deepEqual(await server.serverNotes(), otherTab);
});

test("réponse vide ou tronquée : la lecture des notes retente puis aboutit", async () => {
  const server = await notesServer();
  await server.otherTabSaves(doc({ [SESSION]: [matin] }));
  let gets = 0;
  const upstream = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if ((init?.method ?? "GET") !== "GET") return upstream(input, init);
    gets += 1;
    if (gets === 1) return new Response("", { status: 200, headers: { "content-type": "application/json" } });
    if (gets === 2) return new Response("{\"ok\":true", { status: 200, headers: { "content-type": "application/json" } });
    return upstream(input, init);
  }) as typeof fetch;

  assert.deepEqual(await fetchTeacherNotesApi(), doc({ [SESSION]: [matin] }));
  assert.equal(gets, 3, "deux échecs puis une réussite");
});

test("coupure puis retour du réseau : le renvoi enregistre la dernière version", async () => {
  const server = await notesServer();
  await fetchTeacherNotesApi();
  server.network.mode = "offline";
  const screen = doc({ [SESSION]: [matin, quatorzeHeures] });
  const offline = await saveTeacherNotesApi(screen).then(() => null, (caught: unknown) => caught);
  assert.ok(offline instanceof NotesSaveUnreachableError);
  assert.equal((offline as Error).message, NOTES_SAVE_UNREACHABLE_MESSAGE);
  assert.equal(notesSaveFailureKind(offline), "unreachable");
  assert.equal(await server.serverNotes(), null);

  server.network.mode = "server-error";
  await assert.rejects(saveTeacherNotesApi(screen), NotesSaveUnreachableError);

  server.network.mode = "normal";
  assert.deepEqual(await saveTeacherNotesApi(screen), screen);
  assert.deepEqual(await server.serverNotes(), screen);
});

test("comparaison des notes : ordre des clés et listes vides ignorés, contenu exact", () => {
  const left: ClassNotesDocument = { version: 2, sessions: { [SESSION]: [matin], [OTHER_SESSION]: [] }, pendingWeeks: {} };
  const right: ClassNotesDocument = { sessions: { [SESSION]: [{ text: matin.text, id: matin.id }] }, version: 2 };
  assert.equal(notesContentKey(left), notesContentKey(right));
  assert.notEqual(notesContentKey(left), notesContentKey(doc({ [SESSION]: [{ ...matin, text: "Notes de ce matin" }] })));
  assert.notEqual(notesContentKey(doc({ [SESSION]: [matin, hier] })), notesContentKey(doc({ [SESSION]: [hier, matin] })));
  assert.deepEqual([0, 1, 2, 3, 9].map(notesRetryDelay), [3_000, 10_000, 30_000, 60_000, 60_000]);
  assert.equal(notesSaveFailureKind(new Error("Document de notes invalide.")), "other");
});

test("le Carnet renvoie seul les notes et prévient avant de perdre un envoi en attente", async () => {
  const page = await readFile(new URL("../web/app/page.tsx", import.meta.url), "utf8");
  const retry = page.slice(page.indexOf("if (!notesRetryPending ||"), page.indexOf("[adminYearConsult, notesRetryPending, teacherAuthenticated]"));
  assert.match(retry, /addEventListener\("online", retry\)/);
  assert.match(retry, /notesRetryDelay\(notesRetryAttemptRef\.current\)/);
  assert.match(retry, /saveTeacherNotesApi\(classNotesDocumentRef\.current\)/);
  assert.match(retry, /keepTeacherSessionPayload\(epoch, teacherEpochRef\.current, true\)/);
  assert.match(retry, /setNotesSyncInterrupted\(true\)/);
  assert.match(page, /if \(!notesConflictRef\.current && !notesRetryPendingRef\.current\) return;/);
  const logout = page.slice(page.indexOf("function logoutTeacher"), page.indexOf("function finishTeacherLogout"));
  assert.match(logout, /notesConflictRef\.current \|\| notesRetryPendingRef\.current/);
  const discard = page.slice(page.indexOf("function discardTeacherWorkspace"), page.indexOf("function clearTeacherAuthIdentity"));
  assert.match(discard, /setNotesRetryPending\(false\)/);
});
