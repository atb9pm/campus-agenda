import assert from "node:assert/strict";
import test from "node:test";

import { DEMO_PROTOTYPE_ITEMS } from "../src/features/agenda/demo-items.ts";
import { buildSchoolWeeks } from "../src/features/calendar/index.ts";
import { DEMO_CATALOG } from "../src/features/classes/index.ts";
import {
  evaluateThirdTestAlert,
  listUpcomingTestsForClass,
  listTestsOnCourseDay,
  TEST_ALERT_THRESHOLD,
} from "../src/features/evaluations/index.ts";
import { resolveDisplayCourseDay } from "../src/features/calendar/index.ts";

test("phase 2.4 — pas d'alerte pour le 1er et 2e contrôle du jour", () => {
  const items = DEMO_PROTOTYPE_ITEMS.filter((item) => !(item.type === "TEST" && item.schoolWeekNumber === 12 && item.day === 3));

  const first = evaluateThirdTestAlert(items, DEMO_CATALOG, {
    classroomId: "classe-demo-tma-2a",
    type: "TEST",
    courseDay: { schoolWeekNumber: 12, dayIndex: 3 },
  });
  assert.equal(first.triggered, false);

  const withOne = [
    ...items,
    {
      id: 9001,
      classroomId: "classe-demo-tma-2a",
      subjectId: "subject-demo-chassis-2a",
      authorTeacherId: "teacher-demo-dupont",
      day: 3,
      hour: 8,
      weekOffset: 0,
      schoolWeekNumber: 12,
      type: "TEST" as const,
      title: "Contrôle A",
      detail: "Test",
    },
  ];

  const second = evaluateThirdTestAlert(withOne, DEMO_CATALOG, {
    classroomId: "classe-demo-tma-2a",
    type: "TEST",
    courseDay: { schoolWeekNumber: 12, dayIndex: 3 },
  });
  assert.equal(second.triggered, false);
  assert.equal(second.existingTests.length, 1);
});

test("phase 2.4 — alerte au 3e contrôle même jour de cours", () => {
  const base = DEMO_PROTOTYPE_ITEMS.filter((item) => !(item.type === "TEST" && item.schoolWeekNumber === 12 && item.day === 3));
  const items = [
    ...base,
    {
      id: 9001,
      classroomId: "classe-demo-tma-2a",
      subjectId: "subject-demo-chassis-2a",
      authorTeacherId: "teacher-demo-dupont",
      day: 3,
      hour: 8,
      weekOffset: 0,
      schoolWeekNumber: 12,
      type: "TEST" as const,
      title: "Contrôle A",
      detail: "Test",
    },
    {
      id: 9002,
      classroomId: "classe-demo-tma-2a",
      subjectId: "subject-demo-moteur-2a",
      authorTeacherId: "teacher-demo-martin",
      day: 3,
      hour: 9,
      weekOffset: 0,
      schoolWeekNumber: 12,
      type: "TEST" as const,
      title: "Contrôle B",
      detail: "Test",
    },
  ];

  const alert = evaluateThirdTestAlert(items, DEMO_CATALOG, {
    classroomId: "classe-demo-tma-2a",
    type: "TEST",
    courseDay: { schoolWeekNumber: 12, dayIndex: 3 },
  });

  assert.equal(alert.triggered, true);
  assert.equal(alert.existingTests.length, TEST_ALERT_THRESHOLD - 1);
});

test("phase 2.4 — panneau élève limité à 8 contrôles à venir", () => {
  const weeks = buildSchoolWeeks();
  const fromSlot = resolveDisplayCourseDay(new Date(2026, 10, 16, 12), weeks);
  const classroomId = "classe-demo-tma-2a";

  const extraTests = Array.from({ length: 10 }, (_, index) => ({
    id: 9100 + index,
    classroomId,
    subjectId: "subject-demo-moteur-2a",
    authorTeacherId: "teacher-demo-current",
    day: index % 2 === 0 ? 0 : 3,
    hour: 8,
    weekOffset: 0,
    schoolWeekNumber: 13 + Math.floor(index / 2),
    type: "TEST" as const,
    title: `Contrôle ${index + 1}`,
    detail: "Test",
  }));

  const upcoming = listUpcomingTestsForClass(
    [...DEMO_PROTOTYPE_ITEMS, ...extraTests],
    DEMO_CATALOG,
    classroomId,
    fromSlot,
    weeks,
    8,
  );

  assert.equal(upcoming.length, 8);
  assert.ok(upcoming.every((entry) => entry.item.type === "TEST"));
});

test("phase 2.4 — liste des contrôles par jour de cours", () => {
  const tests = listTestsOnCourseDay(DEMO_PROTOTYPE_ITEMS, "classe-demo-tma-2a", {
    schoolWeekNumber: 12,
    dayIndex: 3,
  });
  assert.equal(tests.length, 1);
  assert.equal(tests[0]?.title, "Injection électronique");
});
