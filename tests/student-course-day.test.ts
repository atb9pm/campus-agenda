import assert from "node:assert/strict";
import test from "node:test";

import { DEMO_PROTOTYPE_ITEMS } from "../src/features/agenda/demo-items.ts";
import { resolveDisplayCourseDay } from "../src/features/calendar/index.ts";
import { DEMO_CATALOG } from "../src/features/classes/index.ts";
import {
  filterItemsForCourseDay,
  getStudentAgendaItems,
  groupItemsBySubject,
} from "../src/features/student/index.ts";
import { getSubjectsForClassroom } from "../src/features/classes/queries.ts";

test("phase 1.1 — l'élève voit les éléments du jour de cours par branche", () => {
  const slot = resolveDisplayCourseDay(new Date(2026, 10, 16, 12));
  const classroomId = "classe-demo-tma-2a";
  const items = filterItemsForCourseDay(getStudentAgendaItems(DEMO_PROTOTYPE_ITEMS, classroomId), slot);
  const groups = groupItemsBySubject(items, getSubjectsForClassroom(DEMO_CATALOG, classroomId));

  assert.equal(slot.dayIndex, 0);
  assert.ok(groups.some((group) => group.subject.name === "Châssis"));
  assert.ok(groups.some((group) => group.subject.name === "Atelier"));
  assert.ok(!groups.some((group) => group.subject.name === "Électricité"));
});

test("phase 1.1 — jeudi semaine B affiche les branches du jeudi", () => {
  const slot = resolveDisplayCourseDay(new Date(2026, 10, 19, 12));
  const classroomId = "classe-demo-tma-2a";
  const items = filterItemsForCourseDay(getStudentAgendaItems(DEMO_PROTOTYPE_ITEMS, classroomId), slot);
  const groups = groupItemsBySubject(items, getSubjectsForClassroom(DEMO_CATALOG, classroomId));

  assert.equal(slot.dayIndex, 3);
  assert.ok(groups.some((group) => group.subject.name === "Électricité"));
  assert.ok(groups.some((group) => group.subject.name === "Moteur"));
});
