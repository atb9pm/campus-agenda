import assert from "node:assert/strict";
import test from "node:test";

import { DEMO_PROTOTYPE_ITEMS } from "../src/features/agenda/demo-items.ts";
import { buildSchoolWeeks } from "../src/features/calendar/index.ts";
import { DEMO_CATALOG } from "../src/features/classes/index.ts";
import {
  evaluateControlCoordination,
  evaluateThirdTestAlert,
  listUpcomingTestsForClass,
  listTestsOnCourseDay,
  TEST_ALERT_THRESHOLD,
  confirmationRequiredForExistingTests,
  gateControlCoordination,
  CONTROL_COORDINATION_CONFIRM_CODE,
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

test("coordination unique — seuil 3, HOMEWORK/INFORMATION ignorés, charge professeur", () => {
  assert.equal(TEST_ALERT_THRESHOLD, 3);
  assert.equal(confirmationRequiredForExistingTests(0), false);
  assert.equal(confirmationRequiredForExistingTests(1), false);
  assert.equal(confirmationRequiredForExistingTests(2), true);

  const catalog = {
    classrooms: [
      { id: "c-ma2a", name: "MA2A" },
      { id: "c-ma2b", name: "MA2B" },
    ],
    subjects: [
      { id: "s-moteur", name: "Moteur" },
      { id: "s-elec", name: "Électricité" },
    ],
    teachers: [{ id: "t1", displayName: "F. Martin" }],
  };
  function testItem(id: number, classroomId: string, day: number, type: "TEST" | "HOMEWORK" | "INFORMATION" = "TEST") {
    return {
      id,
      classroomId,
      subjectId: "s-moteur",
      authorTeacherId: "t1",
      day,
      hour: 8,
      weekOffset: 0,
      schoolWeekNumber: 12,
      type,
      title: `Item ${id}`,
      detail: "",
      schoolYearId: "year-2026",
    };
  }

  const homework = evaluateControlCoordination({
    type: "HOMEWORK",
    items: [testItem(1, "c-ma2a", 3), testItem(2, "c-ma2a", 3)],
    classroomId: "c-ma2a",
    courseDay: { schoolWeekNumber: 12, dayIndex: 3 },
    teacherId: "t1",
    teacherWeekClassroomIds: ["c-ma2a", "c-ma2b"],
    schoolYearId: "year-2026",
    includeUnscopedYearItems: true,
    catalog,
  });
  assert.equal(homework.confirmationRequired, false);
  assert.equal(homework.classDayCount, 0);

  const information = evaluateControlCoordination({
    type: "INFORMATION",
    items: [testItem(1, "c-ma2a", 3), testItem(2, "c-ma2a", 3)],
    classroomId: "c-ma2a",
    courseDay: { schoolWeekNumber: 12, dayIndex: 3 },
    teacherId: "t1",
    teacherWeekClassroomIds: ["c-ma2a", "c-ma2b"],
    schoolYearId: "year-2026",
    includeUnscopedYearItems: true,
    catalog,
  });
  assert.equal(information.confirmationRequired, false);

  const zero = evaluateControlCoordination({
    type: "TEST",
    items: [],
    classroomId: "c-ma2a",
    courseDay: { schoolWeekNumber: 12, dayIndex: 3 },
    teacherId: "t1",
    teacherWeekClassroomIds: ["c-ma2a", "c-ma2b"],
    schoolYearId: "year-2026",
    includeUnscopedYearItems: true,
    catalog,
  });
  assert.equal(zero.confirmationRequired, false);
  assert.equal(gateControlCoordination(zero, false).ok, true);

  const one = evaluateControlCoordination({
    type: "TEST",
    items: [testItem(1, "c-ma2a", 3)],
    classroomId: "c-ma2a",
    courseDay: { schoolWeekNumber: 12, dayIndex: 3 },
    teacherId: "t1",
    teacherWeekClassroomIds: ["c-ma2a", "c-ma2b"],
    schoolYearId: "year-2026",
    includeUnscopedYearItems: true,
    catalog,
  });
  assert.equal(one.confirmationRequired, false);
  assert.equal(one.classDayCount, 1);

  const two = evaluateControlCoordination({
    type: "TEST",
    items: [
      testItem(1, "c-ma2a", 3),
      testItem(2, "c-ma2a", 3, "TEST"),
      testItem(3, "c-ma2b", 3),
      testItem(4, "c-ma2a", 1),
      testItem(5, "c-ma2a", 3, "HOMEWORK"),
    ],
    classroomId: "c-ma2a",
    courseDay: { schoolWeekNumber: 12, dayIndex: 3 },
    teacherId: "t1",
    teacherWeekClassroomIds: ["c-ma2a", "c-ma2b"],
    schoolYearId: "year-2026",
    includeUnscopedYearItems: true,
    catalog,
  });
  assert.equal(two.classDayCount, 2);
  assert.equal(two.confirmationRequired, true);
  assert.equal(two.teacherWeekCount, 4);
  const blocked = gateControlCoordination(two, false);
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.code, CONTROL_COORDINATION_CONFIRM_CODE);
  assert.equal(gateControlCoordination(two, true).ok, true);
});

