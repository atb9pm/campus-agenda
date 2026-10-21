import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { PrototypeAgendaItem } from "../src/features/agenda/demo-items.ts";
import { isVisibleToStudent } from "../src/features/agenda/visibility.ts";
import {
  CAMPUS_RICH_DETAIL_PREFIX,
  decodeRichDetail,
  encodeRichDetail,
  RICH_HIGHLIGHT_HEX,
  RICH_TEXT_COLOR_HEX,
  type CampusRichDoc,
} from "../src/features/class-notebook/index.ts";
import { listFutureTestsForClass } from "../src/features/evaluations/index.ts";
import {
  buildStudentCourseDaySections,
  controlAgendaDateParts,
  groupItemsBySubject,
  studentTodoSections,
} from "../src/features/student/index.ts";
import type { SchoolWeek } from "../src/features/calendar/types.ts";

const CLASSROOM_ID = "classroom-mecauto3a";
const CP1 = { id: "subj-cp1", classroomId: CLASSROOM_ID, name: "CP 1 Electrotechnique", annualCourseId: "ac-cp1" };
const CP2 = { id: "subj-cp2", classroomId: CLASSROOM_ID, name: "CP 2 Transmission", annualCourseId: "ac-cp2" };
const CP3 = { id: "subj-cp3", classroomId: CLASSROOM_ID, name: "CP 3 Châssis", annualCourseId: "ac-cp3" };
const INJECTION = {
  id: "subj-injection",
  classroomId: CLASSROOM_ID,
  name: "CP Léger Injection, dépollution",
  annualCourseId: "ac-injection",
};

function monday(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

const WEEKS: SchoolWeek[] = [
  { number: 9, kind: "A", monday: monday("2026-10-26") },
  { number: 12, kind: "B", monday: monday("2026-11-16") },
  { number: 14, kind: "A", monday: monday("2026-11-30") },
  { number: 16, kind: "B", monday: monday("2026-12-14") },
];

function item(
  partial: Partial<PrototypeAgendaItem> & Pick<PrototypeAgendaItem, "id" | "type" | "title" | "subjectId">,
): PrototypeAgendaItem {
  return {
    classroomId: CLASSROOM_ID,
    authorTeacherId: "teacher-1",
    day: 0,
    hour: 8,
    weekOffset: 0,
    schoolWeekNumber: 9,
    detail: "",
    ...partial,
  };
}

function richDoc(marks: CampusRichDoc["blocks"][0] extends { inlines: infer I } ? I : never): string {
  return encodeRichDetail({
    format: "campus-rich-v1",
    blocks: [{ type: "paragraph", inlines: marks as never }],
  });
}

test("RichDoc conserve bold / italic / underline / color / highlight / href", () => {
  const encoded = encodeRichDetail({
    format: "campus-rich-v1",
    blocks: [
      {
        type: "paragraph",
        inlines: [
          { text: "Bonjour à tous, " },
          { text: "à terminer", marks: { bold: true, color: "blue" } },
          { text: " page 15", marks: { highlight: true } },
          { text: " Attention", marks: { bold: true, color: "red" } },
          { text: " Fiche de révision", marks: { href: "https://campusagenda.ch/fiche" } },
          { text: " italique", marks: { italic: true } },
          { text: " souligné", marks: { underline: true } },
        ],
      },
    ],
  });
  assert.match(encoded, new RegExp(`^${CAMPUS_RICH_DETAIL_PREFIX}`));
  const decoded = decodeRichDetail(encoded);
  assert.ok(decoded);
  const inlines = decoded.blocks[0] && "inlines" in decoded.blocks[0] ? decoded.blocks[0].inlines : [];
  assert.equal(inlines[1]?.marks?.bold, true);
  assert.equal(inlines[1]?.marks?.color, "blue");
  assert.equal(inlines[2]?.marks?.highlight, true);
  assert.equal(inlines[3]?.marks?.color, "red");
  assert.equal(inlines[3]?.marks?.bold, true);
  assert.equal(inlines[4]?.marks?.href, "https://campusagenda.ch/fiche");
  assert.equal(inlines[5]?.marks?.italic, true);
  assert.equal(inlines[6]?.marks?.underline, true);
  assert.equal(RICH_TEXT_COLOR_HEX.blue, "#1d4ed8");
  assert.equal(RICH_HIGHLIGHT_HEX, "#fef08a");
});

test("vue élève — plusieurs AnnualCourse affichent les bons labels, regroupés", () => {
  const pubs = [
    item({
      id: 1,
      type: "HOMEWORK",
      title: "A",
      subjectId: CP1.id,
      annualCourseId: CP1.annualCourseId,
      detail: richDoc([{ text: "publication A" }]),
    }),
    item({
      id: 2,
      type: "HOMEWORK",
      title: "A2",
      subjectId: CP1.id,
      annualCourseId: CP1.annualCourseId,
      detail: richDoc([{ text: "deuxième A" }]),
    }),
    item({
      id: 3,
      type: "HOMEWORK",
      title: "B",
      subjectId: INJECTION.id,
      annualCourseId: INJECTION.annualCourseId,
      detail: richDoc([{ text: "publication B" }]),
    }),
    item({
      id: 4,
      type: "HOMEWORK",
      title: "C",
      subjectId: CP2.id,
      annualCourseId: CP2.annualCourseId,
      detail: richDoc([{ text: "publication C" }]),
    }),
  ];
  const groups = groupItemsBySubject(pubs, [CP1, INJECTION, CP2, CP3]);
  assert.deepEqual(
    groups.map((group) => group.subject.name),
    ["CP 1 Electrotechnique", "CP Léger Injection, dépollution", "CP 2 Transmission"],
  );
  assert.equal(groups[0]?.items.length, 2);
  assert.equal(groups[0]?.subject.annualCourseId, "ac-cp1");
  const todo = studentTodoSections(buildStudentCourseDaySections(pubs, [CP1, INJECTION, CP2, CP3], []));
  assert.equal(todo.length, 3);
  assert.ok(!todo.some((section) => section.subject.name === "MECAUTO3A"));
});

test("vue élève — contrôles triés par date, y compris le jour même", () => {
  const catalog = {
    classrooms: [{ id: CLASSROOM_ID, name: "MECAUTO3A", programLabel: "", accessCodeHint: "" }],
    subjects: [INJECTION, CP3, CP1, CP2],
    memberships: [],
    teachers: [],
  };
  const tests = [
    item({
      id: 10,
      type: "TEST",
      title: "Contrôle 1",
      subjectId: INJECTION.id,
      annualCourseId: INJECTION.annualCourseId,
      schoolWeekNumber: 9,
      day: 0,
      detail: "Injection, dépollution",
    }),
    item({
      id: 11,
      type: "TEST",
      title: "Contrôle",
      subjectId: CP3.id,
      annualCourseId: CP3.annualCourseId,
      schoolWeekNumber: 12,
      day: 2,
      detail: "Système de freinage",
    }),
    item({
      id: 12,
      type: "TEST",
      title: "Contrôle",
      subjectId: CP1.id,
      annualCourseId: CP1.annualCourseId,
      schoolWeekNumber: 14,
      day: 0,
      detail: "Circuits électriques",
    }),
    item({
      id: 13,
      type: "TEST",
      title: "Contrôle",
      subjectId: CP2.id,
      annualCourseId: CP2.annualCourseId,
      schoolWeekNumber: 16,
      day: 0,
      detail: "Boîtes de transfert",
    }),
  ];
  const entries = listFutureTestsForClass(tests, catalog, CLASSROOM_ID, monday("2026-10-26"), WEEKS);
  assert.equal(entries.length, 4);
  assert.deepEqual(
    entries.map((entry) => entry.item.detail),
    ["Injection, dépollution", "Système de freinage", "Circuits électriques", "Boîtes de transfert"],
  );
  assert.equal(entries[0]?.subjectName, INJECTION.name);
  assert.equal(entries[1]?.subjectName, CP3.name);
  const parts = controlAgendaDateParts(monday("2026-10-26"));
  assert.equal(parts.day, "26");
  assert.match(parts.month, /oct/i);
});

test("brouillons non visibles élève, published visible", () => {
  assert.equal(isVisibleToStudent({ type: "HOMEWORK", studentVisible: false }), false);
  assert.equal(isVisibleToStudent({ type: "HOMEWORK", studentVisible: true }), true);
  assert.equal(isVisibleToStudent({ type: "HOMEWORK" }), true);
  assert.equal(isVisibleToStudent({ type: "TEST", studentVisible: false }), false);
  assert.equal(isVisibleToStudent({ type: "TEST", studentVisible: true }), true);
  assert.equal(isVisibleToStudent({ type: "INFORMATION", studentVisible: false }), false);
});

test("sources — Cours du jour, Contrôles à venir, RichDoc unique, aucun À venir", async () => {
  const [dashboard, homework, controls, view, css] = await Promise.all([
    readFile(new URL("../web/app/components/student-dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/components/student-homework-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/components/student-controls-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/components/rich-doc-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(homework, /Cours du jour/);
  assert.match(homework, /RichDocView/);
  assert.match(homework, /student-course-chip/);
  assert.match(homework, /Aucune publication pour aujourd’hui/);
  assert.doesNotMatch(homework, /checkbox/);
  assert.doesNotMatch(homework, /DEVOIR/);
  assert.match(controls, /Contrôles à venir/);
  assert.match(controls, /Aucun contrôle planifié/);
  assert.match(controls, /futureTests\.map/);
  assert.doesNotMatch(controls, /Voir tout le planning/);
  assert.equal([...controls.matchAll(/function ControlRow/g)].length, 1);
  assert.match(controls, /ControlRow key=\{entry\.item\.id\}/);
  const chipAt = controls.indexOf("student-course-chip");
  const timeAt = controls.indexOf("<time");
  const titleAt = controls.indexOf("{entry.item.title}");
  assert.ok(chipAt > 0 && chipAt < timeAt, "branche avant la date");
  assert.ok(timeAt < titleAt, "date avant le titre");
  assert.match(controls, /student-visually-hidden/);
  assert.match(controls, /dateTime=\{entry\.slot\.date\.toISOString\(\)\}/);
  assert.match(css, /\.student-control-main \{[\s\S]{0,160}grid-template-columns: 52px minmax\(0, 1fr\)/);
  assert.match(css, /\.student-control-row > \.student-course-chip \{[\s\S]{0,220}width: fit-content/);
  assert.match(css, /\.student-control-row > \.student-course-chip \{[\s\S]{0,220}justify-self: start/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.student-control-row[\s\S]{0,160}overflow-x: hidden/);
  assert.doesNotMatch(
    css,
    /@media \(max-width: 760px\)[\s\S]*\.student-course-chip \{ max-width: 100%; overflow-x: hidden; \}/,
  );
  assert.doesNotMatch(dashboard, />À venir</);
  assert.doesNotMatch(dashboard, /Prochainement/);
  assert.doesNotMatch(homework, />À venir</);
  assert.doesNotMatch(controls, />À venir</);
  assert.match(dashboard, /data-layout="tout"/);
  assert.match(css, /grid-template-columns: minmax\(0, 1\.62fr\) minmax\(0, 1fr\)/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*student-dashboard-grid\[data-layout="tout"\] \{ grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /\.student-branch-item \.rich-doc-view strong \{[\s\S]{0,80}color: inherit/);
  assert.match(view, /data-rich-mark="color"/);
  assert.match(view, /data-rich-mark="highlight"/);
  assert.match(view, /RICH_TEXT_COLOR_HEX\[marks\.color\]/);
  assert.match(view, /target="_blank"/);
  assert.match(view, /rel="noreferrer"/);
});
