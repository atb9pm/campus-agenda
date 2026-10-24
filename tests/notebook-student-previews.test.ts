import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { PrototypeAgendaItem } from "../src/features/agenda/demo-items.ts";
import type { UpcomingTestEntry } from "../src/features/evaluations/index.ts";
import { itemsForAnnualCourse, upcomingTestsForAnnualCourse } from "../src/features/student/index.ts";

const INJECTION = "ac-injection";
const TRANSMISSION = "ac-transmission";

function item(
  partial: Partial<PrototypeAgendaItem> & Pick<PrototypeAgendaItem, "id" | "title" | "annualCourseId">,
): PrototypeAgendaItem {
  return {
    classroomId: "cl-1",
    authorTeacherId: "teacher-1",
    subjectId: "subject-1",
    type: "HOMEWORK",
    hour: 8,
    day: 0,
    weekOffset: 0,
    schoolWeekNumber: 7,
    detail: "",
    studentVisible: true,
    ...partial,
  };
}

test("aperçu branche — filtre par AnnualCourse, pas par libellé", () => {
  const items = [
    item({ id: 1, title: "Injection", annualCourseId: INJECTION }),
    item({ id: 2, title: "Transmission", annualCourseId: TRANSMISSION }),
    item({ id: 3, title: "Sans cours", annualCourseId: null }),
    item({ id: 4, title: "Même nom autre année", annualCourseId: "ac-injection-n1" }),
  ];
  assert.deepEqual(
    itemsForAnnualCourse(items, INJECTION).map((entry) => entry.id),
    [1],
  );
  assert.deepEqual(itemsForAnnualCourse(items, "  "), []);
  assert.deepEqual(itemsForAnnualCourse(items, "inconnu"), []);
});

test("aperçu branche — contrôles du même AnnualCourse uniquement", () => {
  const tests = [
    { item: item({ id: 10, title: "Ctrl injection", type: "TEST", annualCourseId: INJECTION }), slot: { date: new Date() }, subjectName: "Injection" },
    { item: item({ id: 11, title: "Ctrl transmission", type: "TEST", annualCourseId: TRANSMISSION }), slot: { date: new Date() }, subjectName: "Transmission" },
  ] as unknown as UpcomingTestEntry[];
  assert.deepEqual(
    upcomingTestsForAnnualCourse(tests, INJECTION).map((entry) => entry.item.id),
    [10],
  );
});

test("carnet — Aperçu branche et Agenda élève près des flèches, pas dans la barre générale", async () => {
  const [panel, page, css] = await Promise.all([
    readFile(new URL("../web/app/components/class-notebook-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/globals.css", import.meta.url), "utf8"),
  ]);
  const toolbar = panel.slice(panel.indexOf("class-notebook-actions"), panel.indexOf("class-notebook-week-controls"));
  assert.match(toolbar, /Contrôles/);
  assert.match(toolbar, /Exporter le carnet/);
  assert.doesNotMatch(toolbar, /Aperçu branche/);
  assert.doesNotMatch(toolbar, /Agenda élève/);
  assert.doesNotMatch(toolbar, /Aperçu élève/);

  const nav = panel.slice(panel.indexOf("class-notebook-week-nav"), panel.indexOf("class-notebook-display-count"));
  assert.match(nav, /Séquences précédentes/);
  assert.match(nav, /Aperçu branche/);
  assert.match(nav, /Agenda élève/);
  assert.ok(nav.indexOf("Séquences précédentes") < nav.indexOf("Aperçu branche"));
  assert.ok(nav.indexOf("Aperçu branche") < nav.indexOf("Agenda élève"));
  assert.match(nav, /onPreviewBranch\(\{[\s\S]*annualCourseId/);
  assert.match(nav, /focusDate: card\?\.session\?\.date/);

  assert.match(page, /teacher-branch-preview/);
  assert.match(page, /onPreviewStudentAgenda=\{enterTeacherPreview\}/);
  assert.match(page, /onPreviewBranch=\{enterTeacherBranchPreview\}/);
  assert.match(page, /itemsForAnnualCourse\(visible, previewAnnualCourseId\)/);
  assert.match(page, /upcomingTestsForAnnualCourse\(tests, previewAnnualCourseId\)/);
  assert.match(page, /Quitter l’agenda/);
  assert.match(css, /\.class-notebook-preview-actions/);
  assert.match(css, /\.class-notebook-week-nav \{ width: 100%; \}/);

  const overlay = panel.slice(panel.indexOf("rich-doc-student-preview"));
  assert.match(overlay, />Aperçu élève</);
});
