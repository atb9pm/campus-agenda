import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { PrototypeAgendaItem } from "../src/features/agenda/demo-items.ts";
import type { CourseDaySlot } from "../src/features/calendar/types.ts";
import type { CourseScheduleSlot } from "../src/features/course-schedule/types.ts";
import { listFutureTestsForClass } from "../src/features/evaluations/index.ts";
import type { Subject } from "../src/types/classroom.ts";
import {
  buildStudentCourseDaySections,
  classScopedStudentScheduleSlots,
  firstPeriodForSubjectOnDay,
  groupItemsBySubject,
  studentHomeworkOnlySections,
  studentTodoSections,
  toStudentDayScheduleSlot,
} from "../src/features/student/index.ts";

const CLASSROOM_ID = "classroom-mecaut03a";
const GENERALE: Subject = {
  id: "subj-generale",
  classroomId: CLASSROOM_ID,
  name: "Branche générale",
  annualCourseId: "ac-generale",
};
const INJECTION: Subject = {
  id: "subj-injection",
  classroomId: CLASSROOM_ID,
  name: "CP Léger Injection, dépollution",
  annualCourseId: "ac-injection",
};
const ELECTRO: Subject = {
  id: "subj-electro",
  classroomId: CLASSROOM_ID,
  name: "CP1 Électrotechnique",
  annualCourseId: "ac-electro",
};
const TRANSMISSION: Subject = {
  id: "subj-transmission",
  classroomId: CLASSROOM_ID,
  name: "CP2 Transmission",
  annualCourseId: "ac-transmission",
};
const NOTES: Subject = {
  id: "subj-notes",
  classroomId: CLASSROOM_ID,
  name: "Notes de classe",
  annualCourseId: "ac-notes",
};

/** Catalogue volontairement dans l’ordre qui reproduisait le bug (électro avant injection). */
const CATALOG_SUBJECTS = [ELECTRO, INJECTION, GENERALE, TRANSMISSION, NOTES];

function monday(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year!, month! - 1, day, 12);
}

function courseDay(iso: string, dayIndex: number, weekKind: "A" | "B" | null, week = 9): CourseDaySlot {
  const date = monday(iso);
  date.setDate(date.getDate() + dayIndex);
  return { schoolWeekNumber: week, weekKind, date, dayIndex };
}

function slot(
  annualCourseId: string,
  patch: Partial<CourseScheduleSlot> & Pick<CourseScheduleSlot, "periodStart" | "periodEnd">,
): CourseScheduleSlot {
  return {
    id: `slot-${annualCourseId}-${patch.periodStart}-${patch.weekKind ?? "all"}-${patch.dayOfWeek ?? 1}`,
    annualCourseId,
    dayOfWeek: 1,
    weekKind: "all",
    validFrom: null,
    validTo: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...patch,
  };
}

const MONDAY_A = courseDay("2026-10-26", 0, "A");
const MONDAY_B = courseDay("2026-11-02", 0, "B", 10);

const MECAUT03A_MONDAY_SLOTS = [
  slot("ac-generale", { periodStart: 1, periodEnd: 3 }),
  slot("ac-injection", { periodStart: 4, periodEnd: 4 }),
  slot("ac-injection", { periodStart: 6, periodEnd: 6 }),
  slot("ac-electro", { periodStart: 7, periodEnd: 8 }),
  slot("ac-transmission", { periodStart: 9, periodEnd: 9 }),
].map(toStudentDayScheduleSlot);

function item(
  partial: Partial<PrototypeAgendaItem> & Pick<PrototypeAgendaItem, "id" | "type" | "title" | "subjectId">,
): PrototypeAgendaItem {
  const subject = CATALOG_SUBJECTS.find((entry) => entry.id === partial.subjectId);
  return {
    classroomId: CLASSROOM_ID,
    authorTeacherId: "teacher-1",
    day: 0,
    hour: 8,
    weekOffset: 0,
    schoolWeekNumber: 9,
    detail: "",
    annualCourseId: subject?.annualCourseId ?? null,
    ...partial,
  };
}

const MONDAY_PUBLICATIONS = [
  item({
    id: 1,
    type: "HOMEWORK",
    title: "Cours général",
    subjectId: GENERALE.id,
    hour: 16,
  }),
  item({
    id: 2,
    type: "INFORMATION",
    title: "Labo injection",
    subjectId: INJECTION.id,
    hour: 18,
  }),
  item({
    id: 3,
    type: "HOMEWORK",
    title: "Schéma électrique",
    subjectId: ELECTRO.id,
    hour: 8,
  }),
  item({
    id: 4,
    type: "HOMEWORK",
    title: "Boîte de vitesses",
    subjectId: TRANSMISSION.id,
    hour: 7,
  }),
];

test("lundi MECAUT03A — branches dans l’ordre de la première période, pas du catalogue", () => {
  const groups = groupItemsBySubject(MONDAY_PUBLICATIONS, CATALOG_SUBJECTS, {
    scheduleSlots: MECAUT03A_MONDAY_SLOTS,
    courseDay: MONDAY_A,
  });
  assert.deepEqual(
    groups.map((group) => group.subject.name),
    [
      "Branche générale",
      "CP Léger Injection, dépollution",
      "CP1 Électrotechnique",
      "CP2 Transmission",
    ],
  );
  assert.equal(firstPeriodForSubjectOnDay(GENERALE, MECAUT03A_MONDAY_SLOTS, MONDAY_A), 1);
  assert.equal(firstPeriodForSubjectOnDay(INJECTION, MECAUT03A_MONDAY_SLOTS, MONDAY_A), 4);
  assert.equal(firstPeriodForSubjectOnDay(ELECTRO, MECAUT03A_MONDAY_SLOTS, MONDAY_A), 7);
  assert.equal(firstPeriodForSubjectOnDay(TRANSMISSION, MECAUT03A_MONDAY_SLOTS, MONDAY_A), 9);

  const sections = buildStudentCourseDaySections(
    MONDAY_PUBLICATIONS,
    CATALOG_SUBJECTS,
    [],
    { scheduleSlots: MECAUT03A_MONDAY_SLOTS, courseDay: MONDAY_A },
  );
  assert.deepEqual(
    sections.map((section) => section.subject.name),
    groups.map((group) => group.subject.name),
  );
  const homework = studentHomeworkOnlySections(sections);
  const todo = studentTodoSections(sections);
  assert.deepEqual(
    homework.map((section) => section.subject.name),
    ["Branche générale", "CP1 Électrotechnique", "CP2 Transmission"],
  );
  assert.deepEqual(todo.map((section) => section.subject.name), sections.map((section) => section.subject.name));
});

test("créneaux séparés P4 et P6 — un seul bloc, trié sur la première période", () => {
  const groups = groupItemsBySubject(
    [
      item({ id: 10, type: "HOMEWORK", title: "P6", subjectId: INJECTION.id, hour: 15 }),
      item({ id: 11, type: "HOMEWORK", title: "P4", subjectId: INJECTION.id, hour: 9 }),
    ],
    [ELECTRO, INJECTION],
    { scheduleSlots: MECAUT03A_MONDAY_SLOTS, courseDay: MONDAY_A },
  );
  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.subject.name, "CP Léger Injection, dépollution");
  assert.equal(groups[0]?.items.length, 2);
});

test("alternance A/B — un créneau B n’ordonne pas le lundi A", () => {
  const slots = [
    slot("ac-injection", { periodStart: 4, periodEnd: 4, weekKind: "all" }),
    slot("ac-electro", { periodStart: 1, periodEnd: 2, weekKind: "B" }),
  ].map(toStudentDayScheduleSlot);
  const pubs = [
    item({ id: 20, type: "HOMEWORK", title: "Injection", subjectId: INJECTION.id }),
    item({ id: 21, type: "HOMEWORK", title: "Électro", subjectId: ELECTRO.id }),
  ];
  const weekA = groupItemsBySubject(pubs, [ELECTRO, INJECTION], {
    scheduleSlots: slots,
    courseDay: MONDAY_A,
  });
  assert.deepEqual(
    weekA.map((group) => group.subject.name),
    ["CP Léger Injection, dépollution", "CP1 Électrotechnique"],
  );
  const weekB = groupItemsBySubject(pubs, [ELECTRO, INJECTION], {
    scheduleSlots: slots,
    courseDay: MONDAY_B,
  });
  assert.deepEqual(
    weekB.map((group) => group.subject.name),
    ["CP1 Électrotechnique", "CP Léger Injection, dépollution"],
  );
});

test("validité des dates — un créneau futur n’ordonne pas le jour consulté", () => {
  const slots = [
    slot("ac-generale", { periodStart: 1, periodEnd: 3 }),
    slot("ac-injection", { periodStart: 2, periodEnd: 2, validFrom: "2026-11-01" }),
    slot("ac-electro", { periodStart: 7, periodEnd: 8, validTo: "2026-10-20" }),
  ].map(toStudentDayScheduleSlot);
  const pubs = [
    item({ id: 30, type: "HOMEWORK", title: "Générale", subjectId: GENERALE.id }),
    item({ id: 31, type: "HOMEWORK", title: "Injection", subjectId: INJECTION.id }),
    item({ id: 32, type: "HOMEWORK", title: "Électro", subjectId: ELECTRO.id }),
  ];
  const groups = groupItemsBySubject(pubs, [ELECTRO, INJECTION, GENERALE], {
    scheduleSlots: slots,
    courseDay: MONDAY_A,
  });
  assert.equal(firstPeriodForSubjectOnDay(INJECTION, slots, MONDAY_A), null);
  assert.equal(firstPeriodForSubjectOnDay(ELECTRO, slots, MONDAY_A), null);
  assert.deepEqual(
    groups.map((group) => group.subject.name),
    ["Branche générale", "CP1 Électrotechnique", "CP Léger Injection, dépollution"],
  );
});

test("publication sans horaire — après les branches planifiées, ordre catalogue stable", () => {
  const pubs = [
    item({ id: 40, type: "HOMEWORK", title: "Note", subjectId: NOTES.id, hour: 6 }),
    ...MONDAY_PUBLICATIONS,
  ];
  const groups = groupItemsBySubject(pubs, CATALOG_SUBJECTS, {
    scheduleSlots: MECAUT03A_MONDAY_SLOTS,
    courseDay: MONDAY_A,
  });
  assert.deepEqual(
    groups.map((group) => group.subject.name),
    [
      "Branche générale",
      "CP Léger Injection, dépollution",
      "CP1 Électrotechnique",
      "CP2 Transmission",
      "Notes de classe",
    ],
  );
});

test("l’heure technique de la publication n’influence pas l’ordre des branches", () => {
  const pubs = [
    item({ id: 50, type: "HOMEWORK", title: "Électro tôt", subjectId: ELECTRO.id, hour: 6 }),
    item({ id: 51, type: "HOMEWORK", title: "Injection tard", subjectId: INJECTION.id, hour: 20 }),
  ];
  const groups = groupItemsBySubject(pubs, [ELECTRO, INJECTION], {
    scheduleSlots: MECAUT03A_MONDAY_SLOTS,
    courseDay: MONDAY_A,
  });
  assert.deepEqual(
    groups.map((group) => group.subject.name),
    ["CP Léger Injection, dépollution", "CP1 Électrotechnique"],
  );
});

test("jours précédents — le mardi suit l’horaire du mardi, pas celui du lundi", () => {
  const tuesday = courseDay("2026-10-26", 1, "A");
  const slots = [
    ...MECAUT03A_MONDAY_SLOTS,
    ...[
      slot("ac-electro", { periodStart: 1, periodEnd: 4, dayOfWeek: 2 }),
      slot("ac-generale", { periodStart: 6, periodEnd: 8, dayOfWeek: 2 }),
    ].map(toStudentDayScheduleSlot),
  ];
  const pubs = [
    item({ id: 60, type: "HOMEWORK", title: "Électro", subjectId: ELECTRO.id, day: 1 }),
    item({ id: 61, type: "HOMEWORK", title: "Générale", subjectId: GENERALE.id, day: 1 }),
  ];
  const groups = groupItemsBySubject(pubs, CATALOG_SUBJECTS, {
    scheduleSlots: slots,
    courseDay: tuesday,
  });
  assert.deepEqual(
    groups.map((group) => group.subject.name),
    ["CP1 Électrotechnique", "Branche générale"],
  );
});

test("contrôles à venir — ordre chronologique inchangé", () => {
  const catalog = {
    classrooms: [{ id: CLASSROOM_ID, name: "MECAUT03A", programLabel: "", accessCodeHint: "" }],
    subjects: CATALOG_SUBJECTS,
    memberships: [],
    teachers: [],
  };
  const weeks = [
    { number: 9, kind: "A" as const, monday: monday("2026-10-26") },
    { number: 10, kind: "B" as const, monday: monday("2026-11-02") },
  ];
  const tests = [
    item({
      id: 70,
      type: "TEST",
      title: "Contrôle injection",
      subjectId: INJECTION.id,
      schoolWeekNumber: 10,
      day: 0,
    }),
    item({
      id: 71,
      type: "TEST",
      title: "Contrôle générale",
      subjectId: GENERALE.id,
      schoolWeekNumber: 9,
      day: 1,
    }),
  ];
  const upcoming = listFutureTestsForClass(tests, catalog, CLASSROOM_ID, monday("2026-10-26"), weeks);
  assert.deepEqual(
    upcoming.map((entry) => entry.item.title),
    ["Contrôle générale", "Contrôle injection"],
  );
});

test("API — seuls les horaires de la classe autorisée, champs publics", () => {
  const own = {
    ...slot("ac-generale", { periodStart: 1, periodEnd: 3 }),
    teacherNote: "secret",
  } as CourseScheduleSlot & { teacherNote: string };
  const otherClass = slot("ac-other-class", { periodStart: 1, periodEnd: 2 });
  const scoped = classScopedStudentScheduleSlots([own, otherClass], new Set(["ac-generale"]));
  assert.equal(scoped.length, 1);
  assert.deepEqual(Object.keys(scoped[0]!).sort(), [
    "annualCourseId",
    "dayOfWeek",
    "periodEnd",
    "periodStart",
    "validFrom",
    "validTo",
    "weekKind",
  ]);
  assert.equal("id" in scoped[0]!, false);
  assert.equal("createdAt" in scoped[0]!, false);
  assert.equal("updatedAt" in scoped[0]!, false);
  assert.equal("teacherNote" in scoped[0]!, false);
  assert.deepEqual(toStudentDayScheduleSlot(own).annualCourseId, "ac-generale");
});

test("sources — agenda élève trie sur l’horaire du jour consulté", async () => {
  const [order, view, sections, route, client, page, homework] = await Promise.all([
    readFile(new URL("../src/features/student/course-day-order.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/student/course-day-view.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/student/upcoming-controls.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/app/api/agenda/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/lib/api-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/components/student-homework-panel.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(order, /firstPeriodForSubjectOnDay/);
  assert.match(order, /classScopedStudentScheduleSlots/);
  assert.doesNotMatch(order, /item\.hour/);
  assert.match(view, /orderByDaySchedule/);
  assert.match(sections, /scheduleSlots: options\.scheduleSlots/);
  assert.match(route, /requireClassroomReadAccess/);
  assert.match(route, /listPublicScheduleSlotsForClassroom/);
  assert.match(route, /scheduleSlots/);
  assert.doesNotMatch(route, /listAssignments\(/);
  assert.doesNotMatch(route, /getAnnualCourseNotesStore/);
  assert.match(client, /scheduleSlots: payload\.scheduleSlots \?\? \[\]/);
  assert.match(page, /scheduleSlots: studentPreviewScheduleSlots/);
  assert.match(page, /courseDay: studentDisplayCourseDay/);
  assert.match(page, /scheduleSlotsFromAgendaView/);
  assert.match(page, /teacher-preview/);
  assert.match(homework, /studentHomeworkOnlySections/);
  assert.match(homework, /studentTodoSections/);
});
