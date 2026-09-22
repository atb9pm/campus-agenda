import assert from "node:assert/strict";
import test from "node:test";

import { DEMO_PROTOTYPE_ITEMS, type PrototypeAgendaItem } from "../src/features/agenda/demo-items.ts";
import { UNDEFINED_BRANCH_LABEL } from "../src/features/agenda-bridge/index.ts";
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

function itemForSubject(subjectId: string, title: string): PrototypeAgendaItem {
  return {
    id: 8801,
    classroomId: "classroom-school-cl-1",
    subjectId,
    authorTeacherId: "teacher-1",
    day: 0,
    hour: 8,
    weekOffset: 0,
    schoolWeekNumber: 7,
    type: "TEST",
    title,
    detail: "Révision 1re année",
  };
}

test("vue élève — le nom de branche maître est conservé tel quel", () => {
  const subjectId = "subject-course-ac-1788245202770-m0hhz64";
  const groups = groupItemsBySubject(
    [itemForSubject(subjectId, "Transmission")],
    [{
      id: subjectId,
      classroomId: "classroom-school-cl-1",
      name: "CP Léger Injection, dépollution",
    }],
  );

  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.subject.name, "CP Léger Injection, dépollution");
  assert.notEqual(groups[0]?.subject.name, groups[0]?.items[0]?.title);
});

test("vue élève — un identifiant subject-course-* n’est jamais affiché", () => {
  const subjectId = "subject-course-ac-1788201895481-a0fjgc6";
  const groups = groupItemsBySubject(
    [itemForSubject(subjectId, "Moteur")],
    [{
      id: subjectId,
      classroomId: "classroom-school-cl-1",
      name: subjectId,
    }],
  );

  assert.equal(groups[0]?.subject.name, UNDEFINED_BRANCH_LABEL);
  assert.ok(!groups.some((group) => group.subject.name.startsWith("subject-course-")));
});
