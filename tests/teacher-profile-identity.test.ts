import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  UNKNOWN_TEACHER_INITIALS,
  authenticatedTeacherFromSession,
  initialsFromDisplayName,
  profileDiscInitials,
} from "../src/features/auth-entry/index.ts";
import { APP_VERSION } from "../src/lib/app-version.ts";
import { SQL_MIGRATION_FILES } from "../src/lib/persistence/sql/migrate.ts";

const FRANCOIS = {
  teacherId: "teacher-chf",
  displayName: "François Cheseaux",
  initials: "ChF",
};

const DELEZE = {
  teacherId: "teacher-deleze",
  displayName: "Délèze Patrick",
  initials: "DP",
};

test("version 2.41.0 — identité enseignant depuis la session, pas de migration", async () => {
  assert.equal(APP_VERSION, "2.43.0");
  assert.equal(SQL_MIGRATION_FILES.at(-1), "0024_structured_agenda_bridge.sql");
  const page = await readFile(new URL("../web/app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /authenticatedTeacherFromSession/);
  assert.match(page, /profileDiscInitials\(authenticatedTeacher\)/);
  assert.match(page, /clearTeacherAuthIdentity/);
  assert.match(page, /fetchApiSession/);
  assert.doesNotMatch(page, /getTeacherById\(DEMO_CATALOG, currentTeacherId\)/);
  assert.doesNotMatch(page, /\?\? "FC"/);
  assert.doesNotMatch(page, /currentTeacher\?\.initials/);
});

test("session François → ChF, sans recréer les initiales", () => {
  const identity = authenticatedTeacherFromSession(FRANCOIS);
  assert.equal(identity.initials, "ChF");
  assert.equal(profileDiscInitials(identity), "ChF");
});

test("session Délèze Patrick → DP", () => {
  const identity = authenticatedTeacherFromSession(DELEZE);
  assert.equal(identity.teacherId, "teacher-deleze");
  assert.equal(profileDiscInitials(identity), "DP");
});

test("changement de compte : François, déconnexion, Délèze", () => {
  let shown = profileDiscInitials(authenticatedTeacherFromSession(FRANCOIS));
  assert.equal(shown, "ChF");
  shown = profileDiscInitials(null);
  assert.equal(shown, UNKNOWN_TEACHER_INITIALS);
  shown = profileDiscInitials(authenticatedTeacherFromSession(DELEZE));
  assert.equal(shown, "DP");
  assert.notEqual(shown, "ChF");
  assert.notEqual(shown, "FC");
});

test("fallback : initiales absentes → displayName, jamais FC constant", () => {
  const fromName = authenticatedTeacherFromSession({
    teacherId: "teacher-deleze",
    displayName: "Délèze Patrick",
    initials: "  ",
  });
  assert.equal(fromName.initials, "DP");
  assert.equal(profileDiscInitials(fromName), "DP");
  assert.equal(initialsFromDisplayName("Délèze Patrick"), "DP");
  assert.equal(initialsFromDisplayName(""), UNKNOWN_TEACHER_INITIALS);
  assert.equal(profileDiscInitials(null), "?");
  assert.notEqual(profileDiscInitials(null), "FC");
});

test("rechargement : l’identité se reconstruit depuis la session API", async () => {
  const page = await readFile(new URL("../web/app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /session\?\.kind === "teacher"/);
  assert.match(page, /applyTeacherSession\(session\)/);
  assert.match(page, /setAuthenticatedTeacher\(authenticatedTeacherFromSession\(session\)\)/);
});
