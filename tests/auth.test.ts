import assert from "node:assert/strict";
import test from "node:test";

// Le mot de passe de démonstration est refusé par défaut : les tests l'autorisent.
process.env.CAMPUS_ALLOW_DEMO_PASSWORD ??= "1";

import { canReadClassroomAgenda } from "../src/lib/auth/permissions.ts";
import { buildSessionCookie, createSessionToken, parseSessionToken, readSessionTokenFromRequest } from "../src/lib/auth/session.ts";
import {
  AUTH_SECRET_MIN_BYTES,
  AUTH_SECRET_MISSING_PRODUCTION,
  AUTH_SECRET_WEAK_PRODUCTION,
  DEV_FALLBACK_AUTH_SECRET,
  assertProductionAuthSecret,
  authSecretByteLength,
  DEMO_TEACHER_PASSWORD,
  getAuthSecret,
  isDemoTeacherPassword,
} from "../src/lib/auth/config.ts";
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

test("AUTH_SECRET — production refuse l’absence, le secret trop court, accepte un secret fort", () => {
  const previousSecret = process.env.AUTH_SECRET;
  const previousEnv = process.env.NODE_ENV;
  const strong = "a".repeat(AUTH_SECRET_MIN_BYTES);
  try {
    process.env.NODE_ENV = "production";
    delete process.env.AUTH_SECRET;
    assert.throws(() => getAuthSecret(), (error: Error) => {
      assert.equal(error.message, AUTH_SECRET_MISSING_PRODUCTION);
      assert.equal(error.message.includes("undefined"), false);
      return true;
    });
    assert.throws(() => assertProductionAuthSecret(undefined), /requis en production/);

    process.env.AUTH_SECRET = "1234";
    assert.equal(authSecretByteLength("1234"), 4);
    assert.throws(() => getAuthSecret(), (error: Error) => {
      assert.equal(error.message, AUTH_SECRET_WEAK_PRODUCTION);
      assert.equal(error.message.includes("1234"), false);
      return true;
    });

    process.env.AUTH_SECRET = strong;
    assert.equal(getAuthSecret(), strong);
    assert.equal(assertProductionAuthSecret(strong), strong);
  } finally {
    if (previousSecret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = previousSecret;
    if (previousEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnv;
  }
});

test("AUTH_SECRET — hors production conserve une valeur fictive si absent", () => {
  const previousSecret = process.env.AUTH_SECRET;
  const previousEnv = process.env.NODE_ENV;
  try {
    delete process.env.AUTH_SECRET;
    process.env.NODE_ENV = "development";
    assert.equal(getAuthSecret(), DEV_FALLBACK_AUTH_SECRET);
    process.env.NODE_ENV = "test";
    assert.equal(getAuthSecret(), DEV_FALLBACK_AUTH_SECRET);
    process.env.AUTH_SECRET = "local-short";
    assert.equal(getAuthSecret(), "local-short");
  } finally {
    if (previousSecret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = previousSecret;
    if (previousEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnv;
  }
});

test("phase 0.7 — cookie de session extrait de la requête", async () => {
  const token = await createSessionToken({
    kind: "student",
    accessId: "student-access-demo-2a",
    accessVersion: 1,
    classroomId: "classe-demo-tma-2a",
    schoolClassId: "school-class-ma2",
    schoolYearId: "year-active-test",
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
    accessVersion: 1,
    classroomId: "classe-demo-tma-2a",
    schoolClassId: "school-class-ma2",
    schoolYearId: "year-active-test",
    label: "eleve-test-001",
    issuedAt: Date.now(),
  });
  const parsed = await parseSessionToken(session);
  assert.equal(await canReadClassroomAgenda(parsed, "classe-demo-tma-2a", store), true);
  assert.equal(await canReadClassroomAgenda(parsed, "classe-demo-tma-1a", store), false);
});
