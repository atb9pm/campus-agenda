import assert from "node:assert/strict";
import test from "node:test";

import { weekNotesKey } from "../src/features/class-notebook/index.ts";
import {
  NOTES_ARE_NOT_AGENDA_TYPE,
  REFERENCE_ITEM_TYPES,
  addItem,
  addSession,
  assertNoNoteAgendaType,
  copyNoteToNewYear,
  createAnnualCourseNote,
  createEmptyPath,
  deleteItem,
  deleteSession,
  filterInheritedNotes,
  findItem,
  findSession,
  insertSession,
  listSessionIds,
  moveItem,
  moveSession,
  studentMayAccessCourseNotes,
  teacherMayConsultCourseNotes,
  updateItem,
  updateSession,
} from "../src/features/pedagogical-path/index.ts";
import {
  ensurePathForContext,
  mutatePath,
} from "../src/features/pedagogical-path/path-service.ts";
import {
  getMemorySchoolCatalogStore,
  resetMemorySchoolCatalogStore,
} from "../src/lib/persistence/memory-school-catalog-store.ts";
import {
  getMemoryAnnualCourseNotesStore,
  getMemoryPedagogicalPathStore,
  resetMemoryPedagogicalPathStore,
} from "../src/lib/persistence/memory-pedagogical-path-store.ts";
import {
  getMemoryTeacherNotesStore,
  resetMemoryTeacherNotesStore,
} from "../src/lib/persistence/memory-teacher-notes-store.ts";
import { createNodeSqliteDatabase } from "../src/lib/persistence/sql/adapters.ts";
import { applyMigrations } from "../src/lib/persistence/sql/migrate.ts";
import {
  SqlAnnualCourseNotesStore,
  SqlPedagogicalPathStore,
} from "../src/lib/persistence/sql/sql-pedagogical-path-store.ts";
import { SqlSchoolCatalogStore } from "../src/lib/persistence/sql/sql-school-catalog-store.ts";
import { AGENDA_ITEM_TYPES } from "../src/types/agenda.ts";

function freshCatalog() {
  resetMemorySchoolCatalogStore();
  return getMemorySchoolCatalogStore();
}

function freshPathStores() {
  resetMemoryPedagogicalPathStore();
  return {
    paths: getMemoryPedagogicalPathStore(),
    notes: getMemoryAnnualCourseNotesStore(),
  };
}

async function seedContext() {
  const catalog = freshCatalog();
  await catalog.ensureSeeded();
  const profession = await catalog.createProfession({
    label: "Mécatronicien",
    durationYears: 4,
  });
  const [branch] = await catalog.listBranches();
  assert.ok(branch);
  const created = await catalog.createContext({
    professionId: profession.id,
    trainingYear: 1,
    branchId: branch.id,
  });
  const context = "ok" in created && created.ok === true ? created.value : created;
  assert.ok(context && typeof context === "object" && "id" in context);
  return { catalog, context: context as { id: string }, branch };
}

test("parcours — création pour un CTX existant", async () => {
  const { catalog, context } = await seedContext();
  const { paths } = freshPathStores();
  const result = await ensurePathForContext({
    contextId: context.id,
    catalog,
    pathStore: paths,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.contextId, context.id);
  assert.equal(result.value.sessions.length, 0);
});

test("parcours — refus CTX inexistant", async () => {
  const catalog = freshCatalog();
  await catalog.ensureSeeded();
  const { paths } = freshPathStores();
  const result = await ensurePathForContext({
    contextId: "missing-ctx",
    catalog,
    pathStore: paths,
  });
  assert.equal(result.ok, false);
});

test("parcours — ID séance stable après insertion et réorganisation", () => {
  let path = createEmptyPath({ id: "path-1", contextId: "ctx-1" });
  path = addSession(path, { id: "sess-a" }).value!;
  path = addSession(path, { id: "sess-b" }).value!;
  path = addSession(path, { id: "sess-c" }).value!;
  assert.deepEqual(listSessionIds(path), ["sess-a", "sess-b", "sess-c"]);

  path = insertSession(path, { id: "sess-new", atPosition: 2 }).value!;
  assert.equal(findSession(path, "sess-b")?.position, 3);
  assert.equal(findSession(path, "sess-new")?.position, 2);
  assert.equal(findSession(path, "sess-b")?.id, "sess-b");

  path = moveSession(path, "sess-c", 1).value!;
  assert.equal(findSession(path, "sess-c")?.position, 1);
  assert.equal(findSession(path, "sess-c")?.id, "sess-c");
});

test("parcours — Devoir / Contrôle / Information + plusieurs éléments", () => {
  let path = createEmptyPath({ id: "path-1", contextId: "ctx-1" });
  path = addSession(path, { id: "sess-1" }).value!;
  path = addItem(path, "sess-1", {
    id: "item-hw",
    type: "HOMEWORK",
    title: "Exercices moteur 4 temps",
    detail: "Pages 12-14",
  }).value!;
  path = addItem(path, "sess-1", {
    id: "item-info",
    type: "INFORMATION",
    title: "Préparation TP",
  }).value!;
  path = addItem(path, "sess-1", {
    id: "item-test",
    type: "TEST",
    title: "Bases du moteur",
  }).value!;
  assert.equal(findSession(path, "sess-1")?.items.length, 3);

  const rejected = addItem(path, "sess-1", {
    id: "item-note",
    type: "NOTE",
    title: "Interdit",
  });
  assert.equal(rejected.ok, false);
  assert.deepEqual([...REFERENCE_ITEM_TYPES], ["HOMEWORK", "TEST", "INFORMATION"]);
});

test("parcours — modification sans changement d'ID + déplacement élément", () => {
  let path = createEmptyPath({ id: "path-1", contextId: "ctx-1" });
  path = addSession(path, { id: "sess-1" }).value!;
  path = addSession(path, { id: "sess-2" }).value!;
  path = addItem(path, "sess-1", {
    id: "item-1",
    type: "HOMEWORK",
    title: "Ancien titre",
  }).value!;

  path = updateItem(path, "item-1", { title: "Nouveau titre", detail: "Détail" }).value!;
  assert.equal(findItem(path, "item-1")?.item.id, "item-1");
  assert.equal(findItem(path, "item-1")?.item.title, "Nouveau titre");

  path = moveItem(path, "item-1", { targetSessionId: "sess-2", position: 1 }).value!;
  assert.equal(findItem(path, "item-1")?.session.id, "sess-2");
  assert.equal(findSession(path, "sess-1")?.items.length, 0);
});

test("parcours — suppression séance non vide refusée", () => {
  let path = createEmptyPath({ id: "path-1", contextId: "ctx-1" });
  path = addSession(path, { id: "sess-1" }).value!;
  path = addItem(path, "sess-1", {
    id: "item-1",
    type: "INFORMATION",
    title: "Info",
  }).value!;
  assert.equal(deleteSession(path, "sess-1").ok, false);
  path = deleteItem(path, "item-1").value!;
  path = deleteSession(path, "sess-1").value!;
  assert.equal(path.sessions.length, 0);
});

test("parcours — updateSession conserve l'ID", () => {
  let path = createEmptyPath({ id: "path-1", contextId: "ctx-1" });
  path = addSession(path, { id: "sess-1" }).value!;
  path = updateSession(path, "sess-1", { label: "Intro moteur" }).value!;
  assert.equal(findSession(path, "sess-1")?.id, "sess-1");
  assert.equal(findSession(path, "sess-1")?.label, "Intro moteur");
});

test("parcours — store mémoire via service", async () => {
  const { catalog, context } = await seedContext();
  const { paths } = freshPathStores();
  let result = await mutatePath({
    contextId: context.id,
    catalog,
    pathStore: paths,
    action: { type: "addSession" },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const sessionId = result.value.sessions[0]?.id;
  assert.ok(sessionId);

  result = await mutatePath({
    contextId: context.id,
    catalog,
    pathStore: paths,
    action: {
      type: "addItem",
      sessionId,
      itemType: "HOMEWORK",
      title: "Devoir mémoire",
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.sessions[0]?.items[0]?.title, "Devoir mémoire");
  const stored = await paths.getPathByContextId(context.id);
  assert.equal(stored?.sessions[0]?.items[0]?.title, "Devoir mémoire");
});

test("parcours — SQLite + migration additive", async () => {
  const db = createNodeSqliteDatabase(":memory:");
  await applyMigrations(db);
  const catalog = new SqlSchoolCatalogStore(db);
  await catalog.ensureSeeded();
  const profession = await catalog.createProfession({
    label: "Informaticien",
    durationYears: 3,
  });
  const [branch] = await catalog.listBranches();
  assert.ok(branch);
  const created = await catalog.createContext({
    professionId: profession.id,
    trainingYear: 1,
    branchId: branch.id,
  });
  const context = "ok" in created && created.ok === true ? created.value : created;
  assert.ok(context && typeof context === "object" && "id" in context);

  const pathStore = new SqlPedagogicalPathStore(db);
  const ensured = await ensurePathForContext({
    contextId: (context as { id: string }).id,
    catalog,
    pathStore,
  });
  assert.equal(ensured.ok, true);

  const mutated = await mutatePath({
    contextId: (context as { id: string }).id,
    catalog,
    pathStore,
    action: { type: "addSession", label: "Séance SQL" },
  });
  assert.equal(mutated.ok, true);
  if (!mutated.ok) return;

  const reloaded = await pathStore.getPathByContextId((context as { id: string }).id);
  assert.equal(reloaded?.sessions[0]?.label, "Séance SQL");
  assert.equal(reloaded?.sessions[0]?.id, mutated.value.sessions[0]?.id);
});

test("notes — multi-classes même CTX + auteur ≠ exclusivité", async () => {
  const { notes } = freshPathStores();
  const shared = {
    schoolYearId: "year-2026",
    contextId: "ctx-moteur",
    referenceSessionId: "sess-8",
  };

  await notes.createNote("note-a", {
    ...shared,
    classId: "class-1a",
    authorTeacherId: "teacher-a",
    text: "Préparer le multimètre",
  });
  await notes.createNote("note-b", {
    ...shared,
    classId: "class-1b",
    authorTeacherId: "teacher-a",
    text: "Terminer la distribution",
  });

  const listA = await notes.listNotes({
    schoolYearId: shared.schoolYearId,
    classId: "class-1a",
    contextId: shared.contextId,
  });
  const listB = await notes.listNotes({
    schoolYearId: shared.schoolYearId,
    classId: "class-1b",
    contextId: shared.contextId,
  });
  assert.equal(listA.length, 1);
  assert.equal(listB.length, 1);
  assert.equal(listA[0]?.text, "Préparer le multimètre");
  assert.equal(listB[0]?.text, "Terminer la distribution");

  assert.equal(
    teacherMayConsultCourseNotes({ isTeacher: true, isStudent: false }),
    true,
  );
  assert.equal(studentMayAccessCourseNotes(), false);
  assert.equal(NOTES_ARE_NOT_AGENDA_TYPE, true);
  assert.equal(assertNoNoteAgendaType(), true);
  assert.ok(!(AGENDA_ITEM_TYPES as readonly string[]).includes("NOTE"));
});

test("notes — copie année suivante + effacement héritées sans toucher la source", async () => {
  const { notes } = freshPathStores();
  const source = await notes.createNote("note-src", {
    schoolYearId: "year-2026",
    classId: "class-1b",
    contextId: "ctx-moteur",
    referenceSessionId: "sess-4",
    authorTeacherId: "teacher-a",
    text: "Reprendre l'exercice 4",
  });

  const copied = copyNoteToNewYear(source, {
    id: "note-copy",
    schoolYearId: "year-2027",
    classId: "class-1b-new",
    authorTeacherId: "teacher-b",
  });
  await notes.createNote(copied.id, {
    schoolYearId: copied.schoolYearId,
    classId: copied.classId,
    contextId: copied.contextId,
    referenceSessionId: copied.referenceSessionId,
    authorTeacherId: copied.authorTeacherId,
    text: copied.text,
    sourceNoteId: copied.sourceNoteId,
    sourceSchoolYearId: copied.sourceSchoolYearId,
    inheritedAt: copied.inheritedAt,
  });

  const deleted = await notes.deleteInheritedNotes({
    schoolYearId: "year-2027",
    classId: "class-1b-new",
    contextId: "ctx-moteur",
  });
  assert.equal(deleted, 1);
  const sourceStillThere = await notes.getNote("note-src");
  assert.ok(sourceStillThere);
  assert.equal(sourceStillThere.text, "Reprendre l'exercice 4");
  assert.equal(filterInheritedNotes([source, copied]).length, 1);
});

test("notes — SQLite annual_course_notes additive", async () => {
  const db = createNodeSqliteDatabase(":memory:");
  await applyMigrations(db);
  const store = new SqlAnnualCourseNotesStore(db);
  await store.createNote("n1", {
    schoolYearId: "sy1",
    classId: "c1",
    contextId: "ctx1",
    authorTeacherId: "t1",
    text: "Note SQL",
  });
  const listed = await store.listNotes({
    schoolYearId: "sy1",
    classId: "c1",
    contextId: "ctx1",
  });
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.text, "Note SQL");
});

test("compat — anciennes notes carnet inchangées", async () => {
  resetMemoryTeacherNotesStore();
  const store = getMemoryTeacherNotesStore();
  const key = weekNotesKey("setup-mma-1a", 8);
  await store.saveNotes("teacher-legacy", {
    version: 1,
    weeks: {
      [key]: [{ id: "legacy-1", text: "Préparer trois multimètres" }],
    },
  });
  const loaded = await store.getNotes("teacher-legacy");
  assert.equal(loaded?.weeks[key]?.[0]?.text, "Préparer trois multimètres");
});

test("compat — types Agenda publications inchangés (pas de NOTE)", () => {
  assert.deepEqual([...AGENDA_ITEM_TYPES], ["HOMEWORK", "TEST", "INFORMATION"]);
  const created = createAnnualCourseNote("x", {
    schoolYearId: "y",
    classId: "c",
    contextId: "ctx",
    authorTeacherId: "t",
    text: "ok",
  });
  assert.equal(created.ok, true);
});
