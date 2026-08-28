import assert from "node:assert/strict";
import test from "node:test";

import { canReadClassroomAgenda } from "../src/lib/auth/permissions.ts";
import { buildSessionCookie, createSessionToken, parseSessionToken, readSessionTokenFromRequest } from "../src/lib/auth/session.ts";
import { DEMO_TEACHER_PASSWORD, isDemoTeacherPassword } from "../src/lib/auth/config.ts";
import { getMemoryAgendaStore, resetMemoryAgendaStore } from "../src/lib/persistence/memory-store.ts";
import { DEMO_CURRENT_TEACHER_ID } from "../src/features/classes/index.ts";

test("phase 0.7 — session signée avec AUTH_SECRET de développement", async () => {
  process.env.AUTH_SECRET ??= "test-secret-phase-07";
  const token = await createSessionToken({
    kind: "teacher",
    teacherId: DEMO_CURRENT_TEACHER_ID,
    issuedAt: Date.now(),
  });
  const session = await parseSessionToken(token);
  assert.ok(session);
  assert.equal(session?.kind, "teacher");
});

test("phase 0.7 — cookie de session extrait de la requête", async () => {
  const token = await createSessionToken({
    kind: "student",
    accessId: "student-access-demo-2a",
    classroomId: "classe-demo-tma-2a",
    label: "eleve-test-001",
    issuedAt: Date.now(),
  });
  const request = new Request("http://localhost/", {
    headers: { cookie: buildSessionCookie(token) },
  });
  const extracted = readSessionTokenFromRequest(request);
  assert.ok(extracted);
  const session = await parseSessionToken(extracted);
  assert.equal(session?.kind, "student");
});

test("phase 0.7 — mot de passe de démonstration documenté", () => {
  assert.equal(isDemoTeacherPassword(DEMO_TEACHER_PASSWORD), true);
  assert.equal(isDemoTeacherPassword(" campus-demo "), true);
  assert.equal(isDemoTeacherPassword("secret-réel"), false);
});

test("porte d'entrée unique — plus de verrou d'accueil séparé", async () => {
  const config = await import("../src/lib/auth/config.ts");
  assert.equal("isSiteGatePassword" in config, false);
  assert.equal("SITE_GATE_PASSWORD" in config, false);
});

test("phase 0.7 — store mémoire contrôle l'accès enseignant", async () => {
  resetMemoryAgendaStore();
  const store = getMemoryAgendaStore();
  assert.equal(await store.verifyTeacherCredentials(DEMO_CURRENT_TEACHER_ID, DEMO_TEACHER_PASSWORD), true);
  assert.equal(await store.teacherCanAccessClassroom(DEMO_CURRENT_TEACHER_ID, "classe-chf-ma2"), true);
  assert.equal(await store.teacherCanPublish(DEMO_CURRENT_TEACHER_ID, "classe-chf-ma2", "subject-chf-ma2-cp1"), true);

  const created = await store.createAgendaItem({
    classroomId: "classe-chf-ma2",
    subjectId: "subject-chf-ma2-cp1",
    authorTeacherId: DEMO_CURRENT_TEACHER_ID,
    day: 2,
    hour: 15,
    weekOffset: 0,
    schoolWeekNumber: 12,
    type: "HOMEWORK",
    title: "Persistance démo",
    detail: "Via store",
  });
  assert.equal(created.title, "Persistance démo");

  const denied = await store.updateAgendaItem(created.id, "teacher-demo-martin", { title: "Usurpé" });
  assert.equal(denied.ok, false);
});

test("phase 1.0 — permissions de lecture classe asynchrones", async () => {
  resetMemoryAgendaStore();
  const store = getMemoryAgendaStore();
  const session = await createSessionToken({
    kind: "student",
    accessId: "student-access-demo-2a",
    classroomId: "classe-demo-tma-2a",
    label: "eleve-test-001",
    issuedAt: Date.now(),
  });
  const parsed = await parseSessionToken(session);
  assert.equal(await canReadClassroomAgenda(parsed, "classe-demo-tma-2a", store), true);
  assert.equal(await canReadClassroomAgenda(parsed, "classe-demo-tma-1a", store), false);
});
