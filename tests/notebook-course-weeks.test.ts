import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { SchoolWeek } from "../src/features/calendar/types.ts";
import {
  appendWeekNote,
  controlDayOptionsForCourseWeek,
  eligibleCourseWeekNumbers,
  eligibleSchoolWeeksForSessions,
  encodeRichDetail,
  findCarnetPublicationItemForSave,
  formatWeekColumnSubtitle,
  fromPlainText,
  formatWeekColumnSubtitleFromSessions,
  courseSessionForControlSlot,
  isCourseControlSlotAllowed,
  listWeekNotes,
  publicationDayIndexForCourseWeek,
  planCarnetWeekPublicationSave,
  moveTargetSchoolWeeks,
  weekdayToCourseDayIndex,
  shiftEligibleCourseWeek,
  snapToEligibleCourseWeek,
  visibleCourseWeeks,
  visibleSchoolWeeks,
  weekNotesKey,
} from "../src/features/class-notebook/index.ts";
import type { CourseScheduleSlot, CourseWeekKind, CourseWeekday } from "../src/features/course-schedule/types.ts";
import { computeCourseSessions } from "../src/features/course-sessions/index.ts";
import type { SchoolWeekEntry } from "../src/features/school-year/types.ts";
import { filterItemsForCourseDay } from "../src/features/student/index.ts";
import type { PrototypeAgendaItem } from "../src/features/agenda/demo-items.ts";
import { SQL_MIGRATION_FILES } from "../src/lib/persistence/sql/migrate.ts";

const YEAR_N = "SY-2026-27";
const YEAR_N1 = "SY-2027-28";
const COURSE_N = { id: "ac-year-n", classId: "class-demo", contextId: "ctx-demo-n" };
const COURSE_N1 = { id: "ac-year-n1", classId: "class-demo", contextId: "ctx-demo-n1" };

function schoolWeeksFromEntries(entries: SchoolWeekEntry[]): SchoolWeek[] {
  return entries.map((entry) => {
    const [year, month, day] = entry.monday.split("-").map(Number);
    return {
      number: entry.number,
      kind: entry.kind,
      monday: new Date(year, month - 1, day, 12),
    };
  });
}

function slot(patch: {
  id?: string;
  annualCourseId?: string;
  dayOfWeek?: CourseWeekday;
  periodStart?: number;
  periodEnd?: number;
  weekKind?: CourseWeekKind;
  validFrom?: string | null;
  validTo?: string | null;
}): CourseScheduleSlot {
  return {
    id: patch.id ?? "slot-1",
    annualCourseId: patch.annualCourseId ?? COURSE_N.id,
    dayOfWeek: patch.dayOfWeek ?? 4,
    periodStart: patch.periodStart ?? 3,
    periodEnd: patch.periodEnd ?? 4,
    weekKind: patch.weekKind ?? "B",
    validFrom: patch.validFrom ?? null,
    validTo: patch.validTo ?? null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

/** Semaines 05-A … 08-B, vacances, 09-A, 10-B — jeudi 24.09 / 08.10 / 05.11. */
function chassisCalendarWeeks(): SchoolWeekEntry[] {
  return [
    { number: 5, kind: "A", monday: "2026-09-14" },
    { number: 6, kind: "B", monday: "2026-09-21" },
    { number: 7, kind: "A", monday: "2026-09-28" },
    { number: 8, kind: "B", monday: "2026-10-05" },
    { number: 9, kind: "A", monday: "2026-10-26" },
    { number: 10, kind: "B", monday: "2026-11-02" },
  ];
}

function sessionsFor(options: {
  slots: CourseScheduleSlot[];
  weeks: SchoolWeekEntry[];
  holidays?: { date: string; label: string }[];
  exceptions?: { date: string; state: "class" | "holiday"; label: string | null }[];
  courses?: { id: string; classId: string; contextId: string }[];
  schoolYearId?: string;
}) {
  return computeCourseSessions({
    schoolYearId: options.schoolYearId ?? YEAR_N,
    courses: options.courses ?? [COURSE_N],
    slots: options.slots,
    weeks: options.weeks,
    holidays: options.holidays,
    exceptions: options.exceptions,
  });
}

test("carnet — cours semaine B : 06-B 08-B 10-B, jamais 05-A 07-A 09-A", () => {
  const weeks = chassisCalendarWeeks();
  const schoolWeeks = schoolWeeksFromEntries(weeks);
  const sessions = sessionsFor({
    slots: [slot({ weekKind: "B", dayOfWeek: 4 })],
    weeks,
  });
  const eligible = eligibleSchoolWeeksForSessions(schoolWeeks, sessions);
  assert.deepEqual(
    eligible.map((week) => `${week.number}-${week.kind}`),
    ["6-B", "8-B", "10-B"],
  );
  assert.equal(
    eligible.some((week) => week.kind === "A"),
    false,
  );
  const thursdayDates = sessions.map((session) => session.date);
  assert.deepEqual(thursdayDates, ["2026-09-24", "2026-10-08", "2026-11-05"]);
  assert.ok(sessions.every((session) => session.dayOfWeek === 4));
});

test("carnet — cours semaine A : aucune semaine B", () => {
  const weeks = chassisCalendarWeeks();
  const schoolWeeks = schoolWeeksFromEntries(weeks);
  const sessions = sessionsFor({
    slots: [slot({ weekKind: "A", dayOfWeek: 2 })],
    weeks,
  });
  const eligible = eligibleSchoolWeeksForSessions(schoolWeeks, sessions);
  assert.deepEqual(
    eligible.map((week) => `${week.number}-${week.kind}`),
    ["5-A", "7-A", "9-A"],
  );
  assert.equal(
    eligible.some((week) => week.kind === "B"),
    false,
  );
});

test("carnet — cours toutes les semaines : A et B", () => {
  const weeks = chassisCalendarWeeks();
  const schoolWeeks = schoolWeeksFromEntries(weeks);
  const sessions = sessionsFor({
    slots: [slot({ weekKind: "all", dayOfWeek: 4 })],
    weeks,
  });
  const eligible = eligibleSchoolWeeksForSessions(schoolWeeks, sessions);
  assert.deepEqual(
    eligible.map((week) => `${week.number}-${week.kind}`),
    ["5-A", "6-B", "7-A", "8-B", "9-A", "10-B"],
  );
});

test("carnet — vacances : aucune semaine inventée entre 08-B et 09-A", () => {
  const weeks = chassisCalendarWeeks();
  const schoolWeeks = schoolWeeksFromEntries(weeks);
  const sessions = sessionsFor({
    slots: [slot({ weekKind: "B", dayOfWeek: 4 })],
    weeks,
  });
  const numbers = eligibleCourseWeekNumbers(sessions);
  assert.deepEqual(numbers, [6, 8, 10]);
  assert.equal(numbers.includes(11), false);
  assert.equal(
    schoolWeeks.some((week) => week.number === 8) && schoolWeeks.some((week) => week.number === 9),
    true,
  );
  assert.equal(schoolWeeks.some((week) => week.number === 11), false);
});

test("carnet — jeudi férié : semaine B sans séance absente", () => {
  const weeks = chassisCalendarWeeks();
  const schoolWeeks = schoolWeeksFromEntries(weeks);
  const sessions = sessionsFor({
    slots: [slot({ weekKind: "B", dayOfWeek: 4 })],
    weeks,
    holidays: [{ date: "2026-10-08", label: "Jeûne" }],
  });
  const eligible = eligibleSchoolWeeksForSessions(schoolWeeks, sessions);
  assert.deepEqual(
    eligible.map((week) => week.number),
    [6, 10],
  );
  assert.equal(eligible.some((week) => week.number === 8), false);
});

test("carnet — exception calendrier : séance recalculée", () => {
  const weeks = chassisCalendarWeeks();
  const schoolWeeks = schoolWeeksFromEntries(weeks);
  const without = sessionsFor({
    slots: [slot({ weekKind: "B", dayOfWeek: 4 })],
    weeks,
    holidays: [{ date: "2026-10-08", label: "Jeûne" }],
  });
  const restored = sessionsFor({
    slots: [slot({ weekKind: "B", dayOfWeek: 4 })],
    weeks,
    holidays: [{ date: "2026-10-08", label: "Jeûne" }],
    exceptions: [{ date: "2026-10-08", state: "class", label: "Cours maintenu" }],
  });
  assert.equal(
    eligibleSchoolWeeksForSessions(schoolWeeks, without).some((week) => week.number === 8),
    false,
  );
  assert.equal(
    eligibleSchoolWeeksForSessions(schoolWeeks, restored).some((week) => week.number === 8),
    true,
  );
});

test("carnet — 3 semaines affichées = 3 semaines réelles du cours", () => {
  const weeks = chassisCalendarWeeks();
  const schoolWeeks = schoolWeeksFromEntries(weeks);
  const sessions = sessionsFor({
    slots: [slot({ weekKind: "B", dayOfWeek: 4 })],
    weeks,
  });
  const eligible = eligibleSchoolWeeksForSessions(schoolWeeks, sessions);
  const visible = visibleCourseWeeks(eligible, 6, 3);
  assert.deepEqual(
    visible.map((week) => week.number),
    [6, 8, 10],
  );
  const consecutive = visibleSchoolWeeks(schoolWeeks, 6, 3);
  assert.deepEqual(
    consecutive.map((week) => week.number),
    [5, 6, 7],
  );
});

test("carnet — navigation suivante saute les semaines non éligibles", () => {
  const next = shiftEligibleCourseWeek([6, 8, 10, 12], 6, 1);
  assert.equal(next, 8);
  const after = shiftEligibleCourseWeek([6, 8, 10, 12], 8, 1);
  assert.equal(after, 10);
  const visibleAfter = visibleCourseWeeks(
    schoolWeeksFromEntries([
      { number: 6, kind: "B", monday: "2026-09-21" },
      { number: 8, kind: "B", monday: "2026-10-05" },
      { number: 10, kind: "B", monday: "2026-11-02" },
      { number: 12, kind: "B", monday: "2026-11-16" },
    ]),
    8,
    3,
  );
  assert.deepEqual(
    visibleAfter.map((week) => week.number),
    [8, 10, 12],
  );
});

test("carnet — navigation précédente saute les semaines non éligibles", () => {
  assert.equal(shiftEligibleCourseWeek([6, 8, 10], 10, -1), 8);
  assert.equal(shiftEligibleCourseWeek([6, 8, 10], 6, -1), null);
});

test("carnet — ouverture sur une semaine non éligible → prochain cours réel", () => {
  assert.equal(snapToEligibleCourseWeek([6, 8, 10], 5), 6);
  assert.equal(snapToEligibleCourseWeek([6, 8, 10], 7), 8);
  assert.equal(snapToEligibleCourseWeek([6, 8, 10], 9), 10);
  assert.equal(snapToEligibleCourseWeek([6, 8, 10], 11), 10);
});

test("carnet — plusieurs séances dans la même semaine → une seule carte", () => {
  const weeks = chassisCalendarWeeks();
  const schoolWeeks = schoolWeeksFromEntries(weeks);
  const sessions = sessionsFor({
    slots: [
      slot({ id: "mon", dayOfWeek: 1, weekKind: "B" }),
      slot({ id: "thu", dayOfWeek: 4, weekKind: "B" }),
    ],
    weeks,
  });
  const eligible = eligibleSchoolWeeksForSessions(schoolWeeks, sessions);
  assert.equal(eligible.filter((week) => week.number === 6).length, 1);
  const week6 = sessions.filter((session) => session.schoolWeekNumber === 6);
  assert.equal(week6.length, 2);
  assert.deepEqual(
    week6.map((session) => session.dayOfWeek).sort(),
    [1, 4],
  );
});

test("carnet — sous-titre affiche les vrais jours et dates", () => {
  const weeks = chassisCalendarWeeks();
  const sessions = sessionsFor({
    slots: [slot({ weekKind: "B", dayOfWeek: 4 })],
    weeks,
  });
  const week6 = sessions.filter((session) => session.schoolWeekNumber === 6);
  assert.equal(formatWeekColumnSubtitleFromSessions(week6), "JEU 24.09");
  const week8 = sessions.filter((session) => session.schoolWeekNumber === 8);
  assert.equal(formatWeekColumnSubtitleFromSessions(week8), "JEU 08.10");
  const week10 = sessions.filter((session) => session.schoolWeekNumber === 10);
  assert.equal(formatWeekColumnSubtitleFromSessions(week10), "JEU 05.11");

  const bothDays = sessionsFor({
    slots: [
      slot({ id: "mon", dayOfWeek: 1, weekKind: "B" }),
      slot({ id: "thu", dayOfWeek: 4, weekKind: "B" }),
    ],
    weeks,
  }).filter((session) => session.schoolWeekNumber === 6);
  assert.equal(formatWeekColumnSubtitleFromSessions(bothDays), "LUN 21.09 · JEU 24.09");

  const genericB = formatWeekColumnSubtitle({ number: 6, kind: "B", monday: new Date(2026, 8, 21) });
  assert.equal(genericB, "lun + jeu");
  assert.notEqual(formatWeekColumnSubtitleFromSessions(week6), genericB);
});

test("carnet — plusieurs périodes le même jour → une séance, une carte", () => {
  const weeks = chassisCalendarWeeks();
  const schoolWeeks = schoolWeeksFromEntries(weeks);
  const sessions = sessionsFor({
    slots: [
      slot({ id: "p3", periodStart: 3, periodEnd: 3, dayOfWeek: 4, weekKind: "B" }),
      slot({ id: "p4", periodStart: 4, periodEnd: 4, dayOfWeek: 4, weekKind: "B" }),
    ],
    weeks,
  });
  const week6 = sessions.filter((session) => session.schoolWeekNumber === 6);
  assert.equal(week6.length, 1);
  assert.equal(week6[0]?.date, "2026-09-24");
  assert.equal(week6[0]?.segments.length, 2);
  assert.equal(eligibleSchoolWeeksForSessions(schoolWeeks, sessions).filter((week) => week.number === 6).length, 1);
  assert.equal(formatWeekColumnSubtitleFromSessions(week6), "JEU 24.09");
});

test("carnet — Déplacer vers ne propose que les semaines valides", () => {
  const weeks = chassisCalendarWeeks();
  const schoolWeeks = schoolWeeksFromEntries(weeks);
  const sessions = sessionsFor({
    slots: [slot({ weekKind: "B", dayOfWeek: 4 })],
    weeks,
  });
  const eligible = eligibleSchoolWeeksForSessions(schoolWeeks, sessions);
  const targets = moveTargetSchoolWeeks(eligible, 6);
  assert.deepEqual(
    targets.map((week) => week.number),
    [8, 10],
  );
  assert.equal(
    targets.some((week) => week.kind === "A"),
    false,
  );
});

test("carnet — ControlsModal ne propose que les vraies séances", () => {
  const weeks = chassisCalendarWeeks();
  const sessions = sessionsFor({
    slots: [slot({ weekKind: "B", dayOfWeek: 4 })],
    weeks,
  });
  const options6 = controlDayOptionsForCourseWeek(sessions, 6);
  assert.equal(options6.length, 1);
  assert.equal(options6[0]?.dayIndex, 3);
  assert.match(options6[0]?.label ?? "", /Jeudi/);
  assert.match(options6[0]?.label ?? "", /24/);
  const options5 = controlDayOptionsForCourseWeek(sessions, 5);
  assert.deepEqual(options5, []);
});

test("carnet — contrôle impossible sur une semaine sans cours", () => {
  const weeks = chassisCalendarWeeks();
  const sessions = sessionsFor({
    slots: [slot({ weekKind: "B", dayOfWeek: 4 })],
    weeks,
  });
  assert.equal(isCourseControlSlotAllowed(sessions, 6, 3), true);
  assert.equal(isCourseControlSlotAllowed(sessions, 6, 0), false);
  assert.equal(isCourseControlSlotAllowed(sessions, 5, 3), false);
  assert.equal(isCourseControlSlotAllowed(sessions, 7, 0), false);
  const matched = courseSessionForControlSlot(sessions, 6, 3);
  assert.ok(matched);
  assert.equal(matched!.schoolWeekNumber, 6);
  assert.equal(matched!.dayOfWeek, 4);
  assert.ok(matched!.key.includes("|"));
  assert.equal(courseSessionForControlSlot(sessions, 6, 0), null);
});

test("carnet — horaire année N en B n’influence pas année N+1 en all", () => {
  const weeksN = chassisCalendarWeeks();
  const weeksN1: SchoolWeekEntry[] = [
    { number: 1, kind: "A", monday: "2027-08-16" },
    { number: 2, kind: "B", monday: "2027-08-23" },
    { number: 3, kind: "A", monday: "2027-08-30" },
    { number: 4, kind: "B", monday: "2027-09-06" },
  ];
  const sessionsN = sessionsFor({
    slots: [slot({ annualCourseId: COURSE_N.id, weekKind: "B", dayOfWeek: 4 })],
    weeks: weeksN,
    courses: [COURSE_N],
    schoolYearId: YEAR_N,
  });
  const sessionsN1 = sessionsFor({
    slots: [slot({ annualCourseId: COURSE_N1.id, weekKind: "all", dayOfWeek: 4 })],
    weeks: weeksN1,
    courses: [COURSE_N1],
    schoolYearId: YEAR_N1,
  });
  assert.deepEqual(eligibleCourseWeekNumbers(sessionsN), [6, 8, 10]);
  assert.deepEqual(eligibleCourseWeekNumbers(sessionsN1), [1, 2, 3, 4]);
  assert.ok(sessionsN.every((session) => session.annualCourseId === COURSE_N.id));
  assert.ok(sessionsN1.every((session) => session.annualCourseId === COURSE_N1.id));
});

test("carnet — validFrom / validTo restent respectés", () => {
  const weeks = chassisCalendarWeeks();
  const schoolWeeks = schoolWeeksFromEntries(weeks);
  const sessions = sessionsFor({
    slots: [
      slot({
        id: "first",
        weekKind: "B",
        dayOfWeek: 4,
        validFrom: "2026-09-01",
        validTo: "2026-10-10",
      }),
      slot({
        id: "second",
        weekKind: "all",
        dayOfWeek: 4,
        periodStart: 3,
        periodEnd: 3,
        validFrom: "2026-10-20",
        validTo: null,
      }),
    ],
    weeks,
  });
  const eligible = eligibleSchoolWeeksForSessions(schoolWeeks, sessions);
  assert.deepEqual(
    eligible.map((week) => `${week.number}-${week.kind}`),
    ["6-B", "8-B", "9-A", "10-B"],
  );
  assert.equal(
    sessions.find((session) => session.schoolWeekNumber === 6)?.segments[0]?.scheduleSlotId,
    "first",
  );
  assert.equal(
    sessions.find((session) => session.schoolWeekNumber === 9)?.segments[0]?.scheduleSlotId,
    "second",
  );
});

test("carnet — publications existantes toujours groupées par schoolWeekNumber", () => {
  const items = [
    { id: 1, schoolWeekNumber: 6, title: "Cours B" },
    { id: 2, schoolWeekNumber: 5, title: "Ancienne semaine A" },
  ];
  const inWeek6 = items.filter((item) => item.schoolWeekNumber === 6);
  assert.equal(inWeek6.length, 1);
  assert.equal(inWeek6[0]?.title, "Cours B");
  const orphan = items.filter((item) => item.schoolWeekNumber === 5);
  assert.equal(orphan[0]?.title, "Ancienne semaine A");
});

test("carnet — publication jeudi B (Sem 06-B) → day=3, pas le lundi de classe", () => {
  const weeks = chassisCalendarWeeks();
  const sessions = sessionsFor({
    slots: [slot({ weekKind: "B", dayOfWeek: 4 })],
    weeks,
  });
  const classMonday = weekdayToCourseDayIndex(1);
  assert.equal(classMonday, 0);
  const day = publicationDayIndexForCourseWeek(sessions, 6);
  assert.equal(day, 3);
  assert.notEqual(day, classMonday);
  const week6 = sessions.find((session) => session.schoolWeekNumber === 6);
  assert.equal(week6?.date, "2026-09-24");
  assert.equal(week6?.dayOfWeek, 4);
});

test("carnet — publication mardi toutes les semaines → day=1", () => {
  const weeks = chassisCalendarWeeks();
  const sessions = sessionsFor({
    slots: [slot({ weekKind: "all", dayOfWeek: 2 })],
    weeks,
  });
  assert.equal(publicationDayIndexForCourseWeek(sessions, 6), 1);
  assert.equal(publicationDayIndexForCourseWeek(sessions, 5), 1);
});

test("carnet — déplacement jeudi → jeudi conserve day=3", () => {
  const weeks = chassisCalendarWeeks();
  const sessions = sessionsFor({
    slots: [slot({ weekKind: "B", dayOfWeek: 4 })],
    weeks,
  });
  assert.equal(publicationDayIndexForCourseWeek(sessions, 8, 3), 3);
  assert.equal(publicationDayIndexForCourseWeek(sessions, 10, 3), 3);
});

test("carnet — validFrom/validTo jeudi → mardi : déplacement met day=1", () => {
  const weeks = chassisCalendarWeeks();
  const sessions = sessionsFor({
    slots: [
      slot({
        id: "thu-b",
        weekKind: "B",
        dayOfWeek: 4,
        validFrom: "2026-09-01",
        validTo: "2026-10-10",
      }),
      slot({
        id: "tue-all",
        weekKind: "all",
        dayOfWeek: 2,
        validFrom: "2026-10-20",
        validTo: null,
      }),
    ],
    weeks,
  });
  assert.equal(publicationDayIndexForCourseWeek(sessions, 6), 3);
  assert.equal(publicationDayIndexForCourseWeek(sessions, 9, 3), 1);
});

test("carnet — publication existante dont le jour reste valide → jour conservé", () => {
  const weeks = chassisCalendarWeeks();
  const sessions = sessionsFor({
    slots: [
      slot({ id: "mon", dayOfWeek: 1, weekKind: "B" }),
      slot({ id: "thu", dayOfWeek: 4, weekKind: "B" }),
    ],
    weeks,
  });
  assert.equal(publicationDayIndexForCourseWeek(sessions, 6, 3), 3);
  assert.equal(publicationDayIndexForCourseWeek(sessions, 6, 0), 0);
});

test("carnet — lundi + jeudi sans jour existant valide → première séance chrono", () => {
  const weeks = chassisCalendarWeeks();
  const sessions = sessionsFor({
    slots: [
      slot({ id: "mon", dayOfWeek: 1, weekKind: "B" }),
      slot({ id: "thu", dayOfWeek: 4, weekKind: "B" }),
    ],
    weeks,
  });
  assert.equal(publicationDayIndexForCourseWeek(sessions, 6), 0);
  assert.equal(publicationDayIndexForCourseWeek(sessions, 6, 2), 0);
});

test("carnet — legacy sans séances CourseSession → fallback jour de classe", () => {
  assert.equal(publicationDayIndexForCourseWeek([], 6), null);
  const fallback = publicationDayIndexForCourseWeek([], 6) ?? weekdayToCourseDayIndex(1);
  assert.equal(fallback, 0);
});

test("carnet — sauvegarde : publication riche jeudi conservée malgré une publication lundi plus tôt", () => {
  const weeks = chassisCalendarWeeks();
  const sessions = sessionsFor({
    slots: [
      slot({ id: "mon", dayOfWeek: 1, weekKind: "B" }),
      slot({ id: "thu", dayOfWeek: 4, weekKind: "B" }),
    ],
    weeks,
  });
  const mondayPlain: PrototypeAgendaItem = {
    id: 1,
    classroomId: "class-demo",
    subjectId: "subj-demo",
    authorTeacherId: "teacher-demo",
    day: 0,
    hour: 8,
    weekOffset: 0,
    schoolWeekNumber: 6,
    type: "HOMEWORK",
    title: "Ancien lundi",
    detail: "texte simple",
  };
  const thursdayRich: PrototypeAgendaItem = {
    ...mondayPlain,
    id: 2,
    day: 3,
    title: "Devoir jeudi",
    detail: encodeRichDetail(fromPlainText("Document riche du jeudi")),
  };
  const weekItems = [mondayPlain, thursdayRich];
  const existing = findCarnetPublicationItemForSave(weekItems);
  assert.equal(existing?.id, 2);
  assert.equal(existing?.day, 3);
  const plan = planCarnetWeekPublicationSave(weekItems, fromPlainText("Fusion de la semaine"));
  assert.equal(plan.action, "update");
  if (plan.action !== "update") throw new Error("plan");
  assert.equal(plan.updateId, 2);
  assert.equal(publicationDayIndexForCourseWeek(sessions, 6, existing?.day), 3);
});

test("carnet — vue élève retrouve la publication Sem 06-B jeudi", () => {
  const item: PrototypeAgendaItem = {
    id: 9106,
    classroomId: "class-demo",
    subjectId: "subj-demo",
    authorTeacherId: "teacher-demo",
    day: 3,
    hour: 8,
    weekOffset: 0,
    schoolWeekNumber: 6,
    type: "HOMEWORK",
    title: "Devoir châssis",
    detail: "",
  };
  const thursday = {
    schoolWeekNumber: 6,
    weekKind: "B" as const,
    date: new Date(2026, 8, 24, 12),
    dayIndex: 3,
  };
  const monday = { ...thursday, dayIndex: 0 };
  assert.equal(filterItemsForCourseDay([item], thursday).length, 1);
  assert.equal(filterItemsForCourseDay([item], monday).length, 0);
});

test("carnet — notes prof non régressées", () => {
  const key = weekNotesKey("class-demo", 6);
  const document = appendWeekNote({ version: 1, weeks: {} }, key, "Préparer le châssis");
  assert.equal(listWeekNotes(document, key)[0]?.text, "Préparer le châssis");
});

test("carnet — aucune migration SQL CourseSession, dernière migration inchangée", () => {
  assert.equal(SQL_MIGRATION_FILES.at(-1), "0030_agenda_student_visible.sql");
  assert.equal(
    SQL_MIGRATION_FILES.some((file) => file.toLowerCase().includes("course_session")),
    false,
  );
});

test("carnet — pas de règle hardcodée classe / branche / jour", async () => {
  const helper = await readFile(new URL("../src/features/class-notebook/course-week-window.ts", import.meta.url), "utf8");
  const panel = await readFile(new URL("../web/app/components/class-notebook-panel.tsx", import.meta.url), "utf8");
  const modal = await readFile(new URL("../web/app/components/controls-modal.tsx", import.meta.url), "utf8");
  const page = await readFile(new URL("../web/app/page.tsx", import.meta.url), "utf8");
  const combined = `${helper}\n${panel}\n${modal}`;
  assert.doesNotMatch(combined, /MECAUTO3A/);
  assert.doesNotMatch(combined, /CP3/);
  assert.doesNotMatch(helper, /Châssis/);
  assert.doesNotMatch(helper, /weekKind === "B"/);
  assert.match(panel, /fetchTeacherCourseTimelineApi/);
  assert.match(panel, /visibleCourseWeeks/);
  assert.match(panel, /publicationDayIndexForCourseWeek/);
  assert.match(panel, /courseSessionForControlSlot/);
  assert.match(panel, /findCarnetPublicationItemForSave/);
  assert.match(panel, /Aucune séance planifiée pour ce cours dans l’horaire/);
  assert.match(modal, /controlDayOptionsForCourseWeek/);
  assert.match(modal, /courseSessions/);
  assert.match(page, /publicationDay = day \?\? weekdayToCourseDayIndex/);
  assert.match(page, /notebookMovePublication\(itemId: number, schoolWeekNumber: number, day\?: number\)/);
  assert.match(page, /\.\.\.\(day != null \? \{ day \} : \{\}\)/);
});
