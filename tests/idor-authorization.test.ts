process.env.AUTH_SECRET ??= "test-secret-idor-audit";

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createSessionToken, parseSessionToken } from "../src/lib/auth/session.ts";
import { getMemoryAgendaStore, resetMemoryAgendaStore } from "../src/lib/persistence/memory-store.ts";
import { DEMO_CURRENT_TEACHER_ID } from "../src/features/classes/index.ts";
import { getMemoryTeacherNotesStore, resetMemoryTeacherNotesStore } from "../src/lib/persistence/memory-teacher-notes-store.ts";
import { getMemoryTeacherSetupStore, resetMemoryTeacherSetupStore } from "../src/lib/persistence/memory-teacher-setup-store.ts";

const OTHER_TEACHER = "teacher-demo-martin";

async function readApi(rel: string): Promise<string> {
  return readFile(new URL(rel, import.meta.url), "utf8");
}

test("IDOR — professeur A ne peut pas modifier ni supprimer une publication de B", async () => {
  resetMemoryAgendaStore();
  const store = getMemoryAgendaStore();
  const item = await store.createAgendaItem({
    classroomId: "classe-demo-tma-2a",
    subjectId: "subject-demo-moteur-2a",
    authorTeacherId: DEMO_CURRENT_TEACHER_ID,
    day: 2,
    hour: 10,
    weekOffset: 0,
    schoolWeekNumber: 12,
    type: "HOMEWORK",
    title: "Devoir de A",
    detail: "Privé",
  });

  const stolenUpdate = await store.updateAgendaItem(item.id, OTHER_TEACHER, { title: "Usurpé" });
  assert.equal(stolenUpdate.ok, false);
  if (!stolenUpdate.ok) assert.equal(stolenUpdate.status, 403);

  const stolenDelete = await store.deleteAgendaItem(item.id, OTHER_TEACHER);
  assert.equal(stolenDelete.ok, false);
  if (!stolenDelete.ok) assert.equal(stolenDelete.status, 403);

  const own = await store.updateAgendaItem(item.id, DEMO_CURRENT_TEACHER_ID, { title: "Corrigé par A" });
  assert.equal(own.ok, true);
});

test("IDOR — notes et configuration sont toujours celles de la session", async () => {
  resetMemoryTeacherNotesStore();
  resetMemoryTeacherSetupStore();
  const notes = getMemoryTeacherNotesStore();
  const setups = getMemoryTeacherSetupStore();

  const sessionA = await parseSessionToken(await createSessionToken({
    kind: "teacher",
    teacherId: DEMO_CURRENT_TEACHER_ID,
    issuedAt: Date.now(),
  }));
  const sessionB = await parseSessionToken(await createSessionToken({
    kind: "teacher",
    teacherId: OTHER_TEACHER,
    issuedAt: Date.now(),
  }));
  assert.ok(sessionA && sessionB);
  assert.notEqual(sessionA.teacherId, sessionB.teacherId);

  await notes.saveNotes(sessionA.teacherId, {
    version: 1,
    weeks: { "classe-a:12": [{ id: "note-a", text: "Privé A" }] },
  });
  assert.ok(await notes.getNotes(sessionA.teacherId));
  assert.equal(await notes.getNotes(sessionB.teacherId), null);

  await setups.saveSetup(sessionA.teacherId, { version: 1, classes: [] });
  assert.ok(await setups.getSetup(sessionA.teacherId));
  assert.equal(await setups.getSetup(sessionB.teacherId), null);
});

test("IDOR — les routes mutantes recalculent teacherId depuis la session", async () => {
  const files = [
    "../web/app/api/teacher/notes/route.ts",
    "../web/app/api/teacher/setup/route.ts",
    "../web/app/api/teacher/courses/route.ts",
    "../web/app/api/teacher/course-timeline/route.ts",
    "../web/app/api/teacher/notebook-publications/route.ts",
    "../web/app/api/teacher/course-publications/route.ts",
    "../web/app/api/teacher/controls/route.ts",
    "../web/app/api/teacher/controls/[agendaItemId]/route.ts",
    "../web/app/api/agenda/route.ts",
    "../web/app/api/agenda/[id]/route.ts",
    "../web/app/api/library/templates/[id]/route.ts",
  ];
  for (const file of files) {
    const source = await readApi(file);
    assert.match(source, /requireTeacherSession/);
    assert.match(source, /auth\.session!\.teacherId|sessionTeacherIdFor/);
  }

  const notes = await readApi("../web/app/api/teacher/notes/route.ts");
  assert.doesNotMatch(notes, /body\.teacherId|candidate\.teacherId/);

  const agenda = await readApi("../web/app/api/agenda/route.ts");
  assert.match(agenda, /authorTeacherId: auth\.session!\.teacherId/);

  const courses = await readApi("../web/app/api/teacher/courses/route.ts");
  assert.match(courses, /teacherId fourni par le client est ignoré/);

  const notebook = await readApi("../web/app/api/teacher/notebook-publications/route.ts");
  assert.match(notebook, /teacherId = auth\.session!\.teacherId/);
  assert.doesNotMatch(notebook, /body\.teacherId|parsed\.teacherId|body\.authorTeacherId/);

  const publications = await readApi("../web/app/api/teacher/course-publications/route.ts");
  assert.match(publications, /teacherId: auth\.session!\.teacherId/);

  const controls = await readApi("../web/app/api/teacher/controls/[agendaItemId]/route.ts");
  assert.match(controls, /teacherId: auth\.session!\.teacherId/);
});
