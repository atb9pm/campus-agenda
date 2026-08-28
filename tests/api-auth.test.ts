import assert from "node:assert/strict";
import test from "node:test";

import { buildSessionCookie, createSessionToken, parseSessionToken, readSessionTokenFromRequest } from "../src/lib/auth/session.ts";
import { canReadClassroomAgenda } from "../src/lib/auth/permissions.ts";
import { DEMO_TEACHER_PASSWORD } from "../src/lib/auth/config.ts";
import { resetMemoryAgendaStore, getMemoryAgendaStore } from "../src/lib/persistence/memory-store.ts";
import { DEMO_CURRENT_TEACHER_ID } from "../src/features/classes/index.ts";

process.env.AUTH_SECRET ??= "test-secret-api-phase-07";
// Le mot de passe de démonstration est refusé par défaut : les tests l'autorisent.
process.env.CAMPUS_ALLOW_DEMO_PASSWORD ??= "1";

test("phase 0.7 — flux élève : session signée puis lecture agenda", async () => {
  resetMemoryAgendaStore();
  const store = getMemoryAgendaStore();
  const access = await store.resolveStudentAccess("eleve-test-001");
  assert.ok(access);

  const token = await createSessionToken({
    kind: "student",
    accessId: access.id,
    classroomId: access.classroomId,
    label: access.label,
    issuedAt: Date.now(),
  });
  const request = new Request("http://localhost/api/agenda?classroomId=classe-demo-tma-2a", {
    headers: { cookie: buildSessionCookie(token) },
  });
  const extracted = readSessionTokenFromRequest(request);
  assert.ok(extracted);
  const session = await parseSessionToken(extracted);
  assert.ok(session);
  assert.equal(await canReadClassroomAgenda(session, access.classroomId, store), true);

  const items = await store.listAgendaItems(access.classroomId);
  assert.ok(items.length >= 5);
});

test("phase 0.7 — flux enseignant : création et droits auteur", async () => {
  resetMemoryAgendaStore();
  const store = getMemoryAgendaStore();
  assert.equal(await store.verifyTeacherCredentials(DEMO_CURRENT_TEACHER_ID, DEMO_TEACHER_PASSWORD), true);

  const token = await createSessionToken({
    kind: "teacher",
    teacherId: DEMO_CURRENT_TEACHER_ID,
    issuedAt: Date.now(),
  });
  const session = await parseSessionToken(token);
  assert.equal(session?.kind, "teacher");

  const created = await store.createAgendaItem({
    classroomId: "classe-demo-tma-2a",
    subjectId: "subject-demo-moteur-2a",
    authorTeacherId: DEMO_CURRENT_TEACHER_ID,
    day: 2,
    hour: 11,
    weekOffset: 0,
    schoolWeekNumber: 12,
    type: "HOMEWORK",
    title: "API création",
    detail: "Serveur",
  });
  assert.equal(created.title, "API création");

  const updated = await store.updateAgendaItem(created.id, DEMO_CURRENT_TEACHER_ID, { title: "API modifiée" });
  assert.equal(updated.ok, true);

  const denied = await store.updateAgendaItem(created.id, "teacher-demo-martin", { title: "Hack" });
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.status, 403);

  const deleted = await store.deleteAgendaItem(created.id, DEMO_CURRENT_TEACHER_ID);
  assert.equal(deleted.ok, true);
});
