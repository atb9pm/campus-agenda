import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { PrototypeAgendaItem } from "../src/features/agenda/demo-items.ts";
import type { CourseSession } from "../src/features/course-sessions/types.ts";
import {
  notebookBranchPreviewTarget,
  notebookVisibleColumns,
  selectNotebookColumn,
  shiftNotebookWindow,
} from "../src/features/class-notebook/notebook-focus.ts";
import { visibleCourseSessions } from "../src/features/class-notebook/session-window.ts";
import {
  BRANCH_PREVIEW_DRAFT_LABEL,
  BRANCH_PREVIEW_EMPTY_LABEL,
  buildStudentCourseDaySections,
  getStudentAgendaItems,
  nextControlDatePerSubject,
  publicationsForBranchPreview,
} from "../src/features/student/index.ts";
import type { Subject } from "../src/types/classroom.ts";

const CLASSROOM = "class-mecauto3a";
const COURSE = "ac-injection";
const OTHER_COURSE = "ac-autre";
const OTHER_CLASS = "class-autre";
const YEAR = "SY-2026-27";
const TODAY = "2026-11-16";
const NOTE = "Note prof du 23 : ne pas projeter";

function session(date: string, week: number, kind: "A" | "B", day: 1 | 2 | 3 | 4 | 5, sequence: number, course = COURSE): CourseSession {
  return {
    key: `${YEAR}|${course}|${date}`,
    schoolYearId: YEAR,
    annualCourseId: course,
    classId: CLASSROOM,
    contextId: "ctx-injection",
    date,
    schoolWeekNumber: week,
    weekKind: kind,
    dayOfWeek: day,
    sequenceNumber: sequence,
    segments: [{ scheduleSlotId: "slot", periodStart: 2, periodEnd: 3 }],
  };
}

const NOV16 = session("2026-11-16", 12, "B", 1, 1);
const NOV23 = session("2026-11-23", 13, "A", 1, 2);
const NOV26 = session("2026-11-26", 13, "A", 4, 3);
const SESSIONS = [NOV16, NOV23, NOV26];

function item(partial: Partial<PrototypeAgendaItem> & Pick<PrototypeAgendaItem, "id" | "type" | "title">): PrototypeAgendaItem {
  return {
    classroomId: CLASSROOM,
    subjectId: "subject-injection",
    annualCourseId: COURSE,
    authorTeacherId: "teacher-1",
    day: 0,
    hour: 8,
    weekOffset: 0,
    schoolWeekNumber: 13,
    detail: "",
    studentVisible: true,
    courseSessionKey: NOV23.key,
    courseSessionDate: "2026-11-23",
    ...partial,
  };
}

const PUBLISHED_16 = item({
  id: 16,
  type: "HOMEWORK",
  title: "Exercice du 16 novembre",
  detail: "Feuille déjà publiée aux élèves.",
  schoolWeekNumber: 12,
  courseSessionKey: NOV16.key,
  courseSessionDate: NOV16.date,
  studentVisible: true,
});
const DRAFT_23_INJECTION = item({
  id: 23,
  type: "HOMEWORK",
  title: "Injection essence",
  detail: "ME-Motronic, N°17+17a, feuilles à compléter, à terminer.",
  studentVisible: false,
});
const DRAFT_23_DEPOLLUTION = item({
  id: 24,
  type: "INFORMATION",
  title: "Dépollution",
  detail: "EGR & Insufflation N°7, feuille à compléter, à terminer.",
  studentVisible: false,
});
const DRAFT_26 = item({
  id: 26,
  type: "HOMEWORK",
  title: "Travail du 26 novembre",
  detail: "Séance suivante, même semaine 13-A.",
  day: 3,
  courseSessionKey: NOV26.key,
  courseSessionDate: NOV26.date,
  studentVisible: false,
});
const OTHER_COURSE_ITEM = item({
  id: 90,
  type: "HOMEWORK",
  title: "Autre branche",
  annualCourseId: OTHER_COURSE,
  courseSessionKey: `${YEAR}|${OTHER_COURSE}|2026-11-23`,
  studentVisible: false,
});
const OTHER_CLASS_ITEM = item({
  id: 91,
  type: "HOMEWORK",
  title: "Autre classe",
  classroomId: OTHER_CLASS,
  studentVisible: false,
});
const WEEK_ONLY = item({
  id: 92,
  type: "HOMEWORK",
  title: "Ancienne publication de semaine",
  courseSessionKey: "",
  courseSessionDate: "",
  studentVisible: true,
});
const CONTROL = item({
  id: 50,
  type: "TEST",
  title: "Contrôle injection",
  schoolWeekNumber: 14,
  day: 0,
  courseSessionKey: `${YEAR}|${COURSE}|2026-11-30`,
  courseSessionDate: "2026-11-30",
  studentVisible: true,
});
const ITEMS = [PUBLISHED_16, DRAFT_23_INJECTION, DRAFT_23_DEPOLLUTION, DRAFT_26, OTHER_COURSE_ITEM, OTHER_CLASS_ITEM, WEEK_ONLY, CONTROL];

const SUBJECTS: Subject[] = [
  { id: "subject-injection", classroomId: CLASSROOM, name: "CP VL Injection – Dépollution", annualCourseId: COURSE },
];

function previewOf(sessionKey: string | null) {
  return publicationsForBranchPreview({
    items: ITEMS,
    classroomId: CLASSROOM,
    annualCourseId: COURSE,
    courseSessionKey: sessionKey,
  });
}

function titles(list: readonly { title: string }[]) {
  return list.map((entry) => entry.title);
}

test("1-2 — la deuxième colonne sélectionnée est la séance projetée, pas la première visible", () => {
  const selected = selectNotebookColumn(NOV16.key, NOV23.key);
  const visible = visibleCourseSessions(SESSIONS, selected.windowStartKey, 3);
  assert.equal(visible[0]?.key, NOV16.key);
  const target = notebookBranchPreviewTarget({
    annualCourseId: COURSE,
    sessions: SESSIONS,
    followMode: selected.followMode,
    windowStartKey: selected.windowStartKey,
    selectedSessionKey: selected.selectedSessionKey,
  });
  assert.equal(target.courseSessionKey, NOV23.key);
  assert.notEqual(target.courseSessionKey, visible[0]?.key);
  assert.equal(target.focusDate, "2026-11-23");
  assert.equal(target.selectionMissing, false);
  assert.equal(selected.windowStartKey, NOV16.key);
});

test("3-4 — la troisième colonne projette sa date et sa semaine A", () => {
  const selected = selectNotebookColumn(NOV16.key, NOV26.key);
  const target = notebookBranchPreviewTarget({
    annualCourseId: COURSE,
    sessions: SESSIONS,
    followMode: selected.followMode,
    windowStartKey: selected.windowStartKey,
    selectedSessionKey: selected.selectedSessionKey,
  });
  assert.equal(target.courseSessionKey, NOV26.key);
  assert.equal(target.focusDate, "2026-11-26");
  assert.equal(target.schoolWeekNumber, 13);
  assert.equal(target.dayOfWeek, 4);
  assert.equal(NOV26.weekKind, "A");
  assert.equal(NOV16.weekKind, "B");
});

test("5-9 — une séance, une clé, un cours : ni la précédente, ni la suivante, ni la même semaine", () => {
  const monday = previewOf(NOV23.key);
  assert.deepEqual(titles(monday), ["Injection essence", "Dépollution"]);
  assert.equal(monday.every((entry) => entry.courseSessionKey === NOV23.key), true);
  assert.equal(monday.every((entry) => entry.annualCourseId === COURSE), true);
  assert.equal(titles(monday).includes("Exercice du 16 novembre"), false);
  assert.equal(titles(monday).includes("Travail du 26 novembre"), false);
  assert.equal(titles(previewOf(NOV26.key)).includes("Injection essence"), false);
  assert.deepEqual(titles(previewOf(NOV16.key)), ["Exercice du 16 novembre"]);
});

test("10-11 — une publication publiée et un brouillon sont visibles dans l’aperçu", () => {
  const published = previewOf(NOV16.key);
  assert.equal(published[0]?.studentVisible, true);
  const draft = previewOf(NOV23.key);
  assert.equal(draft.length, 2);
  assert.equal(draft.every((entry) => entry.studentVisible === false), true);
  assert.equal(BRANCH_PREVIEW_DRAFT_LABEL, "Brouillon — non publié aux élèves");
});

test("12-13 — le brouillon reste invisible pour l’élève et n’est pas publié par l’aperçu", () => {
  const before = DRAFT_23_INJECTION.studentVisible;
  const projected = previewOf(NOV23.key);
  assert.equal(DRAFT_23_INJECTION.studentVisible, before);
  assert.equal(projected[0]?.studentVisible, false);
  const student = getStudentAgendaItems(ITEMS, CLASSROOM);
  assert.equal(titles(student).includes("Injection essence"), false);
  assert.equal(titles(student).includes("Dépollution"), false);
  assert.equal(titles(student).includes("Travail du 26 novembre"), false);
  assert.equal(titles(student).includes("Exercice du 16 novembre"), true);
});

test("14 — les notes prof ne sont pas des publications projetées", () => {
  const notes = { [NOV23.key]: NOTE };
  const projected = previewOf(NOV23.key);
  const serialized = JSON.stringify(projected);
  assert.equal(serialized.includes(NOTE), false);
  assert.equal(serialized.includes(notes[NOV23.key]), false);
  assert.equal(projected.some((entry) => entry.type === "TEST"), false);
});

test("15 — une séance sans publication reste vide, sans repli vers une autre", () => {
  assert.deepEqual(previewOf(null), []);
  assert.deepEqual(previewOf("   "), []);
  const missing = notebookBranchPreviewTarget({
    annualCourseId: COURSE,
    sessions: SESSIONS,
    followMode: "manual",
    windowStartKey: NOV16.key,
    selectedSessionKey: `${YEAR}|${COURSE}|2099-01-01`,
  });
  assert.equal(missing.selectionMissing, true);
  assert.equal(missing.courseSessionKey, null);
  assert.equal(missing.focusDate, null);
  assert.deepEqual(previewOf(missing.courseSessionKey), []);
  assert.equal(BRANCH_PREVIEW_EMPTY_LABEL, "Aucune publication pour cette séance.");
});

test("16-18 — les contrôles à venir et les semaines A/B restent hors du cours du jour", () => {
  const later = item({
    id: 51,
    type: "TEST",
    title: "Contrôle suivant",
    schoolWeekNumber: 15,
    courseSessionKey: `${YEAR}|${COURSE}|2026-12-07`,
    courseSessionDate: "2026-12-07",
  });
  const controls = [
    {
      item: CONTROL,
      subjectName: "CP VL Injection – Dépollution",
      teacherName: "Enseignant",
      slot: { schoolWeekNumber: 14, weekKind: "B" as const, date: new Date(2026, 10, 30, 12), dayIndex: 0 },
    },
    {
      item: later,
      subjectName: "CP VL Injection – Dépollution",
      teacherName: "Enseignant",
      slot: { schoolWeekNumber: 15, weekKind: "A" as const, date: new Date(2026, 11, 7, 12), dayIndex: 0 },
    },
  ];
  const oneDate = nextControlDatePerSubject(controls, [{
    annualCourseId: COURSE,
    branchId: "branch-injection",
    maxUpcomingControlDates: 1,
  }]);
  const twoDates = nextControlDatePerSubject(controls, [{
    annualCourseId: COURSE,
    branchId: "branch-injection",
    maxUpcomingControlDates: 2,
  }]);
  assert.equal(oneDate.length, 1);
  assert.equal(twoDates.length, 2);
  const twoDateLink = [{
    annualCourseId: COURSE,
    branchId: "branch-injection",
    maxUpcomingControlDates: 2 as const,
  }];
  const sections = buildStudentCourseDaySections(previewOf(NOV23.key), SUBJECTS, twoDates, {
    sessionLocked: true,
    includeNextControls: true,
    controlLinks: twoDateLink,
    nextSession: { items: ITEMS, weeks: [] },
  });
  const oneDateSections = buildStudentCourseDaySections(previewOf(NOV23.key), SUBJECTS, twoDates, {
    sessionLocked: true,
    includeNextControls: true,
    controlLinks: [{ annualCourseId: COURSE, branchId: "branch-injection", maxUpcomingControlDates: 1 }],
  });
  assert.deepEqual(sections[0]?.publications.map((entry) => entry.title), ["Injection essence", "Dépollution"]);
  assert.equal(sections[0]?.nextSession, undefined);
  assert.equal(sections[0]?.nextControls.length, 2);
  assert.equal(oneDateSections[0]?.nextControls.length, 1);
  assert.equal(NOV23.weekKind, "A");
  assert.equal(NOV16.weekKind, "B");
  assert.equal(NOV23.schoolWeekNumber, NOV26.schoolWeekNumber);
  assert.notEqual(NOV23.key, NOV26.key);
});

test("19-20 — le retour et les flèches conservent la séance choisie et la fenêtre", () => {
  const selected = selectNotebookColumn(NOV16.key, NOV23.key);
  const preview = notebookBranchPreviewTarget({
    annualCourseId: COURSE,
    sessions: SESSIONS,
    followMode: selected.followMode,
    windowStartKey: selected.windowStartKey,
    selectedSessionKey: selected.selectedSessionKey,
  });
  assert.equal(preview.courseSessionKey, NOV23.key);
  assert.equal(selected.selectedSessionKey, NOV23.key);
  assert.equal(selected.windowStartKey, NOV16.key);
  const shifted = shiftNotebookWindow(SESSIONS, selected, 1, NOV16.key);
  assert.ok(shifted);
  assert.equal(shifted.selectedSessionKey, NOV23.key);
  assert.notEqual(shifted.windowStartKey, NOV16.key);
  const columns = notebookVisibleColumns({
    sessions: SESSIONS,
    followMode: shifted.followMode,
    todayIso: TODAY,
    windowStartKey: shifted.windowStartKey,
    selectedSessionKey: shifted.selectedSessionKey,
    centerWeekNumber: 13,
    count: 3,
  });
  assert.equal(columns.find((column) => column.selected)?.date, "2026-11-23");
  assert.equal(columns[0]?.selected, false);
});

test("21-22 — une autre classe, un autre cours et une publication sans clé restent exclus", () => {
  const projected = previewOf(NOV23.key);
  assert.equal(titles(projected).includes("Autre branche"), false);
  assert.equal(titles(projected).includes("Autre classe"), false);
  assert.equal(titles(projected).includes("Ancienne publication de semaine"), false);
  assert.deepEqual(titles(publicationsForBranchPreview({
    items: ITEMS,
    classroomId: OTHER_CLASS,
    annualCourseId: COURSE,
    courseSessionKey: NOV23.key,
  })), ["Autre classe"]);
  assert.deepEqual(publicationsForBranchPreview({
    items: ITEMS,
    classroomId: CLASSROOM,
    annualCourseId: OTHER_COURSE,
    courseSessionKey: NOV23.key,
  }), []);
});

test("sans sélection manuelle, l’aperçu suit la séance de référence", () => {
  const target = notebookBranchPreviewTarget({
    annualCourseId: COURSE,
    sessions: SESSIONS,
    followMode: "auto",
    windowStartKey: NOV16.key,
    selectedSessionKey: null,
  });
  assert.equal(target.courseSessionKey, NOV16.key);
  assert.equal(target.selectionMissing, false);
});

test("l’agenda élève continue d’ajouter la séance suivante, l’aperçu non", () => {
  const weeks = [
    { number: 12, kind: "B" as const, monday: new Date(2026, 10, 16, 12) },
    { number: 13, kind: "A" as const, monday: new Date(2026, 10, 23, 12) },
  ];
  const courseDay = { schoolWeekNumber: 12, weekKind: "B" as const, date: new Date(2026, 10, 16, 12), dayIndex: 0 };
  const student = buildStudentCourseDaySections([PUBLISHED_16], SUBJECTS, [], {
    courseDay,
    nextSession: { items: [PUBLISHED_16, { ...DRAFT_26, studentVisible: true }], weeks },
  });
  assert.equal(student[0]?.nextSession?.publications[0]?.title, "Travail du 26 novembre");
  const locked = buildStudentCourseDaySections([PUBLISHED_16], SUBJECTS, [], {
    courseDay,
    sessionLocked: true,
    nextSession: { items: [PUBLISHED_16, { ...DRAFT_26, studentVisible: true }], weeks },
  });
  assert.equal(locked[0]?.nextSession, undefined);
});

test("le câblage de l’aperçu ne republie pas et ne contourne pas le filtre élève", async () => {
  const [panel, page, homework, route] = await Promise.all([
    readFile(new URL("../web/app/components/class-notebook-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/components/student-homework-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/api/agenda/route.ts", import.meta.url), "utf8"),
  ]);
  const button = panel.slice(panel.indexOf("Aperçu branche") - 700, panel.indexOf("Aperçu branche") + 40);
  assert.match(button, /notebookBranchPreviewTarget\(/);
  assert.match(button, /onPreviewBranch\(target\)/);
  assert.doesNotMatch(button, /visibleCards\[0\]/);
  assert.doesNotMatch(button, /onCenterWeekChange|selectSessionManually/);

  const previewBranch = page.slice(
    page.indexOf('studentEntry === "teacher-branch-preview"'),
    page.indexOf("if (!studentSession || !studentDisplayCourseDay)"),
  );
  assert.match(previewBranch, /publicationsForBranchPreview\(/);
  assert.match(previewBranch, /sessionLocked: true/);
  assert.doesNotMatch(previewBranch, /nextSession:/);
  assert.match(page, /getStudentAgendaItems\(items, studentSession\.classroomId\)/);
  assert.match(page, /itemsForAnnualCourse\(visible, previewAnnualCourseId\)/);
  const exit = page.slice(page.indexOf("function exitStudentMode"), page.indexOf("function submitTeacherLogin"));
  assert.doesNotMatch(exit, /closeClassNotebook|setNotebookOpening|setSelectedSchoolWeekNumber|studentVisible/);
  assert.match(page, /initialSelectedSessionKey=\{notebookOpening\.selectedSessionKey/);
  const enter = page.slice(page.indexOf("function enterTeacherBranchPreview"), page.indexOf("function enterStudentWithCode"));
  assert.doesNotMatch(enter, /studentVisible|createNotebookPublication|publish/);
  assert.match(homework, /BRANCH_PREVIEW_DRAFT_LABEL/);
  assert.match(homework, /BRANCH_PREVIEW_EMPTY_LABEL/);
  assert.match(homework, /presentation === "banner" \? \[\] : groupNextSessionsByDate/);
  assert.doesNotMatch(homework, /listSessionNotes|notesDocument/);
  assert.match(route, /access\.session\?\.kind === "student"/);
  assert.match(route, /items = items\.filter\(isVisibleToStudent\)/);
  assert.doesNotMatch(route, /publicationsForBranchPreview/);
});
