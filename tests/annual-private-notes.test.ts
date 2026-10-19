import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  loadTeacherNotebookDocument,
  persistTeacherNotebookDocument,
  splitResolvableNotebookNotes,
} from "../src/features/class-notebook/annual-private-notes.ts";
import { fromPlainText, isNotesDocumentV1, isNotesDocumentV2 } from "../src/features/class-notebook/index.ts";
import { copyNoteToNewYear, createAnnualCourseNote, studentMayAccessCourseNotes } from "../src/features/pedagogical-path/index.ts";
import { APP_VERSION } from "../src/lib/app-version.ts";
import { MemoryAnnualCourseStore } from "../src/lib/persistence/memory-annual-course-store.ts";
import {
  MemoryAnnualCourseNotesStore,
  getMemoryAnnualCourseNotesStore,
  resetMemoryPedagogicalPathStore,
} from "../src/lib/persistence/memory-pedagogical-path-store.ts";
import {
  getMemoryTeacherNotesStore,
  resetMemoryTeacherNotesStore,
} from "../src/lib/persistence/memory-teacher-notes-store.ts";
import { CAMPUS_BACKUP_COLUMNS, CAMPUS_BACKUP_INSERT_ORDER } from "../src/lib/persistence/campus-backup-tables.ts";
import { dumpCampusTables, projectBackupRow, validateCampusTables, type CampusTableDump } from "../src/lib/persistence/sql/sql-campus-backup.ts";
import { createNodeSqliteDatabase } from "../src/lib/persistence/sql/adapters.ts";
import { applyMigrations, SQL_MIGRATION_FILES } from "../src/lib/persistence/sql/migrate.ts";
import { SqlAnnualCourseNotesStore } from "../src/lib/persistence/sql/sql-pedagogical-path-store.ts";
import { SqlTeacherNotesStore } from "../src/lib/persistence/sql/sql-teacher-notes-store.ts";
import type { AnnualCourse } from "../src/features/annual-courses/types.ts";
import type { ClassNotesDocument, TeacherWeekNote } from "../src/features/class-notebook/types.ts";

const TEACHER_A = "teacher-a";
const TEACHER_B = "teacher-b";
const YEAR_A = "year-2026";
const YEAR_B = "year-2027";
const COURSE_A = "ac-ma1-moteur";
const COURSE_B = "ac-ma1-francais";
const COURSE_NEXT = "ac-ma1-moteur-next";
const SESSION_A = `${YEAR_A}|${COURSE_A}|2026-09-14`;
const SESSION_B = `${YEAR_A}|${COURSE_B}|2026-09-15`;
const SESSION_NEXT = `${YEAR_B}|${COURSE_NEXT}|2027-09-13`;
const SESSION_UNKNOWN = `${YEAR_A}|ac-missing|2026-09-16`;
const INVALID_KEY = "not-a-session-key";

function course(id: string, yearId: string, classId: string, contextId: string): AnnualCourse {
  return {
    id,
    schoolYearId: yearId,
    classId,
    contextId,
    isArchived: false,
    archivedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function memoryWorld() {
  resetMemoryTeacherNotesStore();
  resetMemoryPedagogicalPathStore();
  const courses = new MemoryAnnualCourseStore();
  const teacherNotes = getMemoryTeacherNotesStore();
  const courseNotes = getMemoryAnnualCourseNotesStore();
  return { courses, teacherNotes, courseNotes };
}

async function seedCourses(store: MemoryAnnualCourseStore) {
  await store.createCourse(course(COURSE_A, YEAR_A, "class-ma1", "ctx-moteur"));
  await store.createCourse(course(COURSE_B, YEAR_A, "class-ma1", "ctx-francais"));
  await store.createCourse(course(COURSE_NEXT, YEAR_B, "class-ma1-next", "ctx-moteur"));
}

function v2Doc(
  sessions: Record<string, TeacherWeekNote[]>,
  extra?: { pendingWeeks?: Record<string, TeacherWeekNote[]>; orphanedSessions?: Record<string, TeacherWeekNote[]> },
): ClassNotesDocument {
  return { version: 2, sessions, ...extra };
}

test("PR3.4 — version et migration 0033", async () => {
  assert.equal(APP_VERSION, "2.62.0");
  assert.equal(SQL_MIGRATION_FILES.at(-1), "0033_annual_private_notes_storage.sql");
  const sql = await readFile(new URL("../migrations/0033_annual_private_notes_storage.sql", import.meta.url), "utf8");
  assert.match(sql, /body_json/);
  assert.match(sql, /course_session_key/);
  assert.match(sql, /owner_teacher_id/);
  assert.match(sql, /legacy_note_id/);
  assert.doesNotMatch(sql, /DROP TABLE teacher_notes/);
  assert.doesNotMatch(sql, /includePrivateNotes/);
});

test("PR3.4 — year-transition non modifié (PR3.5 non commencé)", async () => {
  const files = [
    "src/features/year-transition/preview.ts",
    "src/features/year-transition/fingerprint.ts",
    "src/features/year-transition/apply.ts",
    "src/features/year-transition/assemble.ts",
  ];
  for (const file of files) {
    const src = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    assert.equal(src.includes("includePrivateNotes"), false, file);
  }
});

test("PR3.4 — V2 simple normalisation sans perte + mapping", async () => {
  const world = memoryWorld();
  await seedCourses(world.courses);
  const saved = await persistTeacherNotebookDocument(
    TEACHER_A,
    v2Doc({
      [SESSION_A]: [{ id: "legacy-1", text: "Préparer le multimètre" }],
    }),
    world,
  );
  assert.equal(isNotesDocumentV2(saved), true);
  if (!isNotesDocumentV2(saved)) return;
  assert.equal(saved.sessions[SESSION_A]?.[0]?.text, "Préparer le multimètre");
  const owned = await world.courseNotes.listNotesByOwner(TEACHER_A);
  assert.equal(owned.length, 1);
  assert.equal(owned[0]?.schoolYearId, YEAR_A);
  assert.equal(owned[0]?.annualCourseId, COURSE_A);
  assert.equal(owned[0]?.classId, "class-ma1");
  assert.equal(owned[0]?.contextId, "ctx-moteur");
  assert.equal(owned[0]?.ownerTeacherId, TEACHER_A);
  assert.equal(owned[0]?.authorTeacherId, TEACHER_A);
  assert.equal(owned[0]?.courseSessionKey, SESSION_A);
  assert.equal(owned[0]?.legacyNoteId, "legacy-1");
  assert.equal(owned[0]?.referenceSessionId, null);
  const leftover = await world.teacherNotes.getNotes(TEACHER_A);
  assert.ok(leftover && isNotesDocumentV2(leftover));
  assert.equal(Object.keys(leftover.sessions).length, 0);
});

test("PR3.4 — rich body strictement préservé", async () => {
  const world = memoryWorld();
  await seedCourses(world.courses);
  const body = fromPlainText("Liste:\n- multimètre\n- pince");
  const saved = await persistTeacherNotebookDocument(
    TEACHER_A,
    v2Doc({
      [SESSION_A]: [{ id: "rich-1", text: "extrait", body }],
    }),
    world,
  );
  assert.equal(isNotesDocumentV2(saved), true);
  if (!isNotesDocumentV2(saved)) return;
  assert.deepEqual(saved.sessions[SESSION_A]?.[0]?.body, body);
  const owned = await world.courseNotes.listNotesByOwner(TEACHER_A);
  assert.deepEqual(owned[0]?.body, body);
  assert.equal(owned[0]?.text, "extrait");
});

test("PR3.4 — conversion relancée aucun doublon + modification + suppression", async () => {
  const world = memoryWorld();
  await seedCourses(world.courses);
  const doc = v2Doc({
    [SESSION_A]: [{ id: "legacy-1", text: "Version 1" }],
  });
  await persistTeacherNotebookDocument(TEACHER_A, doc, world);
  await persistTeacherNotebookDocument(TEACHER_A, doc, world);
  assert.equal((await world.courseNotes.listNotesByOwner(TEACHER_A)).length, 1);

  await persistTeacherNotebookDocument(
    TEACHER_A,
    v2Doc({ [SESSION_A]: [{ id: "legacy-1", text: "Version 2" }] }),
    world,
  );
  const updated = await world.courseNotes.listNotesByOwner(TEACHER_A);
  assert.equal(updated.length, 1);
  assert.equal(updated[0]?.text, "Version 2");
  assert.equal(updated[0]?.legacyNoteId, "legacy-1");

  await persistTeacherNotebookDocument(TEACHER_A, v2Doc({}), world);
  assert.equal((await world.courseNotes.listNotesByOwner(TEACHER_A)).length, 0);
});

test("PR3.4 — V1 ambiguë, pendingWeeks, orphaned, session invalide restent legacy", async () => {
  const world = memoryWorld();
  await seedCourses(world.courses);
  const v1: ClassNotesDocument = {
    version: 1,
    weeks: { "setup-ma1:8": [{ id: "v1-1", text: "Note semaine" }] },
  };
  const afterV1 = await persistTeacherNotebookDocument(TEACHER_A, v1, world);
  assert.equal(isNotesDocumentV1(afterV1), true);
  assert.equal((await world.courseNotes.listNotesByOwner(TEACHER_A)).length, 0);
  const storedV1 = await world.teacherNotes.getNotes(TEACHER_A);
  assert.ok(storedV1 && isNotesDocumentV1(storedV1));
  assert.equal(storedV1.weeks["setup-ma1:8"]?.[0]?.text, "Note semaine");

  const mixed: ClassNotesDocument = {
    version: 2,
    sessions: {
      [SESSION_A]: [{ id: "ok-1", text: "Résolue" }],
      [SESSION_UNKNOWN]: [{ id: "miss-1", text: "Cours absent" }],
      [INVALID_KEY]: [{ id: "bad-1", text: "Clé invalide" }],
    },
    pendingWeeks: { "setup-ma1:9": [{ id: "pend-1", text: "Pending" }] },
    orphanedSessions: { [`${YEAR_A}|${COURSE_A}|1999-01-01`]: [{ id: "orph-1", text: "Orpheline" }] },
  };
  const after = await persistTeacherNotebookDocument(TEACHER_A, mixed, world);
  assert.equal(isNotesDocumentV2(after), true);
  if (!isNotesDocumentV2(after)) return;
  assert.equal(after.sessions[SESSION_A]?.[0]?.text, "Résolue");
  assert.equal(after.sessions[SESSION_UNKNOWN]?.[0]?.text, "Cours absent");
  assert.equal(after.sessions[INVALID_KEY]?.[0]?.text, "Clé invalide");
  assert.equal(after.pendingWeeks?.["setup-ma1:9"]?.[0]?.text, "Pending");
  assert.equal(after.orphanedSessions?.[`${YEAR_A}|${COURSE_A}|1999-01-01`]?.[0]?.text, "Orpheline");
  const owned = await world.courseNotes.listNotesByOwner(TEACHER_A);
  assert.equal(owned.length, 1);
  assert.equal(owned[0]?.legacyNoteId, "ok-1");
  const leftover = await world.teacherNotes.getNotes(TEACHER_A);
  assert.ok(leftover && isNotesDocumentV2(leftover));
  assert.equal(leftover.sessions[SESSION_A], undefined);
  assert.equal(leftover.pendingWeeks?.["setup-ma1:9"]?.[0]?.text, "Pending");
  assert.equal(leftover.orphanedSessions?.[`${YEAR_A}|${COURSE_A}|1999-01-01`]?.[0]?.text, "Orpheline");
});

test("PR3.4 — isolation professeurs et autres années / cours", async () => {
  const world = memoryWorld();
  await seedCourses(world.courses);
  await persistTeacherNotebookDocument(
    TEACHER_A,
    v2Doc({
      [SESSION_A]: [{ id: "a1", text: "Note A cours A" }],
      [SESSION_NEXT]: [{ id: "a-next", text: "Note A année suivante" }],
    }),
    world,
  );
  await persistTeacherNotebookDocument(
    TEACHER_B,
    v2Doc({
      [SESSION_A]: [{ id: "b1", text: "Note B privée" }],
    }),
    world,
  );
  await persistTeacherNotebookDocument(
    TEACHER_A,
    v2Doc({
      [SESSION_A]: [{ id: "a1", text: "Note A mise à jour" }],
      [SESSION_B]: [{ id: "a2", text: "Note A cours B" }],
      [SESSION_NEXT]: [{ id: "a-next", text: "Note A année suivante" }],
    }),
    world,
  );

  const notesA = await world.courseNotes.listNotesByOwner(TEACHER_A);
  const notesB = await world.courseNotes.listNotesByOwner(TEACHER_B);
  assert.equal(notesA.length, 3);
  assert.equal(notesB.length, 1);
  assert.equal(notesB[0]?.text, "Note B privée");
  assert.equal(notesA.find((note) => note.legacyNoteId === "a-next")?.schoolYearId, YEAR_B);
  assert.equal(notesA.find((note) => note.legacyNoteId === "a2")?.annualCourseId, COURSE_B);
  const loadedB = await loadTeacherNotebookDocument(TEACHER_B, world);
  assert.ok(loadedB && isNotesDocumentV2(loadedB));
  assert.equal(loadedB.sessions[SESSION_A]?.[0]?.text, "Note B privée");
  assert.equal(loadedB.sessions[SESSION_B], undefined);
});

test("PR3.4 — GET converge legacy V2 existant sans doublon", async () => {
  const world = memoryWorld();
  await seedCourses(world.courses);
  await world.teacherNotes.saveNotes(TEACHER_A, v2Doc({
    [SESSION_A]: [{ id: "pre-1", text: "Déjà en JSON" }],
  }));
  const first = await loadTeacherNotebookDocument(TEACHER_A, world);
  const second = await loadTeacherNotebookDocument(TEACHER_A, world);
  assert.ok(first && isNotesDocumentV2(first));
  assert.equal(first.sessions[SESSION_A]?.[0]?.text, "Déjà en JSON");
  assert.equal((await world.courseNotes.listNotesByOwner(TEACHER_A)).length, 1);
  assert.equal((await world.courseNotes.listNotesByOwner(TEACHER_A)).length, 1);
  assert.ok(second && isNotesDocumentV2(second));
  assert.equal(second.sessions[SESSION_A]?.length, 1);
});

test("PR3.4 — GET null si jamais enregistré", async () => {
  const world = memoryWorld();
  assert.equal(await loadTeacherNotebookDocument(TEACHER_A, world), null);
});

test("PR3.4 — copyNoteToNewYear ne copie pas courseSessionKey ni legacyNoteId", () => {
  const created = createAnnualCourseNote("src", {
    schoolYearId: YEAR_A,
    classId: "class-ma1",
    contextId: "ctx-moteur",
    authorTeacherId: TEACHER_A,
    ownerTeacherId: TEACHER_A,
    text: "Source",
    courseSessionKey: SESSION_A,
    legacyNoteId: "legacy-1",
    annualCourseId: COURSE_A,
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const copied = copyNoteToNewYear(created.value, {
    id: "copy",
    schoolYearId: YEAR_B,
    classId: "class-ma1-next",
    authorTeacherId: TEACHER_A,
  });
  assert.equal(copied.courseSessionKey, null);
  assert.equal(copied.legacyNoteId, null);
  assert.equal(copied.sourceNoteId, "src");
  assert.equal(copied.text, "Source");
  assert.equal(created.value.courseSessionKey, SESSION_A);
});

test("PR3.4 — Memory/SQLite parity + autosave + replay migration", async () => {
  const memory = memoryWorld();
  await seedCourses(memory.courses);
  const body = fromPlainText("Rich SQLite");
  const doc = v2Doc({
    [SESSION_A]: [{ id: "sql-1", text: "Texte", body }],
    [SESSION_UNKNOWN]: [{ id: "keep-1", text: "Legacy" }],
  });
  const memSaved = await persistTeacherNotebookDocument(TEACHER_A, doc, memory);
  await persistTeacherNotebookDocument(TEACHER_A, {
    ...doc,
    sessions: {
      ...doc.sessions,
      [SESSION_A]: [{ id: "sql-1", text: "Texte 2", body }],
    },
  } as ClassNotesDocument, memory);

  const db = createNodeSqliteDatabase(":memory:");
  await applyMigrations(db);
  await applyMigrations(db);
  await db
    .prepare("INSERT INTO teachers (id, display_name, initials, password_hash, is_admin) VALUES (?, ?, ?, ?, ?)")
    .bind(TEACHER_A, "Prof A", "PA", "x", 0)
    .run();
  const sqlWorld = {
    teacherNotes: new SqlTeacherNotesStore(db),
    courseNotes: new SqlAnnualCourseNotesStore(db),
    courses: memory.courses,
  };
  const sqlSaved = await persistTeacherNotebookDocument(TEACHER_A, doc, sqlWorld);
  await persistTeacherNotebookDocument(TEACHER_A, {
    ...doc,
    sessions: {
      ...doc.sessions,
      [SESSION_A]: [{ id: "sql-1", text: "Texte 2", body }],
    },
  } as ClassNotesDocument, sqlWorld);

  assert.equal(isNotesDocumentV2(memSaved), true);
  assert.equal(isNotesDocumentV2(sqlSaved), true);
  const memOwned = await memory.courseNotes.listNotesByOwner(TEACHER_A);
  const sqlOwned = await sqlWorld.courseNotes.listNotesByOwner(TEACHER_A);
  assert.equal(memOwned.length, 1);
  assert.equal(sqlOwned.length, 1);
  assert.equal(sqlOwned[0]?.text, "Texte 2");
  assert.deepEqual(sqlOwned[0]?.body, body);
  const leftover = await sqlWorld.teacherNotes.getNotes(TEACHER_A);
  assert.ok(leftover && isNotesDocumentV2(leftover));
  assert.equal(leftover.sessions[SESSION_UNKNOWN]?.[0]?.text, "Legacy");
  db.close();
});

test("PR3.4 — backup v4 colonnes + validation inconnue", () => {
  const cols = CAMPUS_BACKUP_COLUMNS.annual_course_notes.map((entry) => entry.name);
  assert.ok(cols.includes("body_json"));
  assert.ok(cols.includes("course_session_key"));
  assert.ok(cols.includes("owner_teacher_id"));
  assert.ok(cols.includes("legacy_note_id"));
  const projected = projectBackupRow("annual_course_notes", {
    id: "n1",
    school_year_id: "y",
    class_id: "c",
    context_id: "ctx",
    text: "ok",
    body_json: "{\"format\":\"campus-rich-v1\",\"blocks\":[]}",
    owner_teacher_id: TEACHER_A,
    legacy_note_id: "legacy-1",
    course_session_key: SESSION_A,
  });
  assert.equal(projected.ok, true);
  const unknown = projectBackupRow("annual_course_notes", {
    id: "n1",
    school_year_id: "y",
    class_id: "c",
    context_id: "ctx",
    text: "ok",
    unexpected: "nope",
  });
  assert.equal(unknown.ok, false);
});

test("PR3.4 — dump SQLite body_json + leftover teacher_notes", async () => {
  const db = createNodeSqliteDatabase(":memory:");
  await applyMigrations(db);
  const notes = new SqlAnnualCourseNotesStore(db);
  await notes.createNote("n1", {
    schoolYearId: "y",
    classId: "c",
    contextId: "ctx",
    authorTeacherId: TEACHER_A,
    ownerTeacherId: TEACHER_A,
    text: "Dump",
    body: fromPlainText("Corps dump"),
    courseSessionKey: SESSION_A,
    legacyNoteId: "legacy-dump",
    annualCourseId: COURSE_A,
  });
  const dump = await dumpCampusTables(db);
  const row = dump.annual_course_notes[0];
  assert.ok(row);
  assert.equal(row.text, "Dump");
  assert.equal(typeof row.body_json, "string");
  assert.match(String(row.body_json), /campus-rich-v1/);
  assert.equal(row.owner_teacher_id, TEACHER_A);
  assert.equal(row.legacy_note_id, "legacy-dump");
  db.close();
});

test("PR3.4 — backup v4 roundtrip Memory notes + leftover", async () => {
  const world = memoryWorld();
  await seedCourses(world.courses);
  const body = fromPlainText("Backup body");
  await persistTeacherNotebookDocument(
    TEACHER_A,
    v2Doc({
      [SESSION_A]: [{ id: "bak-1", text: "Backup", body }],
      [INVALID_KEY]: [{ id: "bak-legacy", text: "Reste JSON" }],
    }),
    world,
  );
  const exported = world.courseNotes.exportAllNotes();
  const clone = new MemoryAnnualCourseNotesStore();
  clone.replaceAllNotes(exported);
  const round = await clone.listNotesByOwner(TEACHER_A);
  assert.equal(round.length, 1);
  assert.deepEqual(round[0]?.body, body);
  const leftover = await world.teacherNotes.getNotes(TEACHER_A);
  assert.ok(leftover && isNotesDocumentV2(leftover));
  assert.equal(leftover.sessions[INVALID_KEY]?.[0]?.text, "Reste JSON");
});

test("PR3.4 — validate dump admin sans colonnes nouvelles (compat)", () => {
  const tables: CampusTableDump = {};
  for (const name of CAMPUS_BACKUP_INSERT_ORDER) tables[name] = [];
  tables.teachers = [
    {
      id: "admin-1",
      display_name: "Admin",
      initials: "Ad",
      password_hash: "x",
      is_admin: 1,
      is_active: 1,
    },
  ];
  const validated = validateCampusTables(tables);
  assert.equal(validated.ok, true, validated.ok ? "" : validated.reason);
});

test("PR3.4 — aucune exposition élève + API session", async () => {
  assert.equal(studentMayAccessCourseNotes(), false);
  const route = await readFile(new URL("../web/app/api/teacher/notes/route.ts", import.meta.url), "utf8");
  assert.match(route, /requireTeacherSession/);
  assert.match(route, /persistTeacherNotebookDocument/);
  assert.match(route, /loadTeacherNotebookDocument/);
  assert.doesNotMatch(route, /body\.teacherId/);
  const studentAgenda = await readFile(new URL("../web/app/api/agenda/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(studentAgenda, /loadTeacherNotebookDocument/);
  assert.doesNotMatch(studentAgenda, /listNotesByOwner/);
});

test("PR3.4 — split ne choisit pas un cours pour V1", async () => {
  const courses = new MemoryAnnualCourseStore();
  await seedCourses(courses);
  const split = await splitResolvableNotebookNotes(
    TEACHER_A,
    { version: 1, weeks: { "class-ma1:3": [{ id: "w1", text: "V1" }] } },
    courses,
  );
  assert.equal(split.resolved.length, 0);
  assert.equal(isNotesDocumentV1(split.leftover), true);
});
