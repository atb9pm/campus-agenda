import assert from "node:assert/strict";
import test from "node:test";

import { DEMO_PROTOTYPE_ITEMS } from "../src/features/agenda/demo-items.ts";
import { DEMO_CATALOG } from "../src/features/classes/index.ts";
import {
  anonymizeAuthorForStudent,
  buildStudentAgendaSummary,
  canStudentModifyAgenda,
  findStudentAccessForClassroom,
  getStudentAgendaItems,
  resolveStudentAccess,
  STUDENT_AUTHOR_LABEL,
} from "../src/features/student/index.ts";

test("phase 0.6 — accès élève par code anonyme fictif", () => {
  const access = resolveStudentAccess(DEMO_CATALOG, " eleve-test-001 ");
  assert.ok(access);
  assert.equal(access.classroomId, "classe-demo-tma-2a");
  assert.match(access.label, /^eleve-test-/);
  assert.equal(resolveStudentAccess(DEMO_CATALOG, "code-invalide"), undefined);
});

test("phase 0.6 — l'élève voit l'agenda complet de sa classe", () => {
  const access = findStudentAccessForClassroom(DEMO_CATALOG, "classe-demo-tma-2a");
  assert.ok(access);

  const agenda = getStudentAgendaItems(DEMO_PROTOTYPE_ITEMS, access.classroomId);
  assert.equal(agenda.length, 7);
  assert.ok(agenda.some((item) => item.authorTeacherId === "teacher-demo-dupont"));
  assert.ok(agenda.some((item) => item.authorTeacherId === "teacher-demo-martin"));
});

test("phase 0.6 — consultation anonyme sans droits de modification", () => {
  assert.equal(canStudentModifyAgenda(), false);
  assert.equal(anonymizeAuthorForStudent("teacher-demo-dupont"), STUDENT_AUTHOR_LABEL);
  assert.equal(anonymizeAuthorForStudent("teacher-demo-current"), STUDENT_AUTHOR_LABEL);
  assert.doesNotMatch(anonymizeAuthorForStudent("teacher-demo-dupont"), /Dupont/i);
});

test("phase 0.6 — synthèse de charge lisible par l'élève", () => {
  const items = getStudentAgendaItems(DEMO_PROTOTYPE_ITEMS, "classe-demo-tma-2a");
  const summary = buildStudentAgendaSummary(items);

  assert.equal(summary.total, 7);
  assert.equal(summary.homework, 2);
  assert.equal(summary.test, 3);
  assert.equal(summary.information, 2);
  assert.equal(summary.branches, 5);
});
