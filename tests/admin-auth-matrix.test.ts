import assert from "node:assert/strict";
import test from "node:test";

process.env.AUTH_SECRET ??= "test-secret-stabilization-226";
process.env.CAMPUS_ALLOW_DEMO_PASSWORD ??= "1";

import { parseSessionToken, createSessionToken } from "../src/lib/auth/session.ts";
import { revalidateLiveSession } from "../src/lib/auth/session-live.ts";
import { DEMO_CURRENT_TEACHER_ID } from "../src/features/classes/index.ts";
import { getMemoryTeacherAccountStore, resetMemoryTeacherAccountStore } from "../src/lib/persistence/memory-teacher-account-store.ts";
import { getMemoryAgendaStore, resetMemoryAgendaStore } from "../src/lib/persistence/memory-store.ts";
import { removeMemoryStudentAccess, resetMemoryLegacySchool } from "../src/lib/persistence/memory-legacy-school.ts";

const NON_ADMIN = "teacher-demo-martin";

function resetAuthWorld() {
  resetMemoryTeacherAccountStore();
  resetMemoryAgendaStore();
  resetMemoryLegacySchool();
}

test("token malformé → null, jamais d'exception", async () => {
  assert.equal(await parseSessionToken("not-a-token"), null);
  assert.equal(await parseSessionToken("aaa.bbb"), null);
  assert.equal(await parseSessionToken("@@@.@@@"), null);
  assert.equal(await parseSessionToken("eyJhbGciOiJIUzI1NiJ9.%%%"), null);
  assert.equal(await parseSessionToken(""), null);
  assert.equal(await parseSessionToken(null), null);
});

test("session enseignant révoquée après désactivation", async () => {
  resetAuthWorld();
  const session = await createSessionToken({
    kind: "teacher",
    teacherId: NON_ADMIN,
    issuedAt: Date.now(),
  }).then((token) => parseSessionToken(token));
  assert.ok(session);

  const accounts = getMemoryTeacherAccountStore();
  const store = getMemoryAgendaStore();
  const lookup = {
    findAccount: (id: string) => accounts.findAccount(id),
    findStudentAccessById: (id: string) => store.findStudentAccessById(id),
  };
  assert.ok(await revalidateLiveSession(session!, lookup));

  const result = await accounts.updateAccount(NON_ADMIN, { isActive: false });
  assert.equal(result.ok, true);
  assert.equal(await revalidateLiveSession(session!, lookup), null);
});

test("session enseignant révoquée après archivage", async () => {
  resetAuthWorld();
  const session = {
    kind: "teacher" as const,
    teacherId: NON_ADMIN,
    issuedAt: Date.now(),
  };
  const accounts = getMemoryTeacherAccountStore();
  const store = getMemoryAgendaStore();
  const lookup = {
    findAccount: (id: string) => accounts.findAccount(id),
    findStudentAccessById: (id: string) => store.findStudentAccessById(id),
  };
  await accounts.updateAccount(NON_ADMIN, { isArchived: true });
  assert.equal(await revalidateLiveSession(session, lookup), null);
});

test("session élève révoquée après suppression de l'accès", async () => {
  resetAuthWorld();
  const session = {
    kind: "student" as const,
    accessId: "student-access-demo-2a",
    classroomId: "classe-demo-tma-2a",
    label: "eleve-test-001",
    issuedAt: Date.now(),
  };
  const accounts = getMemoryTeacherAccountStore();
  const store = getMemoryAgendaStore();
  const lookup = {
    findAccount: (id: string) => accounts.findAccount(id),
    findStudentAccessById: (id: string) => store.findStudentAccessById(id),
  };
  assert.ok(await revalidateLiveSession(session, lookup));
  assert.equal(removeMemoryStudentAccess("student-access-demo-2a"), true);
  assert.equal(await revalidateLiveSession(session, lookup), null);
});

test("un administrateur actif reste revalidé", async () => {
  resetAuthWorld();
  const session = {
    kind: "teacher" as const,
    teacherId: DEMO_CURRENT_TEACHER_ID,
    issuedAt: Date.now(),
  };
  const accounts = getMemoryTeacherAccountStore();
  const store = getMemoryAgendaStore();
  const live = await revalidateLiveSession(session, {
    findAccount: (id) => accounts.findAccount(id),
    findStudentAccessById: (id) => store.findStudentAccessById(id),
  });
  assert.equal(live?.kind, "teacher");
});
