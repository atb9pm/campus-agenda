import assert from "node:assert/strict";
import test from "node:test";

import {
  computeCourseSessions,
  formatCourseSessionHeading,
  formatCourseSessionPeriods,
  formatCourseSessionSummary,
} from "../src/features/course-sessions/index.ts";
import type { CourseSession } from "../src/features/course-sessions/types.ts";
import type { CourseScheduleSlot, CourseWeekKind, CourseWeekday } from "../src/features/course-schedule/types.ts";
import type { SchoolWeekEntry } from "../src/features/school-year/types.ts";
import { APP_VERSION } from "../src/lib/app-version.ts";
import { SQL_MIGRATION_FILES } from "../src/lib/persistence/sql/migrate.ts";

function mondayWeeks(startMonday: string, count: number): SchoolWeekEntry[] {
  const weeks: SchoolWeekEntry[] = [];
  const [year, month, day] = startMonday.split("-").map(Number);
  const cursor = new Date(year, month - 1, day, 12);
  for (let number = 1; number <= count; number += 1) {
    const iso = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
    weeks.push({
      number,
      kind: number % 2 === 1 ? "A" : "B",
      monday: iso,
    });
    cursor.setDate(cursor.getDate() + 7);
  }
  return weeks;
}

function slot(patch: {
  id?: string;
  dayOfWeek?: CourseWeekday;
  periodStart?: number;
  periodEnd?: number;
  weekKind?: CourseWeekKind;
  validFrom?: string | null;
  validTo?: string | null;
}): CourseScheduleSlot {
  return {
    id: patch.id ?? "slot-1",
    annualCourseId: "ac-moteur",
    dayOfWeek: patch.dayOfWeek ?? 1,
    periodStart: patch.periodStart ?? 2,
    periodEnd: patch.periodEnd ?? 3,
    weekKind: patch.weekKind ?? "all",
    validFrom: patch.validFrom ?? null,
    validTo: patch.validTo ?? null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

const course = { id: "ac-moteur", contextId: "ctx-moteur-y3" };

test("version 2.28.0 — CourseSession calculée, aucune migration 0024", () => {
  assert.equal(APP_VERSION, "2.28.0");
  assert.equal(SQL_MIGRATION_FILES.at(-1), "0023_class_attendance_days.sql");
  assert.equal(
    SQL_MIGRATION_FILES.some((file) => file.startsWith("0024")),
    false,
  );
});

test("CourseSession n’a pas de trainingYear — l’identité reste contextId", () => {
  const session: CourseSession = computeCourseSessions({
    annualCourse: course,
    slots: [slot({})],
    weeks: mondayWeeks("2026-08-10", 1),
  })[0]!;
  assert.equal("trainingYear" in session, false);
  assert.equal(session.contextId, "ctx-moteur-y3");
  assert.equal(session.annualCourseId, "ac-moteur");
});

test("Moteur lundi P2-P3 — 5e séance le 07.09.2026", () => {
  const sessions = computeCourseSessions({
    annualCourse: course,
    slots: [slot({ periodStart: 2, periodEnd: 3 })],
    weeks: mondayWeeks("2026-08-10", 5),
  });
  assert.equal(sessions.length, 5);
  const fifth = sessions[4]!;
  assert.equal(fifth.date, "2026-09-07");
  assert.equal(fifth.sessionNumber, 5);
  assert.equal(fifth.dayOfWeek, 1);
  assert.equal(fifth.periodStart, 2);
  assert.equal(fifth.periodEnd, 3);
  assert.equal(
    formatCourseSessionSummary("Moteur", fifth),
    "Moteur — lundi 07.09.2026\nSéance n° 5\nP2-P3",
  );
  assert.equal(formatCourseSessionHeading("Moteur", fifth), "Moteur — lundi 07.09.2026");
});

test("deux créneaux adjacents P2 et P3 fusionnent en une séance", () => {
  const sessions = computeCourseSessions({
    annualCourse: course,
    slots: [
      slot({ id: "s-p2", periodStart: 2, periodEnd: 2 }),
      slot({ id: "s-p3", periodStart: 3, periodEnd: 3 }),
    ],
    weeks: mondayWeeks("2026-08-10", 1),
  });
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.periodStart, 2);
  assert.equal(sessions[0]?.periodEnd, 3);
  assert.deepEqual(sessions[0]?.slotIds.sort(), ["s-p2", "s-p3"]);
  assert.equal(formatCourseSessionPeriods(2, 3), "P2-P3");
});

test("P4 et P6 ne fusionnent pas (pause de midi)", () => {
  const sessions = computeCourseSessions({
    annualCourse: course,
    slots: [
      slot({ id: "s-p4", periodStart: 4, periodEnd: 4 }),
      slot({ id: "s-p6", periodStart: 6, periodEnd: 6 }),
    ],
    weeks: mondayWeeks("2026-08-10", 1),
  });
  assert.equal(sessions.length, 2);
  assert.equal(sessions[0]?.periodStart, 4);
  assert.equal(sessions[1]?.periodStart, 6);
  assert.equal(sessions[0]?.sessionNumber, 1);
  assert.equal(sessions[1]?.sessionNumber, 2);
});

test("férié : lundi sauté, numérotation continue", () => {
  const sessions = computeCourseSessions({
    annualCourse: course,
    slots: [slot({})],
    weeks: mondayWeeks("2026-08-10", 3),
    holidays: [{ date: "2026-08-17", label: "Fête" }],
  });
  assert.deepEqual(sessions.map((entry) => entry.date), ["2026-08-10", "2026-08-24"]);
  assert.equal(sessions[1]?.sessionNumber, 2);
});

test("exception holiday → class : séance ajoutée", () => {
  const sessions = computeCourseSessions({
    annualCourse: course,
    slots: [slot({})],
    weeks: mondayWeeks("2026-08-10", 2),
    holidays: [{ date: "2026-08-17", label: "Fête" }],
    exceptions: [{ date: "2026-08-17", state: "class", label: "Cours rattrapé" }],
  });
  assert.deepEqual(sessions.map((entry) => entry.date), ["2026-08-10", "2026-08-17"]);
});

test("exception class → holiday : séance retirée", () => {
  const sessions = computeCourseSessions({
    annualCourse: course,
    slots: [slot({})],
    weeks: mondayWeeks("2026-08-10", 2),
    exceptions: [{ date: "2026-08-10", state: "holiday", label: "Pont" }],
  });
  assert.deepEqual(sessions.map((entry) => entry.date), ["2026-08-17"]);
  assert.equal(sessions[0]?.sessionNumber, 1);
});

test("créneau semaine B uniquement : pas de séance en semaine A", () => {
  const sessions = computeCourseSessions({
    annualCourse: course,
    slots: [slot({ weekKind: "B" })],
    weeks: mondayWeeks("2026-08-10", 2),
  });
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.date, "2026-08-17");
  assert.equal(sessions[0]?.weekKind, "B");
});

test("vacances : semaine absente du plan → aucune séance", () => {
  const weeks = mondayWeeks("2026-08-10", 3);
  const withoutWeek2 = [weeks[0]!, weeks[2]!];
  const sessions = computeCourseSessions({
    annualCourse: course,
    slots: [slot({})],
    weeks: withoutWeek2,
  });
  assert.deepEqual(sessions.map((entry) => entry.date), ["2026-08-10", "2026-08-24"]);
});
