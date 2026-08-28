import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_LOGIN_TAB,
  normalizeStudentCode,
  normalizeTeacherInitials,
  readClassCodeFromQuery,
} from "../src/features/auth-entry/index.ts";
import {
  REMEMBERED_SESSION_TTL_MS,
  SESSION_TTL_MS,
  buildSessionCookie,
  createSessionToken,
  parseSessionToken,
  sessionTtlMs,
} from "../src/lib/auth/session.ts";
import { getMemoryAgendaStore } from "../src/lib/persistence/memory-store.ts";

test("page d'entrée — l'onglet élève est proposé par défaut", () => {
  assert.equal(DEFAULT_LOGIN_TAB, "student");
});

test("lien de classe — ?classe=MA2 est reconnu et normalisé", () => {
  assert.equal(readClassCodeFromQuery("?classe=eleve-ma2"), "eleve-ma2");
  assert.equal(readClassCodeFromQuery("?classe=%20ELEVE-MA2%20"), "eleve-ma2");
  assert.equal(readClassCodeFromQuery("classe=eleve-ma2"), "eleve-ma2");
  assert.equal(readClassCodeFromQuery("?class=eleve-mma3a"), "eleve-mma3a");
  assert.equal(readClassCodeFromQuery("?autre=1"), null);
  assert.equal(readClassCodeFromQuery("?classe="), null);
  assert.equal(readClassCodeFromQuery(""), null);
});

test("saisies — code en minuscules, initiales inchangées", () => {
  assert.equal(normalizeStudentCode("  ELEVE-MA2 "), "eleve-ma2");
  assert.equal(normalizeTeacherInitials("  ChF "), "ChF");
});

test("session — durée courte par défaut, longue si l'appareil est mémorisé", async () => {
  assert.equal(sessionTtlMs(false), SESSION_TTL_MS);
  assert.equal(sessionTtlMs(true), REMEMBERED_SESSION_TTL_MS);
  assert.ok(REMEMBERED_SESSION_TTL_MS > SESSION_TTL_MS * 24);

  const short = buildSessionCookie("jeton", false);
  const long = buildSessionCookie("jeton", true);
  assert.match(short, new RegExp(`Max-Age=${SESSION_TTL_MS / 1000}\\b`));
  assert.match(long, new RegExp(`Max-Age=${REMEMBERED_SESSION_TTL_MS / 1000}\\b`));
  assert.ok(short.includes("HttpOnly") && long.includes("HttpOnly"));

  const token = await createSessionToken({ kind: "teacher", teacherId: "teacher-chf", issuedAt: Date.now() }, true);
  const parsed = await parseSessionToken(token);
  assert.equal(parsed?.kind, "teacher");
});

test("connexion enseignant — les initiales résolvent le compte, sensibilité à la casse exclue", async () => {
  const store = getMemoryAgendaStore();

  assert.equal(await store.findTeacherIdByInitials("ChF"), "teacher-chf");
  assert.equal(await store.findTeacherIdByInitials("chf"), "teacher-chf");
  assert.equal(await store.findTeacherIdByInitials("  CHF  "), "teacher-chf");
  assert.equal(await store.findTeacherIdByInitials("inconnu"), undefined);
  assert.equal(await store.findTeacherIdByInitials(""), undefined);
});
