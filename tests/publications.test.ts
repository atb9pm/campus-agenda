import assert from "node:assert/strict";
import test from "node:test";

import { DEMO_PROTOTYPE_ITEMS } from "../src/features/agenda/demo-items.ts";
import {
  canModifyPublication,
  createPublication,
  deletePublication,
  isAllowedPublicationType,
  updatePublication,
} from "../src/features/agenda/publications.ts";
import { TEACHER_DEMO_ID } from "../src/features/classes/index.ts";

/** Les publications de démonstration appartiennent au catalogue démo, pas au catalogue ChF. */
function firstItemOfDemoTeacher(skip = 0) {
  const item = DEMO_PROTOTYPE_ITEMS.filter((entry) => entry.authorTeacherId === TEACHER_DEMO_ID)[skip];
  assert.ok(item, `publication de démonstration #${skip} introuvable`);
  return item;
}

test("phase 0.4 — seuls Devoir, Contrôle et Information sont autorisés", () => {
  assert.equal(isAllowedPublicationType("HOMEWORK"), true);
  assert.equal(isAllowedPublicationType("TEST"), true);
  assert.equal(isAllowedPublicationType("INFORMATION"), true);
  assert.equal(isAllowedPublicationType("EXAM"), false);
});

test("phase 0.4 — seul l'auteur peut modifier ou supprimer", () => {
  const item = firstItemOfDemoTeacher();
  assert.equal(canModifyPublication(item, TEACHER_DEMO_ID), true);
  assert.equal(canModifyPublication(item, "teacher-demo-martin"), false);

  const deniedUpdate = updatePublication(DEMO_PROTOTYPE_ITEMS, item.id, "teacher-demo-martin", {
    title: "Titre usurpé",
  });
  assert.equal(deniedUpdate.ok, false);

  const deniedDelete = deletePublication(DEMO_PROTOTYPE_ITEMS, item.id, "teacher-demo-martin");
  assert.equal(deniedDelete.ok, false);
});

test("phase 0.4 — création d'une publication valide", () => {
  const created = createPublication(DEMO_PROTOTYPE_ITEMS, {
    id: 99,
    classroomId: "classe-demo-tma-2a",
    subjectId: "subject-demo-moteur-2a",
    authorTeacherId: TEACHER_DEMO_ID,
    day: 2,
    hour: 10,
    schoolWeekNumber: 12,
    type: "HOMEWORK",
    title: "  Révision culasse  ",
    detail: "",
  });

  assert.equal(created.length, DEMO_PROTOTYPE_ITEMS.length + 1);
  const added = created.at(-1);
  assert.ok(added);
  assert.equal(added.title, "Révision culasse");
  assert.equal(added.detail, "Aucune précision");
});

test("phase 0.4 — modification par l'auteur", () => {
  const item = firstItemOfDemoTeacher();
  const result = updatePublication(DEMO_PROTOTYPE_ITEMS, item.id, TEACHER_DEMO_ID, {
    title: "Injection électronique — mise à jour",
    detail: "Réviser les capteurs",
    hour: 14,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;

  const updated = result.items.find((entry) => entry.id === item.id);
  assert.ok(updated);
  assert.equal(updated.title, "Injection électronique — mise à jour");
  assert.equal(updated.detail, "Réviser les capteurs");
  assert.equal(updated.hour, 14);
  assert.equal(updated.authorTeacherId, TEACHER_DEMO_ID);
});

test("phase 0.4 — suppression par l'auteur", () => {
  const item = firstItemOfDemoTeacher(1);
  const result = deletePublication(DEMO_PROTOTYPE_ITEMS, item.id, TEACHER_DEMO_ID);

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.items.length, DEMO_PROTOTYPE_ITEMS.length - 1);
  assert.equal(result.items.some((entry) => entry.id === item.id), false);
});
