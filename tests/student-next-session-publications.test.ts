import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { PrototypeAgendaItem } from "../src/features/agenda/demo-items.ts";
import type { CourseDaySlot, SchoolWeek } from "../src/features/calendar/types.ts";
import { SQL_MIGRATION_FILES } from "../src/lib/persistence/sql/migrate.ts";
import {
  STUDENT_AGENDA_REFRESH_INTERVAL_MS,
  STUDENT_NEXT_SESSION_HORIZON_DAYS,
  buildStudentCourseDaySections,
  formatNextSessionLabel,
  groupNextSessionsByDate,
  studentAgendaRefreshDue,
  nextSessionPublicationsByBranch,
  studentHomeworkOnlySections,
  studentTodoSections,
} from "../src/features/student/index.ts";
import type { Subject } from "../src/types/classroom.ts";

const CLASSROOM_ID = "classroom-mecauto2";
const MOTEUR_COURSE = "ac-cp3-moteur";
const CHASSIS_COURSE = "ac-cp3-chassis";

function localDate(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

const WEEKS: SchoolWeek[] = [
  { number: 10, kind: "A", monday: localDate("2026-11-02") },
  { number: 11, kind: "B", monday: localDate("2026-11-09") },
  { number: 12, kind: "A", monday: localDate("2026-11-16") },
  { number: 13, kind: "B", monday: localDate("2026-11-23") },
  { number: 14, kind: "A", monday: localDate("2026-12-14") },
  { number: 15, kind: "B", monday: localDate("2027-01-04") },
];

const SUBJECTS: Subject[] = [
  { id: "subject-moteur", classroomId: CLASSROOM_ID, name: "CP 3 Moteur", annualCourseId: MOTEUR_COURSE },
  { id: "subject-chassis", classroomId: CLASSROOM_ID, name: "CP 3 Châssis", annualCourseId: CHASSIS_COURSE },
];

function slot(weekNumber: number, dayIndex: number): CourseDaySlot {
  const week = WEEKS.find((entry) => entry.number === weekNumber)!;
  const date = new Date(week.monday.getFullYear(), week.monday.getMonth(), week.monday.getDate() + dayIndex, 12);
  return { schoolWeekNumber: week.number, weekKind: week.kind, date, dayIndex };
}

function item(
  partial: Partial<PrototypeAgendaItem> &
    Pick<PrototypeAgendaItem, "id" | "type" | "title" | "schoolWeekNumber" | "day">,
): PrototypeAgendaItem {
  return {
    classroomId: CLASSROOM_ID,
    subjectId: "subject-moteur",
    annualCourseId: MOTEUR_COURSE,
    authorTeacherId: "teacher-1",
    hour: 8,
    weekOffset: 0,
    detail: "",
    studentVisible: true,
    ...partial,
  };
}

const THURSDAY_5_NOV = slot(10, 3);

test("devoir publié pour la séance du 12 novembre visible dès le 5 novembre", () => {
  const homework = item({ id: 1, type: "HOMEWORK", title: "Exercices p. 12", schoolWeekNumber: 11, day: 3 });
  const today = item({ id: 2, type: "INFORMATION", title: "Cours du jour", schoolWeekNumber: 10, day: 3 });
  const sections = buildStudentCourseDaySections([today], SUBJECTS, [], {
    courseDay: THURSDAY_5_NOV,
    nextSession: { items: [homework, today], weeks: WEEKS },
  });

  assert.equal(sections.length, 1);
  assert.deepEqual(sections[0]!.publications.map((entry) => entry.id), [2]);
  assert.deepEqual(sections[0]!.nextSession?.publications.map((entry) => entry.id), [1]);
  assert.equal(sections[0]!.nextSession?.slot.schoolWeekNumber, 11);
  assert.equal(formatNextSessionLabel(sections[0]!.nextSession!.slot.date), "Pour le jeudi 12 novembre");
});

test("alternance A/B : la prochaine séance publiée est à 14 jours, pas à 7", () => {
  const nextA = item({ id: 3, type: "HOMEWORK", title: "Lire chapitre 4", schoolWeekNumber: 12, day: 3 });
  const later = item({ id: 4, type: "HOMEWORK", title: "Plus tard", schoolWeekNumber: 14, day: 3 });
  const map = nextSessionPublicationsByBranch([later, nextA], WEEKS, THURSDAY_5_NOV);
  const entry = map.get(MOTEUR_COURSE);
  assert.ok(entry);
  assert.equal(entry.slot.schoolWeekNumber, 12);
  assert.deepEqual(entry.publications.map((pub) => pub.id), [3]);
});

test("vacances : la séance suivante reste trouvée après une coupure de deux semaines", () => {
  const afterBreak = item({ id: 5, type: "HOMEWORK", title: "Après vacances", schoolWeekNumber: 14, day: 3 });
  const lastBeforeBreak = slot(13, 3);
  const map = nextSessionPublicationsByBranch([afterBreak], WEEKS, lastBeforeBreak);
  assert.equal(map.get(MOTEUR_COURSE)?.slot.schoolWeekNumber, 14);
});

test("au-delà de l’horizon, rien n’est anticipé", () => {
  const farAway = item({ id: 6, type: "HOMEWORK", title: "Janvier", schoolWeekNumber: 15, day: 3 });
  const map = nextSessionPublicationsByBranch([farAway], WEEKS, THURSDAY_5_NOV);
  assert.equal(STUDENT_NEXT_SESSION_HORIZON_DAYS, 35);
  assert.equal(map.size, 0);
});

test("brouillons, contrôles et séances passées ne sont pas anticipés", () => {
  const draft = item({ id: 7, type: "HOMEWORK", title: "Brouillon", schoolWeekNumber: 11, day: 3, studentVisible: false });
  const control = item({ id: 8, type: "TEST", title: "Contrôle", schoolWeekNumber: 11, day: 3 });
  const past = item({ id: 9, type: "HOMEWORK", title: "Passé", schoolWeekNumber: 10, day: 0 });
  const sameDay = item({ id: 10, type: "HOMEWORK", title: "Même jour", schoolWeekNumber: 10, day: 3 });
  const map = nextSessionPublicationsByBranch([draft, control, past, sameDay], WEEKS, THURSDAY_5_NOV);
  assert.equal(map.size, 0);
});

test("chaque branche garde sa propre prochaine séance", () => {
  const moteur = item({ id: 11, type: "HOMEWORK", title: "Moteur", schoolWeekNumber: 11, day: 3 });
  const chassis = item({
    id: 12,
    type: "INFORMATION",
    title: "Châssis",
    subjectId: "subject-chassis",
    annualCourseId: CHASSIS_COURSE,
    schoolWeekNumber: 12,
    day: 1,
  });
  const sections = buildStudentCourseDaySections([], SUBJECTS, [], {
    courseDay: THURSDAY_5_NOV,
    nextSession: { items: [moteur, chassis], weeks: WEEKS },
  });
  const byCourse = new Map(sections.map((section) => [section.subject.annualCourseId, section]));
  assert.equal(byCourse.get(MOTEUR_COURSE)?.nextSession?.slot.schoolWeekNumber, 11);
  assert.equal(byCourse.get(CHASSIS_COURSE)?.nextSession?.slot.schoolWeekNumber, 12);
  assert.equal(byCourse.get(CHASSIS_COURSE)?.subject.name, "CP 3 Châssis");
});

test("sans option nextSession (navigation dans un autre jour), aucune anticipation", () => {
  const today = item({ id: 13, type: "INFORMATION", title: "Cours du jour", schoolWeekNumber: 10, day: 3 });
  const sections = buildStudentCourseDaySections([today], SUBJECTS, [], { courseDay: THURSDAY_5_NOV });
  assert.equal(sections.length, 1);
  assert.equal(sections[0]!.nextSession ?? null, null);
});

test("onglet Devoirs : seule l’anticipation de type devoir reste", () => {
  const info = item({ id: 14, type: "INFORMATION", title: "Info", schoolWeekNumber: 11, day: 3 });
  const homework = item({ id: 15, type: "HOMEWORK", title: "Devoir", schoolWeekNumber: 11, day: 3 });
  const sections = buildStudentCourseDaySections([], SUBJECTS, [], {
    courseDay: THURSDAY_5_NOV,
    nextSession: { items: [info, homework], weeks: WEEKS },
  });
  assert.deepEqual(studentTodoSections(sections)[0]!.nextSession?.publications.map((pub) => pub.id), [15, 14]);
  assert.deepEqual(studentHomeworkOnlySections(sections)[0]!.nextSession?.publications.map((pub) => pub.id), [15]);

  const infoOnly = buildStudentCourseDaySections([], SUBJECTS, [], {
    courseDay: THURSDAY_5_NOV,
    nextSession: { items: [info], weeks: WEEKS },
  });
  assert.equal(studentHomeworkOnlySections(infoOnly).length, 0);
});

test("une rubrique « Pour le … » par date, chronologique, branches regroupées", () => {
  const chassis19 = item({
    id: 20,
    type: "HOMEWORK",
    title: "Châssis",
    subjectId: "subject-chassis",
    annualCourseId: CHASSIS_COURSE,
    schoolWeekNumber: 12,
    day: 3,
  });
  const moteur12 = item({ id: 21, type: "HOMEWORK", title: "Moteur", schoolWeekNumber: 11, day: 3 });
  const sections = buildStudentCourseDaySections([], SUBJECTS, [], {
    courseDay: slot(11, 0),
    nextSession: { items: [chassis19, moteur12], weeks: WEEKS },
  });
  const groups = groupNextSessionsByDate(sections);
  assert.deepEqual(groups.map((group) => group.dateKey), ["2026-11-12", "2026-11-19"]);
  assert.deepEqual(groups[1]!.branches.map((branch) => branch.subject.name), ["CP 3 Châssis"]);
  assert.equal(formatNextSessionLabel(groups[1]!.slot.date), "Pour le jeudi 19 novembre");

  const sameDate = buildStudentCourseDaySections([], SUBJECTS, [], {
    courseDay: slot(11, 0),
    nextSession: { items: [{ ...chassis19, schoolWeekNumber: 11 }, moteur12], weeks: WEEKS },
  });
  const merged = groupNextSessionsByDate(sameDate);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]!.branches.length, 2);
});

test("le jour de la séance, ses publications passent dans Cours du jour et quittent « Pour le … »", () => {
  const chassis19 = item({
    id: 22,
    type: "HOMEWORK",
    title: "Châssis",
    subjectId: "subject-chassis",
    annualCourseId: CHASSIS_COURSE,
    schoolWeekNumber: 12,
    day: 3,
  });
  const thursday19 = slot(12, 3);
  const sections = buildStudentCourseDaySections([chassis19], SUBJECTS, [], {
    courseDay: thursday19,
    nextSession: { items: [chassis19], weeks: WEEKS },
  });
  assert.deepEqual(sections[0]!.publications.map((pub) => pub.id), [22]);
  assert.equal(groupNextSessionsByDate(sections).length, 0);
});

test("rechargement automatique : pas plus d’une fois toutes les 30 secondes", () => {
  assert.equal(STUDENT_AGENDA_REFRESH_INTERVAL_MS, 5 * 60_000);
  assert.equal(studentAgendaRefreshDue(0, 29_999), false);
  assert.equal(studentAgendaRefreshDue(0, 30_000), true);
});

test("rendu : rubriques par date comme Cours du jour, sans « À venir » ni case à cocher, sans migration", async () => {
  const panel = await readFile(new URL("../web/app/components/student-homework-panel.tsx", import.meta.url), "utf8");
  assert.match(panel, /groupNextSessionsByDate/);
  assert.match(panel, /student-next-session-heading/);
  assert.match(panel, /formatNextSessionLabel/);
  assert.doesNotMatch(panel, />À venir</);
  assert.doesNotMatch(panel, /checkbox/);
  const css = await readFile(new URL("../web/app/globals.css", import.meta.url), "utf8");
  assert.match(css, /h3\.student-next-session-heading \{[^}]*color: var\(--blue\)/);
  const page = await readFile(new URL("../web/app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /nextSession: studentFollowingCourseDay/);
  assert.match(page, /studentAgendaRefreshDue/);
  assert.match(page, /STUDENT_AGENDA_REFRESH_INTERVAL_MS/);
  assert.equal(SQL_MIGRATION_FILES.some((file) => /next.?session/i.test(file)), false);
});
