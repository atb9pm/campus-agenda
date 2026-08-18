import assert from "node:assert/strict";
import test from "node:test";

import { DEMO_PROTOTYPE_ITEMS } from "../src/features/agenda/demo-items.ts";
import {
  ALL_FILTER,
  applySharedAgendaFilters,
  buildClassWorkloadSummary,
  createDefaultSharedAgendaFilters,
  filterItemsForDisplayedWeek,
  WORKLOAD_LEVEL_LABELS,
} from "../src/features/agenda/shared-agenda.ts";
import { DEMO_CATALOG } from "../src/features/classes/index.ts";

test("phase 0.5 — la vue Toute la classe inclut tous les enseignants", () => {
  const filters = createDefaultSharedAgendaFilters(0);
  const visible = applySharedAgendaFilters(
    DEMO_PROTOTYPE_ITEMS.filter((item) => item.classroomId === "classe-demo-tma-2a"),
    DEMO_CATALOG,
    filters,
  );

  assert.equal(visible.length, 5);
  assert.ok(visible.some((item) => item.authorTeacherId === "teacher-demo-dupont"));
  assert.ok(visible.some((item) => item.authorTeacherId === "teacher-demo-martin"));
});

test("phase 0.5 — filtres par branche, type, enseignant et jour", () => {
  const classroomItems = DEMO_PROTOTYPE_ITEMS.filter((item) => item.classroomId === "classe-demo-tma-2a");

  const bySubject = applySharedAgendaFilters(classroomItems, DEMO_CATALOG, {
    ...createDefaultSharedAgendaFilters(0),
    subjectName: "Moteur",
  });
  assert.equal(bySubject.length, 2);

  const byType = applySharedAgendaFilters(classroomItems, DEMO_CATALOG, {
    ...createDefaultSharedAgendaFilters(0),
    type: "TEST",
  });
  assert.equal(byType.length, 1);

  const byTeacher = applySharedAgendaFilters(classroomItems, DEMO_CATALOG, {
    ...createDefaultSharedAgendaFilters(0),
    teacherId: "teacher-demo-dupont",
  });
  assert.equal(byTeacher.length, 2);

  const byDay = applySharedAgendaFilters(classroomItems, DEMO_CATALOG, {
    ...createDefaultSharedAgendaFilters(0),
    day: 3,
  });
  assert.equal(byDay.length, 2);
  assert.ok(byDay.some((item) => item.title === "Injection électronique"));
});

test("phase 0.5 — filtre par semaine affichée", () => {
  const items = [
    ...DEMO_PROTOTYPE_ITEMS,
    {
      id: 99,
      classroomId: "classe-demo-tma-2a",
      subjectId: "subject-demo-moteur-2a",
      authorTeacherId: "teacher-demo-current",
      day: 0,
      hour: 8,
      weekOffset: 1,
      type: "HOMEWORK" as const,
      title: "Semaine suivante",
      detail: "Démo",
    },
  ];

  assert.equal(filterItemsForDisplayedWeek(items, 0).length, DEMO_PROTOTYPE_ITEMS.length + 0);
  assert.equal(
    filterItemsForDisplayedWeek(items.filter((item) => item.classroomId === "classe-demo-tma-2a"), 1).length,
    1,
  );
});

test("phase 0.5 — synthèse de charge de travail hebdomadaire", () => {
  const summary = buildClassWorkloadSummary(DEMO_PROTOTYPE_ITEMS, DEMO_CATALOG, "classe-demo-tma-2a", 12);

  assert.equal(summary.total, 5);
  assert.equal(summary.homework, 2);
  assert.equal(summary.test, 1);
  assert.equal(summary.information, 2);
  assert.equal(summary.byDay.reduce((total, day) => total + day.total, 0), 5);
  assert.equal(summary.bySubject.length, 4);
  assert.equal(summary.byTeacher.length, 3);
  assert.equal(WORKLOAD_LEVEL_LABELS[summary.level], "Charge modérée");
});
