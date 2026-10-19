import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { UNDEFINED_BRANCH_LABEL } from "../src/features/agenda-bridge/index.ts";
import type { PrototypeAgendaItem } from "../src/features/agenda/demo-items.ts";
import { formatCourseDayHeading } from "../src/features/calendar/index.ts";
import type { SchoolWeek } from "../src/features/calendar/types.ts";
import {
  calendarDateKey,
  calendarDaysBetween,
  listFutureTestsForClass,
} from "../src/features/evaluations/index.ts";
import { APP_VERSION } from "../src/lib/app-version.ts";
import { SQL_MIGRATION_FILES } from "../src/lib/persistence/sql/migrate.ts";
import {
  buildStudentCourseDaySections,
  compactControlPresentation,
  compareStudentPublications,
  formatCompactControlDate,
  formatNextControlHeadline,
  groupControlPlanning,
  msUntilNextLocalMidnight,
  nextControlHeadlineForEntries,
  nextControlsForSubject,
  studentHomeworkOnlySections,
  studentTodoSections,
  studentCalendarDateNeedsRefresh,
} from "../src/features/student/index.ts";

const CLASSROOM_ID = "classroom-school-cl-1";
const INJECTION_ID = "subject-course-ac-injection";
const TRANSMISSION_ID = "subject-course-ac-transmission";
const INJECTION_LABEL = "CP Léger Injection, dépollution";
const TRANSMISSION_LABEL = "CP 2 Transmission";

function monday(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

const WEEKS: SchoolWeek[] = [
  { number: 7, kind: "A", monday: monday("2026-09-28") },
  { number: 8, kind: "B", monday: monday("2026-10-05") },
  { number: 10, kind: "B", monday: monday("2026-10-19") },
  { number: 14, kind: "A", monday: monday("2026-11-16") },
];

const CATALOG = {
  classrooms: [{
    id: CLASSROOM_ID,
    name: "MMA1A",
    programLabel: "",
    accessCodeHint: "",
  }],
  subjects: [
    { id: INJECTION_ID, name: INJECTION_LABEL, classroomId: CLASSROOM_ID },
    { id: TRANSMISSION_ID, name: TRANSMISSION_LABEL, classroomId: CLASSROOM_ID },
  ],
  memberships: [],
  teachers: [],
};

function item(partial: Partial<PrototypeAgendaItem> & Pick<PrototypeAgendaItem, "id" | "type" | "title" | "subjectId" | "schoolWeekNumber" | "day">): PrototypeAgendaItem {
  return {
    classroomId: CLASSROOM_ID,
    authorTeacherId: "teacher-1",
    hour: 8,
    weekOffset: 0,
    detail: "",
    ...partial,
  };
}

const REVISION = item({
  id: 100,
  type: "TEST",
  title: "Révision",
  subjectId: INJECTION_ID,
  schoolWeekNumber: 7,
  day: 0,
  detail: "",
});
const INJECTION_TEST = item({
  id: 101,
  type: "TEST",
  title: "Injection",
  subjectId: INJECTION_ID,
  schoolWeekNumber: 10,
  day: 0,
});
const DEPOLLUTION = item({
  id: 102,
  type: "TEST",
  title: "Dépollution",
  subjectId: INJECTION_ID,
  schoolWeekNumber: 14,
  day: 0,
});
const TRANSMISSION_TEST = item({
  id: 103,
  type: "TEST",
  title: "Contrôle 1",
  subjectId: TRANSMISSION_ID,
  schoolWeekNumber: 7,
  day: 3,
});
const HOMEWORK_MOTEUR = item({
  id: 1,
  type: "HOMEWORK",
  title: "Moteur",
  subjectId: INJECTION_ID,
  schoolWeekNumber: 7,
  day: 0,
  detail: "Terminer le moteur",
});
const HOMEWORK_CLIM = item({
  id: 2,
  type: "HOMEWORK",
  title: "Climatisation",
  subjectId: INJECTION_ID,
  schoolWeekNumber: 7,
  day: 0,
  detail: "À finir p. 9",
});
const INFO = item({
  id: 3,
  type: "INFORMATION",
  title: "Salle changée",
  subjectId: INJECTION_ID,
  schoolWeekNumber: 7,
  day: 0,
});

function future(from: Date, extra: PrototypeAgendaItem[] = []) {
  return listFutureTestsForClass(
    [REVISION, INJECTION_TEST, DEPOLLUTION, TRANSMISSION_TEST, HOMEWORK_MOTEUR, HOMEWORK_CLIM, INFO, ...extra],
    CATALOG,
    CLASSROOM_ID,
    from,
    WEEKS,
  );
}

test("version 2.61.8 — prochain contrôle élève, pas de migration", async () => {
  assert.equal(APP_VERSION, "2.62.0");
  assert.equal(SQL_MIGRATION_FILES.at(-1), "0032_year_transition_apply.sql");
});

test("1 — le contrôle apparaît avant les devoirs", () => {
  const today = monday("2026-09-28");
  const sections = buildStudentCourseDaySections(
    [HOMEWORK_MOTEUR, HOMEWORK_CLIM, REVISION, INFO],
    CATALOG.subjects,
    future(today),
  );
  const injection = sections.find((section) => section.subject.name === INJECTION_LABEL);
  assert.ok(injection);
  assert.equal(injection.nextControls[0]?.item.title, "Révision");
  assert.deepEqual(injection.publications.map((entry) => entry.type), ["HOMEWORK", "HOMEWORK", "INFORMATION"]);
  assert.deepEqual(injection.publications.map((entry) => entry.title), ["Moteur", "Climatisation", "Salle changée"]);
});

test("2 — l’ordre de création n’influence pas l’affichage", () => {
  const today = monday("2026-09-28");
  const lateHomework = { ...HOMEWORK_MOTEUR, id: 9000, title: "Atelier" };
  const earlyTest = { ...REVISION, id: 9 };
  const sections = buildStudentCourseDaySections(
    [lateHomework, HOMEWORK_CLIM, earlyTest],
    CATALOG.subjects,
    future(today, [lateHomework, earlyTest]),
  );
  const injection = sections.find((section) => section.subject.id === INJECTION_ID);
  assert.ok(injection);
  assert.equal(injection.nextControls[0]?.item.title, "Révision");
  assert.deepEqual(injection.publications.map((entry) => entry.title), ["Atelier", "Climatisation"]);
});

test("3 — seul le prochain contrôle futur d’une branche est affiché dans Cours", () => {
  const today = monday("2026-09-28");
  const next = nextControlsForSubject(future(today), INJECTION_ID);
  assert.deepEqual(next.map((entry) => entry.item.title), ["Révision"]);
  assert.ok(!next.some((entry) => entry.item.title === "Injection"));
  assert.ok(!next.some((entry) => entry.item.title === "Dépollution"));
});

test("4 — le contrôle du jour reste affiché pendant toute sa date", () => {
  const morning = new Date(2026, 8, 28, 8, 15);
  const evening = new Date(2026, 8, 28, 22, 45);
  assert.equal(calendarDateKey(morning), "2026-09-28");
  assert.equal(calendarDateKey(evening), "2026-09-28");
  assert.equal(nextControlsForSubject(future(morning), INJECTION_ID)[0]?.item.title, "Révision");
  assert.equal(nextControlsForSubject(future(evening), INJECTION_ID)[0]?.item.title, "Révision");
});

test("5 — le lendemain, le contrôle suivant prend automatiquement sa place", () => {
  const nextDay = new Date(2026, 8, 29, 9);
  const next = nextControlsForSubject(future(nextDay), INJECTION_ID);
  assert.equal(next[0]?.item.title, "Injection");
  assert.ok(!next.some((entry) => entry.item.title === "Révision"));
});

test("6 — aucun bloc n’est affiché si aucun contrôle futur n’existe", () => {
  const today = monday("2026-11-17");
  const sections = buildStudentCourseDaySections(
    [HOMEWORK_MOTEUR],
    CATALOG.subjects,
    future(today),
  );
  const injection = sections.find((section) => section.subject.id === INJECTION_ID);
  assert.ok(injection);
  assert.equal(injection.nextControls.length, 0);
  assert.equal(injection.publications.length, 1);
});

test("7 — plusieurs contrôles à la même prochaine date ne sont pas perdus", () => {
  const sameDay = item({
    id: 220,
    type: "TEST",
    title: "Mesures antipollution",
    subjectId: INJECTION_ID,
    schoolWeekNumber: 7,
    day: 0,
  });
  const today = monday("2026-09-28");
  const next = nextControlsForSubject(future(today, [sameDay]), INJECTION_ID);
  assert.deepEqual(next.map((entry) => entry.item.title), ["Mesures antipollution", "Révision"]);
});

test("8 / 9 / 10 — J-7, J-1 et J-0 affichent l’avertissement attendu", () => {
  const dateLabel = "Lundi 19 octobre";
  assert.equal(formatNextControlHeadline(8, dateLabel, 1).kicker, "CONTRÔLE · Lundi 19 octobre");
  assert.equal(formatNextControlHeadline(8, dateLabel, 1).warn, false);
  const week = formatNextControlHeadline(7, dateLabel, 1);
  assert.equal(week.kicker, "⚠ CONTRÔLE DANS 7 JOURS");
  assert.equal(week.dateLabel, dateLabel);
  assert.equal(week.warn, true);
  assert.equal(formatNextControlHeadline(3, dateLabel, 1).kicker, "⚠ CONTRÔLE DANS 3 JOURS");
  const tomorrow = formatNextControlHeadline(1, dateLabel, 1);
  assert.equal(tomorrow.kicker, "⚠ CONTRÔLE DEMAIN");
  assert.equal(tomorrow.dateLabel, null);
  const today = formatNextControlHeadline(0, dateLabel, 1);
  assert.equal(today.kicker, "CONTRÔLE AUJOURD’HUI");
  assert.equal(today.urgency, "today");
});

test("11 / 12 / 13 — planning : tous les futurs, chrono, sans passés", () => {
  const today = monday("2026-09-29");
  const entries = future(today);
  const planning = groupControlPlanning(entries);
  assert.ok(!entries.some((entry) => entry.item.title === "Révision"));
  assert.deepEqual(
    entries.map((entry) => entry.item.title),
    ["Contrôle 1", "Injection", "Dépollution"],
  );
  assert.deepEqual(
    planning.map((week) => week.weekLabel),
    ["Semaine 07-A", "Semaine 10-B", "Semaine 14-A"],
  );
  assert.equal(planning[0]?.days[0]?.entries[0]?.item.title, "Contrôle 1");
  assert.ok(planning.every((week) =>
    week.days.every((day) => calendarDateKey(day.slot.date) >= "2026-09-29"),
  ));
});

test("14 / 15 — aucun subject-course-* ; vrai SchoolBranch.label", () => {
  const today = monday("2026-09-28");
  const entries = future(today);
  const sections = buildStudentCourseDaySections(
    [HOMEWORK_MOTEUR, REVISION],
    CATALOG.subjects,
    entries,
  );
  for (const section of sections) {
    assert.ok(!section.subject.name.startsWith("subject-course-"));
    assert.notEqual(section.subject.name, UNDEFINED_BRANCH_LABEL);
  }
  assert.equal(sections.find((section) => section.subject.id === INJECTION_ID)?.subject.name, INJECTION_LABEL);
  assert.equal(sections.find((section) => section.subject.id === TRANSMISSION_ID)?.subject.name, TRANSMISSION_LABEL);
  assert.ok(entries.every((entry) => !entry.subjectName.startsWith("subject-course-")));
  assert.ok(entries.every((entry) => entry.subjectName !== UNDEFINED_BRANCH_LABEL));
});

test("16 — aucune duplication du même contrôle dans l’onglet Cours", () => {
  const today = monday("2026-09-28");
  const sections = buildStudentCourseDaySections(
    [HOMEWORK_MOTEUR, REVISION, INJECTION_TEST],
    CATALOG.subjects,
    future(today),
  );
  const injection = sections.find((section) => section.subject.id === INJECTION_ID);
  assert.ok(injection);
  assert.ok(!injection.publications.some((entry) => entry.type === "TEST"));
  assert.equal(injection.nextControls.filter((entry) => entry.item.id === REVISION.id).length, 1);
  assert.ok(!injection.nextControls.some((entry) => entry.item.id === INJECTION_TEST.id));
});

test("17 — prefers-reduced-motion désactive l’animation", async () => {
  const [css, controls] = await Promise.all([
    readFile(new URL("../web/app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../web/app/components/student-controls-panel.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(css, /@keyframes student-control-warn-pulse/);
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]{0,180}animation: none !important/);
  assert.doesNotMatch(css, /\.student-next-control \{[^}]*animation:/);
  assert.match(controls, /student-visually-hidden/);
  assert.match(controls, /controlAgendaDateParts/);
});

test("jours calendaires — J-7 à partir de la date locale, pas de l’heure", () => {
  const today = new Date(2026, 9, 12, 22, 10);
  const controlDate = monday("2026-10-19");
  assert.equal(calendarDaysBetween(today, controlDate), 7);
  const headline = nextControlHeadlineForEntries(
    [{
      item: INJECTION_TEST,
      slot: {
        schoolWeekNumber: 10,
        weekKind: "B",
        date: controlDate,
        dayIndex: 0,
      },
      subjectName: INJECTION_LABEL,
      teacherName: "Enseignant",
    }],
    today,
    formatCourseDayHeading({
      schoolWeekNumber: 10,
      weekKind: "B",
      date: controlDate,
      dayIndex: 0,
    }),
  );
  assert.equal(headline?.kicker, "⚠ CONTRÔLE DANS 7 JOURS");
});

test("Passés — un cours précédent n’affiche aucun prochain contrôle", () => {
  const today = monday("2026-09-28");
  const sections = buildStudentCourseDaySections(
    [HOMEWORK_MOTEUR, REVISION],
    CATALOG.subjects,
    future(today),
    { includeNextControls: false },
  );
  const injection = sections.find((section) => section.subject.id === INJECTION_ID);
  assert.ok(injection);
  assert.equal(injection.nextControls.length, 0);
  assert.deepEqual(injection.publications.map((entry) => entry.title), ["Moteur"]);
  assert.ok(!sections.some((section) => section.nextControls.length > 0));
});

test("devoirs — HOMEWORK avant INFORMATION, ordre interne conservé", () => {
  const today = monday("2026-09-28");
  const sections = buildStudentCourseDaySections(
    [HOMEWORK_MOTEUR, INFO, HOMEWORK_CLIM],
    CATALOG.subjects,
    future(today),
  );
  const injection = sections.find((section) => section.subject.id === INJECTION_ID);
  assert.ok(injection);
  assert.deepEqual(injection.publications.map((entry) => entry.title), ["Moteur", "Climatisation", "Salle changée"]);
  assert.ok(compareStudentPublications(HOMEWORK_MOTEUR, INFO) < 0);
  assert.equal(compareStudentPublications(HOMEWORK_MOTEUR, HOMEWORK_CLIM), 0);
});

test("journée automatique Cours — suit studentToday, pas un new Date figé", async () => {
  const page = await readFile(new URL("../web/app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /resolveDisplayCourseDayFromAttendance\(studentToday,/);
  assert.match(page, /resolveDisplayCourseDay\(studentToday, schoolWeeksMemo\)/);
  assert.match(page, /\[attendanceDays, schoolWeeksMemo, studentToday\]/);
  assert.doesNotMatch(page, /resolveDisplayCourseDayFromAttendance\(new Date\(\)/);
  assert.doesNotMatch(page, /resolveDisplayCourseDay\(new Date\(\)/);
});

test("date élève — refresh au nouveau jour, pas de polling fréquent", () => {
  const morning = new Date(2026, 8, 28, 8, 15);
  const evening = new Date(2026, 8, 28, 22, 40);
  const nextMorning = new Date(2026, 8, 29, 0, 0, 1);
  assert.equal(studentCalendarDateNeedsRefresh(morning, evening), false);
  assert.equal(studentCalendarDateNeedsRefresh(evening, nextMorning), true);
  const delay = msUntilNextLocalMidnight(evening);
  assert.ok(delay > 60 * 60 * 1000);
  assert.ok(delay < 3 * 60 * 60 * 1000);
});

test("sources — Cours extrait le prochain contrôle, Planning réutilise les mêmes données", async () => {
  const [page, logic, dashboard, homework, controls] = await Promise.all([
    readFile(new URL("../web/app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/student/upcoming-controls.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/app/components/student-dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/components/student-homework-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/components/student-controls-panel.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(page, /listFutureTestsForClass/);
  assert.match(page, /buildStudentCourseDaySections/);
  assert.match(page, /groupControlPlanning/);
  assert.match(page, /includeNextControls: studentFollowingCourseDay/);
  assert.match(page, /studentCalendarDateNeedsRefresh/);
  assert.match(page, /visibilitychange/);
  assert.match(page, /msUntilNextLocalMidnight/);
  assert.match(page, /useState<StudentDashboardTab>\("tout"\)/);
  assert.match(controls, /Contrôles à venir/);
  assert.match(controls, /"Contrôles"/);
  assert.match(dashboard, /onTabChange=\{setStudentMobileTab\}|onTabChange/);
  assert.doesNotMatch(controls, /Voir tout le planning/);
  assert.doesNotMatch(dashboard, /role="tablist"/);
  assert.match(dashboard, /aria-pressed=\{selected\}/);
  assert.match(controls, /student-next-control/);
  assert.match(controls, /studentUpcomingPlainDetail/);
  assert.equal([...controls.matchAll(/function ControlRow/g)].length, 1);
  assert.match(controls, /ControlRow key=\{entry\.item\.id\}/);
  assert.equal([...controls.matchAll(/<ControlRow /g)].length, 1);
  assert.ok(controls.indexOf("student-course-chip") < controls.indexOf("<time"));
  assert.ok(controls.indexOf("{entry.item.title}") > controls.indexOf("<time"));
  assert.match(homework, /Cours du jour/);
  assert.doesNotMatch(homework, /DEVOIR/);
  assert.doesNotMatch(homework, /INFORMATION/);
  assert.doesNotMatch(page, /useMemo\(\(\) => new Date\(\), \[\]\)/);
  assert.doesNotMatch(page, /studentUpcomingHeadline/);
  assert.doesNotMatch(page, /Branche non définie/);
  assert.doesNotMatch(dashboard, /Branche non définie/);
  assert.doesNotMatch(page, /Aucun contrôle prévu/);
  assert.doesNotMatch(logic, /title\.localeCompare\(right\.title, "fr"\)/);
});

test("tableau de bord — Tout n’affiche pas les TEST dans Cours du jour", () => {
  const today = monday("2026-09-28");
  const sections = buildStudentCourseDaySections(
    [HOMEWORK_MOTEUR, INFO, REVISION],
    CATALOG.subjects,
    future(today),
  );
  const todo = studentTodoSections(sections);
  const homework = studentHomeworkOnlySections(sections);
  const injectionTodo = todo.find((section) => section.subject.id === INJECTION_ID);
  const injectionHomework = homework.find((section) => section.subject.id === INJECTION_ID);
  assert.ok(injectionTodo);
  assert.deepEqual(injectionTodo.publications.map((entry) => entry.type), ["HOMEWORK", "INFORMATION"]);
  assert.ok(!injectionTodo.publications.some((entry) => entry.type === "TEST"));
  assert.equal(injectionTodo.nextControls.length, 0);
  assert.ok(injectionHomework);
  assert.deepEqual(injectionHomework.publications.map((entry) => entry.type), ["HOMEWORK"]);
  assert.ok(!homework.some((section) => section.publications.some((entry) => entry.type === "INFORMATION")));
  assert.ok(!homework.some((section) => section.publications.some((entry) => entry.type === "TEST")));
});

test("tableau de bord — colonne Contrôles à venir liste tous les futurs, chrono", () => {
  const today = monday("2026-09-28");
  const entries = future(today);
  assert.ok(entries.length >= 3);
  assert.equal(entries[0]?.item.title, "Révision");
  const planning = groupControlPlanning(entries);
  const plannedIds = planning.flatMap((week) => week.days.flatMap((day) => day.entries.map((entry) => entry.item.id)));
  assert.deepEqual(plannedIds, entries.map((entry) => entry.item.id));
});

test("présentation compacte — J-7, DEMAIN, AUJOURD’HUI, date sans urgence", () => {
  const later = compactControlPresentation(8, monday("2026-10-19"));
  assert.equal(later.urgency, "later");
  assert.equal(later.warn, false);
  assert.equal(later.badge, formatCompactControlDate(monday("2026-10-19")));
  assert.match(later.badge, /19/i);
  const week = compactControlPresentation(7, monday("2026-10-19"));
  assert.equal(week.badge, "J-7");
  assert.equal(week.warn, true);
  assert.equal(compactControlPresentation(3, monday("2026-10-19")).badge, "J-3");
  const tomorrow = compactControlPresentation(1, monday("2026-10-19"));
  assert.equal(tomorrow.badge, "DEMAIN");
  assert.equal(tomorrow.urgency, "tomorrow");
  const today = compactControlPresentation(0, monday("2026-09-28"));
  assert.equal(today.badge, "AUJOURD’HUI");
  assert.equal(today.urgency, "today");
  assert.equal(today.warn, false);
});

test("tableau de bord — aperçu professeur et cours précédents restent branchés", async () => {
  const [page, dashboard, controls] = await Promise.all([
    readFile(new URL("../web/app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/components/student-dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/components/student-controls-panel.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(page, /<StudentDashboard/);
  assert.match(page, /teacher-preview/);
  assert.match(page, /includeNextControls: studentFollowingCourseDay/);
  assert.match(page, /studentPreviousCourseDays/);
  assert.match(page, /onBackToCurrent/);
  assert.match(page, /onSelectCourseDay/);
  assert.match(dashboard, /student-history-anchor desktop-only/);
  assert.match(dashboard, />\s*Passés\s*</);
  assert.match(controls, /student-visually-hidden/);
  assert.match(controls, /formatCourseDayHeading\(entry\.slot\)/);
  assert.doesNotMatch(page, /TYPE_LABELS/);
  assert.doesNotMatch(page, /void TYPE_LABELS/);
});
