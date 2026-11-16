import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { PrototypeAgendaItem } from "../src/features/agenda/demo-items.ts";
import {
  CAMPUS_RICH_FORMAT,
  createEmptyNotesDocument,
  focusNotebookReference,
  itemsForCourseSession,
  listSessionNotes,
  notebookAutoFollowAllowed,
  notebookHighlightedSessionKey,
  notebookOpeningFollowMode,
  notebookTodayUpdate,
  notebookVisibleColumns,
  orderedCourseSessions,
  selectNotebookColumn,
  sessionNotesKey,
  setSessionRichNote,
  shiftNotebookWindow,
  type CampusRichDoc,
  type NotebookColumnFocus,
} from "../src/features/class-notebook/index.ts";
import type { CourseScheduleSlot, CourseWeekKind, CourseWeekday } from "../src/features/course-schedule/types.ts";
import { computeCourseSessions } from "../src/features/course-sessions/index.ts";
import type { CourseSession } from "../src/features/course-sessions/types.ts";
import type { SchoolWeekEntry } from "../src/features/school-year/types.ts";
import type { WeekDisplayCount } from "../src/features/class-notebook/week-window.ts";

const YEAR = "SY-2026-27";
const COURSE = { id: "ac-lundi", classId: "class-mecauto2", contextId: "ctx-lundi" };

const MONDAY_WEEKS: SchoolWeekEntry[] = [
  { number: 12, kind: "B", monday: "2026-11-16" },
  { number: 13, kind: "A", monday: "2026-11-23" },
  { number: 14, kind: "B", monday: "2026-11-30" },
  { number: 15, kind: "A", monday: "2026-12-07" },
  { number: 16, kind: "B", monday: "2026-12-14" },
];

function slot(id: string, dayOfWeek: CourseWeekday, weekKind: CourseWeekKind): CourseScheduleSlot {
  return {
    id,
    annualCourseId: COURSE.id,
    dayOfWeek,
    periodStart: 2,
    periodEnd: 3,
    weekKind,
    validFrom: null,
    validTo: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

function sessionsFor(input: { slots: CourseScheduleSlot[]; weeks?: SchoolWeekEntry[] }): CourseSession[] {
  return orderedCourseSessions(
    computeCourseSessions({
      schoolYearId: YEAR,
      courses: [COURSE],
      slots: input.slots,
      weeks: input.weeks ?? MONDAY_WEEKS,
      holidays: [],
      exceptions: [],
    }),
  );
}

function mondaySessions(): CourseSession[] {
  return sessionsFor({ slots: [slot("lundi", 1, "all")] });
}

function datesOf(focus: NotebookColumnFocus, sessions: readonly CourseSession[], count: WeekDisplayCount, todayIso = "2026-11-16") {
  return notebookVisibleColumns({
    sessions,
    followMode: focus.followMode,
    todayIso,
    windowStartKey: focus.windowStartKey,
    selectedSessionKey: focus.selectedSessionKey,
    centerWeekNumber: 12,
    count,
  }).map((column) => column.date);
}

function selectedDate(focus: NotebookColumnFocus, sessions: readonly CourseSession[], count: WeekDisplayCount, todayIso = "2026-11-16") {
  return notebookVisibleColumns({
    sessions,
    followMode: focus.followMode,
    todayIso,
    windowStartKey: focus.windowStartKey,
    selectedSessionKey: focus.selectedSessionKey,
    centerWeekNumber: 12,
    count,
  }).find((column) => column.selected)?.date ?? null;
}

function openOnReference(sessions: readonly CourseSession[], todayIso = "2026-11-16"): NotebookColumnFocus {
  return focusNotebookReference(sessions, todayIso);
}

function item(patch: Partial<PrototypeAgendaItem> & Pick<PrototypeAgendaItem, "id" | "title" | "type">): PrototypeAgendaItem {
  return {
    classroomId: "rt-mecauto2",
    subjectId: "rt-meca",
    authorTeacherId: "teacher-1",
    day: 0,
    hour: 8,
    weekOffset: 0,
    schoolWeekNumber: 12,
    detail: "",
    annualCourseId: COURSE.id,
    courseSessionKey: null,
    courseSessionDate: null,
    ...patch,
  };
}

function noteDoc(text: string): CampusRichDoc {
  return { format: CAMPUS_RICH_FORMAT, blocks: [{ type: "paragraph", inlines: [{ text }] }] };
}

test("ouverture du Carnet : la séance de référence est en tête et sélectionnée", () => {
  const sessions = mondaySessions();
  const focus = openOnReference(sessions);
  assert.deepEqual(datesOf(focus, sessions, 3), ["2026-11-16", "2026-11-23", "2026-11-30"]);
  assert.equal(selectedDate(focus, sessions, 3), "2026-11-16");
  const columns = notebookVisibleColumns({
    sessions,
    ...focus,
    todayIso: "2026-11-16",
    centerWeekNumber: 12,
    count: 3,
  });
  assert.equal(columns[0]?.referenceTag, "Aujourd’hui");
  assert.equal(columns[1]?.referenceTag, null);
  assert.equal(columns[2]?.referenceTag, null);
});

test("sélection des colonnes 2, 3 et 4 puis retour à la 1 : les dates ne bougent pas", () => {
  const sessions = mondaySessions();
  const opened = openOnReference(sessions);
  const initial = datesOf(opened, sessions, 4);
  assert.deepEqual(initial, ["2026-11-16", "2026-11-23", "2026-11-30", "2026-12-07"]);

  const second = selectNotebookColumn(opened.windowStartKey, sessions[1]!.key);
  const third = selectNotebookColumn(second.windowStartKey, sessions[2]!.key);
  const fourth = selectNotebookColumn(third.windowStartKey, sessions[3]!.key);
  const firstAgain = selectNotebookColumn(fourth.windowStartKey, sessions[0]!.key);

  for (const focus of [second, third, fourth, firstAgain]) {
    assert.deepEqual(datesOf(focus, sessions, 4), initial);
    assert.equal(focus.windowStartKey, opened.windowStartKey);
  }
  assert.equal(selectedDate(second, sessions, 4), "2026-11-23");
  assert.equal(selectedDate(third, sessions, 4), "2026-11-30");
  assert.equal(selectedDate(fourth, sessions, 4), "2026-12-07");
  assert.equal(selectedDate(firstAgain, sessions, 4), "2026-11-16");
});

test("1, 2, 3 et 4 colonnes : sélectionner une séance ne change pas la fenêtre", () => {
  const sessions = mondaySessions();
  const opened = openOnReference(sessions);
  for (const count of [1, 2, 3, 4] as const) {
    const before = datesOf(opened, sessions, count);
    const target = sessions[Math.min(count - 1, sessions.length - 1)]!;
    const selected = selectNotebookColumn(opened.windowStartKey, target.key);
    assert.deepEqual(datesOf(selected, sessions, count), before, `affichage ${count}`);
    assert.equal(selectedDate(selected, sessions, count), target.date);
  }
});

test("le badge Aujourd’hui reste sur la séance du jour quand une autre colonne est sélectionnée", () => {
  const sessions = mondaySessions();
  const selected = selectNotebookColumn(openOnReference(sessions).windowStartKey, sessions[1]!.key);
  const columns = notebookVisibleColumns({
    sessions,
    ...selected,
    todayIso: "2026-11-16",
    centerWeekNumber: 12,
    count: 3,
  });
  assert.equal(columns.find((column) => column.date === "2026-11-16")?.referenceTag, "Aujourd’hui");
  assert.equal(columns.find((column) => column.date === "2026-11-23")?.selected, true);
  assert.equal(columns.find((column) => column.date === "2026-11-23")?.referenceTag, null);
});

test("les flèches déplacent la fenêtre sans sélectionner la première colonne", () => {
  const sessions = mondaySessions();
  const opened = openOnReference(sessions);
  const shifted = shiftNotebookWindow(sessions, opened, 1, opened.windowStartKey);
  assert.ok(shifted);
  assert.deepEqual(datesOf(shifted, sessions, 3), ["2026-11-23", "2026-11-30", "2026-12-07"]);
  assert.equal(shifted.selectedSessionKey, sessions[0]!.key);
  assert.equal(selectedDate(shifted, sessions, 3), null);

  const back = shiftNotebookWindow(sessions, shifted, -1, shifted.windowStartKey);
  assert.ok(back);
  assert.deepEqual(datesOf(back, sessions, 3), ["2026-11-16", "2026-11-23", "2026-11-30"]);
  assert.equal(back.selectedSessionKey, sessions[0]!.key);
  assert.equal(selectedDate(back, sessions, 3), "2026-11-16");
});

test("une sélection hors fenêtre ne met aucune autre séance en évidence", () => {
  const sessions = mondaySessions();
  const selected = selectNotebookColumn(sessions[0]!.key, sessions[1]!.key);
  const shifted = shiftNotebookWindow(sessions, selected, 1, selected.windowStartKey);
  assert.ok(shifted);
  assert.equal(shifted.selectedSessionKey, sessions[1]!.key);
  assert.deepEqual(datesOf(shifted, sessions, 3), ["2026-11-23", "2026-11-30", "2026-12-07"]);
  assert.equal(selectedDate(shifted, sessions, 3), "2026-11-23");

  const further = shiftNotebookWindow(sessions, shifted, 1, shifted.windowStartKey);
  assert.ok(further);
  assert.equal(further.selectedSessionKey, sessions[1]!.key);
  assert.equal(selectedDate(further, sessions, 3), null);
  assert.equal(
    notebookHighlightedSessionKey({
      sessions,
      followMode: further.followMode,
      windowStartKey: further.windowStartKey,
      selectedSessionKey: further.selectedSessionKey,
    }),
    sessions[1]!.key,
  );
});

test("Aujourd’hui ramène la fenêtre et la sélection sur la séance de référence", () => {
  const sessions = mondaySessions();
  const away = shiftNotebookWindow(sessions, selectNotebookColumn(sessions[0]!.key, sessions[2]!.key), 1, sessions[0]!.key);
  assert.ok(away);
  const restored = focusNotebookReference(sessions, "2026-11-16");
  assert.equal(restored.followMode, "auto");
  assert.deepEqual(datesOf(restored, sessions, 3), ["2026-11-16", "2026-11-23", "2026-11-30"]);
  assert.equal(selectedDate(restored, sessions, 3), "2026-11-16");
});

test("sans cours aujourd’hui, le badge et le retour visent la prochaine séance", () => {
  const sessions = mondaySessions();
  const next = focusNotebookReference(sessions, "2026-11-17");
  const columns = notebookVisibleColumns({
    sessions,
    ...next,
    todayIso: "2026-11-17",
    centerWeekNumber: 12,
    count: 3,
  });
  assert.equal(columns[0]?.date, "2026-11-23");
  assert.equal(columns[0]?.referenceTag, "Prochain cours");
  assert.equal(columns[0]?.selected, true);
});

test("publications, contrôles et notes prof restent sur leur séance", () => {
  const sessions = mondaySessions();
  const monday16 = sessions[0]!;
  const monday23 = sessions[1]!;
  const monday30 = sessions[2]!;
  const items = [
    item({ id: 1, title: "Devoir du 16", type: "HOMEWORK", courseSessionKey: monday16.key, courseSessionDate: monday16.date, schoolWeekNumber: 12 }),
    item({ id: 2, title: "Devoir du 23", type: "HOMEWORK", courseSessionKey: monday23.key, courseSessionDate: monday23.date, schoolWeekNumber: 13 }),
    item({ id: 3, title: "Contrôle du 30", type: "TEST", courseSessionKey: monday30.key, courseSessionDate: monday30.date, schoolWeekNumber: 14 }),
  ];
  let notes = createEmptyNotesDocument();
  notes = setSessionRichNote(notes, sessionNotesKey(monday16.key), noteDoc("Note du 16"));
  notes = setSessionRichNote(notes, sessionNotesKey(monday23.key), noteDoc("Note du 23"));

  const before = sessions.map((session) => ({
    date: session.date,
    items: itemsForCourseSession(items, session, sessions).map((entry) => entry.title),
    notes: listSessionNotes(notes, sessionNotesKey(session.key)).map((entry) => entry.text),
  }));

  const selected = selectNotebookColumn(monday16.key, monday23.key);
  const shifted = shiftNotebookWindow(sessions, selected, 1, selected.windowStartKey);
  assert.ok(shifted);
  const after = sessions.map((session) => ({
    date: session.date,
    items: itemsForCourseSession(items, session, sessions).map((entry) => entry.title),
    notes: listSessionNotes(notes, sessionNotesKey(session.key)).map((entry) => entry.text),
  }));
  assert.deepEqual(after, before);
  assert.deepEqual(before[0]?.items, ["Devoir du 16"]);
  assert.deepEqual(before[1]?.notes, ["Note du 23"]);
  assert.deepEqual(before[2]?.items, ["Contrôle du 30"]);
  assert.notEqual(shifted.windowStartKey, selected.windowStartKey);
});

test("semaines A/B : la sélection ne mélange pas les séances", () => {
  const weeks: SchoolWeekEntry[] = [
    { number: 12, kind: "A", monday: "2026-11-16" },
    { number: 13, kind: "B", monday: "2026-11-23" },
    { number: 14, kind: "A", monday: "2026-11-30" },
    { number: 15, kind: "B", monday: "2026-12-07" },
  ];
  const sessions = sessionsFor({ slots: [slot("lundi-a", 1, "A")], weeks });
  assert.deepEqual(sessions.map((session) => session.date), ["2026-11-16", "2026-11-30"]);
  assert.ok(sessions.every((session) => session.weekKind === "A"));
  const selected = selectNotebookColumn(sessions[0]!.key, sessions[1]!.key);
  const columns = notebookVisibleColumns({
    sessions,
    ...selected,
    todayIso: "2026-11-16",
    centerWeekNumber: 12,
    count: 2,
  });
  assert.deepEqual(columns.map((column) => [column.date, column.weekKind, column.selected]), [
    ["2026-11-16", "A", false],
    ["2026-11-30", "A", true],
  ]);
});

test("plusieurs séances dans la même semaine restent dans l’ordre", () => {
  const sessions = sessionsFor({ slots: [slot("lundi", 1, "all"), slot("jeudi", 4, "all")] });
  const monday = sessions.find((session) => session.date === "2026-11-16")!;
  const thursday = sessions.find((session) => session.date === "2026-11-19")!;
  const selected = selectNotebookColumn(monday.key, thursday.key);
  const columns = notebookVisibleColumns({
    sessions,
    ...selected,
    todayIso: "2026-11-16",
    centerWeekNumber: 12,
    count: 3,
  });
  assert.deepEqual(columns.map((column) => column.date), ["2026-11-16", "2026-11-19", "2026-11-23"]);
  assert.equal(columns.find((column) => column.date === "2026-11-16")?.referenceTag, "Aujourd’hui");
  assert.equal(columns.find((column) => column.date === "2026-11-19")?.selected, true);
  assert.equal(columns.filter((column) => column.schoolWeekNumber === 12).length, 2);
});

test("smartphone : une séance à la fois, la flèche change la séance visible sans la sélectionner", () => {
  const sessions = mondaySessions();
  const opened = openOnReference(sessions);
  assert.deepEqual(datesOf(opened, sessions, 1), ["2026-11-16"]);
  const shifted = shiftNotebookWindow(sessions, opened, 1, opened.windowStartKey);
  assert.ok(shifted);
  assert.deepEqual(datesOf(shifted, sessions, 1), ["2026-11-23"]);
  assert.equal(selectedDate(shifted, sessions, 1), null);
  assert.equal(shifted.selectedSessionKey, sessions[0]!.key);
  const clicked = selectNotebookColumn(shifted.windowStartKey, sessions[1]!.key);
  assert.deepEqual(datesOf(clicked, sessions, 1), ["2026-11-23"]);
  assert.equal(selectedDate(clicked, sessions, 1), "2026-11-23");
});

test("une édition en cours diffère le changement de date, et le mode manuel ne recentre pas", () => {
  const sessions = mondaySessions();
  const manual = selectNotebookColumn(sessions[1]!.key, sessions[2]!.key);
  assert.equal(notebookTodayUpdate("2026-11-16", "2026-11-17", true), "defer");
  assert.deepEqual(datesOf(manual, sessions, 3, "2026-11-16"), datesOf(manual, sessions, 3, "2026-11-23"));
  assert.equal(selectedDate(manual, sessions, 3, "2026-11-23"), "2026-11-30");
});

test("années en préparation et archivées : pas de suivi de la date réelle", () => {
  for (const schoolYearStatus of ["draft", "archived"] as const) {
    assert.equal(notebookAutoFollowAllowed(schoolYearStatus), false);
    assert.equal(
      notebookOpeningFollowMode({
        source: "ma-semaine",
        schoolYearStatus,
        selectedSchoolWeekNumber: 14,
        todaySchoolWeekNumber: 12,
      }),
      "manual",
    );
  }
  const sessions = mondaySessions();
  const week14 = sessions.find((session) => session.schoolWeekNumber === 14)!;
  const focus: NotebookColumnFocus = { followMode: "manual", windowStartKey: week14.key, selectedSessionKey: week14.key };
  const columns = notebookVisibleColumns({
    sessions,
    ...focus,
    todayIso: "2026-11-16",
    centerWeekNumber: 14,
    count: 3,
    referenceEnabled: false,
  });
  assert.equal(columns[0]?.date, "2026-11-30");
  assert.ok(columns.every((column) => column.referenceTag == null));
  const selected = selectNotebookColumn(focus.windowStartKey, sessions[3]!.key);
  assert.equal(datesOf(selected, sessions, 3)[0], "2026-11-30");
});

test("le Carnet sépare le clic, les flèches et le bouton Aujourd’hui", async () => {
  const panel = await readFile(new URL("../web/app/components/class-notebook-panel.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../web/app/globals.css", import.meta.url), "utf8");
  const select = panel.slice(panel.indexOf("function selectSessionManually"), panel.indexOf("function followReferenceSession"));
  const shift = panel.slice(panel.indexOf("function shiftVisibleWeeks"), panel.indexOf("const onCreatePublication"));
  assert.match(select, /selectNotebookColumn\(displayStartSession\?\.key \?\? centerSessionKey, session\.key\)/);
  assert.doesNotMatch(select, /onCenterWeekChange/);
  assert.match(shift, /shiftNotebookWindow\(/);
  assert.doesNotMatch(shift, /selectSessionManually/);
  assert.match(panel, /focusNotebookReference\(orderedSessions, now\)/);
  assert.match(panel, /editingInProgress = editor != null \|\| controlEditor != null \|\| dragPayload != null/);
  assert.match(panel, /notebookTodayUpdate\(todayIso, observedTodayIso, editingInProgress\) === "apply"/);
  assert.doesNotMatch(panel, /scrollIntoView/);
  assert.match(css, /\.class-notebook-column\.active \{\n  border-color: #85a9e8;\n  background: #f4f8ff;/);
  const mobileCss = css.slice(css.indexOf("/* Carnet enseignant — smartphone"));
  assert.match(mobileCss, /\.class-notebook-grid > \.class-notebook-column:not\(\.active\) \{ display: none; \}/);
  assert.match(mobileCss, /\.class-notebook-grid\.class-notebook-grid-1 > \.class-notebook-column:only-child \{ display: grid; \}/);
});
