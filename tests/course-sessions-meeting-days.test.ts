import assert from "node:assert/strict";
import test from "node:test";

import type { CourseScheduleSlot, CourseWeekKind, CourseWeekday } from "../src/features/course-schedule/types.ts";
import {
  computeCourseSessions,
  courseSessionKey,
  type ComputeCourseSessionsMeetingDay,
} from "../src/features/course-sessions/index.ts";
import type { SchoolWeekEntry } from "../src/features/school-year/types.ts";

const SCHOOL_YEAR_ID = "SY-2026-27";
const course = { id: "AC-123", classId: "class-ma", contextId: "ctx-moteur-y3" };

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
    annualCourseId: patch.annualCourseId ?? course.id,
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

function meetingDay(patch: {
  annualCourseId?: string;
  dayOfWeek: CourseWeekday;
  weekKind: CourseWeekKind;
}): ComputeCourseSessionsMeetingDay {
  return {
    annualCourseId: patch.annualCourseId ?? course.id,
    dayOfWeek: patch.dayOfWeek,
    weekKind: patch.weekKind,
  };
}

function compute(input: {
  slots: CourseScheduleSlot[];
  weeks: SchoolWeekEntry[];
  meetingDays?: ComputeCourseSessionsMeetingDay[];
  holidays?: { date: string; label: string }[];
  exceptions?: { date: string; state: "class" | "holiday"; label: string | null }[];
  courses?: typeof course[];
}) {
  return computeCourseSessions({
    schoolYearId: SCHOOL_YEAR_ID,
    courses: input.courses ?? [course],
    slots: input.slots,
    weeks: input.weeks,
    holidays: input.holidays,
    exceptions: input.exceptions,
    meetingDays: input.meetingDays,
  });
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = (index * 5 + 2) % (index + 1);
    const current = copy[index]!;
    copy[index] = copy[swap]!;
    copy[swap] = current;
  }
  return copy;
}

test("1 — cours legacy sans meeting days + slots → identique à aujourd’hui", () => {
  const weeks = mondayWeeks("2026-08-10", 2);
  const slots = [
    slot({ id: "s-mon", dayOfWeek: 1, weekKind: "all", periodStart: 2, periodEnd: 3 }),
    slot({ id: "s-thu", dayOfWeek: 4, weekKind: "B", periodStart: 1, periodEnd: 2 }),
  ];
  const current = compute({ slots, weeks });
  const omitted = computeCourseSessions({
    schoolYearId: SCHOOL_YEAR_ID,
    courses: [course],
    slots,
    weeks,
  });
  const emptyPlan = compute({ slots, weeks, meetingDays: [] });
  const otherCoursePlan = compute({
    slots,
    weeks,
    meetingDays: [meetingDay({ annualCourseId: "AC-OTHER", dayOfWeek: 3, weekKind: "all" })],
  });
  assert.deepEqual(omitted, current);
  assert.deepEqual(emptyPlan, current);
  assert.deepEqual(otherCoursePlan, current);
  assert.equal(current.length, 3);
  assert.deepEqual(
    current.map((entry) => entry.key),
    [
      courseSessionKey(SCHOOL_YEAR_ID, course.id, "2026-08-10"),
      courseSessionKey(SCHOOL_YEAR_ID, course.id, "2026-08-17"),
      courseSessionKey(SCHOOL_YEAR_ID, course.id, "2026-08-20"),
    ],
  );
});

test("2 — PRIMARY lundi/all sans slot → tous les lundis scolaires, segments vides", () => {
  const sessions = compute({
    slots: [],
    weeks: mondayWeeks("2026-08-10", 4),
    meetingDays: [meetingDay({ dayOfWeek: 1, weekKind: "all" })],
  });
  assert.equal(sessions.length, 4);
  assert.deepEqual(
    sessions.map((entry) => ({ date: entry.date, dayOfWeek: entry.dayOfWeek, weekKind: entry.weekKind, segments: entry.segments })),
    [
      { date: "2026-08-10", dayOfWeek: 1, weekKind: "A", segments: [] },
      { date: "2026-08-17", dayOfWeek: 1, weekKind: "B", segments: [] },
      { date: "2026-08-24", dayOfWeek: 1, weekKind: "A", segments: [] },
      { date: "2026-08-31", dayOfWeek: 1, weekKind: "B", segments: [] },
    ],
  );
  assert.deepEqual(sessions.map((entry) => entry.sequenceNumber), [1, 2, 3, 4]);
});

test("3 — PRIMARY jeudi/B sans slot → uniquement les jeudis B", () => {
  const sessions = compute({
    slots: [],
    weeks: mondayWeeks("2026-08-10", 4),
    meetingDays: [meetingDay({ dayOfWeek: 4, weekKind: "B" })],
  });
  assert.deepEqual(
    sessions.map((entry) => ({ date: entry.date, weekKind: entry.weekKind, dayOfWeek: entry.dayOfWeek })),
    [
      { date: "2026-08-20", weekKind: "B", dayOfWeek: 4 },
      { date: "2026-09-03", weekKind: "B", dayOfWeek: 4 },
    ],
  );
  assert.ok(sessions.every((entry) => entry.segments.length === 0));
  assert.ok(sessions.every((entry) => entry.weekKind === "B"));
});

test("4 — PRIMARY mardi/A sans slot → uniquement les mardis A", () => {
  const sessions = compute({
    slots: [],
    weeks: mondayWeeks("2026-08-10", 4),
    meetingDays: [meetingDay({ dayOfWeek: 2, weekKind: "A" })],
  });
  assert.deepEqual(
    sessions.map((entry) => ({ date: entry.date, weekKind: entry.weekKind, dayOfWeek: entry.dayOfWeek })),
    [
      { date: "2026-08-11", weekKind: "A", dayOfWeek: 2 },
      { date: "2026-08-25", weekKind: "A", dayOfWeek: 2 },
    ],
  );
});

test("5 — deux meeting days : lundi/all + jeudi/B", () => {
  const sessions = compute({
    slots: [],
    weeks: mondayWeeks("2026-08-10", 2),
    meetingDays: [
      meetingDay({ dayOfWeek: 1, weekKind: "all" }),
      meetingDay({ dayOfWeek: 4, weekKind: "B" }),
    ],
  });
  assert.deepEqual(
    sessions.map((entry) => ({ date: entry.date, weekKind: entry.weekKind, day: entry.dayOfWeek, seq: entry.sequenceNumber })),
    [
      { date: "2026-08-10", weekKind: "A", day: 1, seq: 1 },
      { date: "2026-08-17", weekKind: "B", day: 1, seq: 2 },
      { date: "2026-08-20", weekKind: "B", day: 4, seq: 3 },
    ],
  );
});

test("6 — vacances = semaine absente du plan", () => {
  const weeks = mondayWeeks("2026-08-10", 3);
  const sessions = compute({
    slots: [],
    weeks: [weeks[0]!, weeks[2]!],
    meetingDays: [meetingDay({ dayOfWeek: 1, weekKind: "all" })],
  });
  assert.deepEqual(sessions.map((entry) => entry.date), ["2026-08-10", "2026-08-24"]);
  assert.equal(
    sessions.some((entry) => entry.date === "2026-08-17"),
    false,
  );
});

test("7 — jour férié → séance meeting day supprimée", () => {
  const sessions = compute({
    slots: [],
    weeks: mondayWeeks("2026-08-10", 4),
    meetingDays: [meetingDay({ dayOfWeek: 4, weekKind: "B" })],
    holidays: [{ date: "2026-08-20", label: "Fête" }],
  });
  assert.deepEqual(sessions.map((entry) => entry.date), ["2026-09-03"]);
  assert.equal(sessions[0]?.sequenceNumber, 1);
});

test("8 — exception scolaire holiday / class", () => {
  const removed = compute({
    slots: [],
    weeks: mondayWeeks("2026-08-10", 2),
    meetingDays: [meetingDay({ dayOfWeek: 1, weekKind: "all" })],
    exceptions: [{ date: "2026-08-10", state: "holiday", label: "Pont" }],
  });
  assert.deepEqual(removed.map((entry) => entry.date), ["2026-08-17"]);

  const restored = compute({
    slots: [],
    weeks: mondayWeeks("2026-08-10", 4),
    meetingDays: [meetingDay({ dayOfWeek: 4, weekKind: "B" })],
    holidays: [{ date: "2026-08-20", label: "Fête" }],
    exceptions: [{ date: "2026-08-20", state: "class", label: "Cours rattrapé" }],
  });
  assert.deepEqual(restored.map((entry) => entry.date), ["2026-08-20", "2026-09-03"]);
});

test("9 — ajout ultérieur d’un slot : mêmes dates et mêmes courseSessionKey", () => {
  const weeks = mondayWeeks("2026-08-10", 4);
  const meetingDays = [meetingDay({ dayOfWeek: 4, weekKind: "B" })];
  const before = compute({ slots: [], weeks, meetingDays });
  const after = compute({
    slots: [slot({ dayOfWeek: 4, weekKind: "B", periodStart: 3, periodEnd: 4 })],
    weeks,
    meetingDays,
  });
  assert.deepEqual(
    before.map((entry) => entry.key),
    after.map((entry) => entry.key),
  );
  assert.deepEqual(
    before.map((entry) => ({ date: entry.date, sequenceNumber: entry.sequenceNumber, schoolWeekNumber: entry.schoolWeekNumber })),
    after.map((entry) => ({ date: entry.date, sequenceNumber: entry.sequenceNumber, schoolWeekNumber: entry.schoolWeekNumber })),
  );
  assert.ok(before.every((entry) => entry.segments.length === 0));
  assert.deepEqual(
    after.map((entry) => entry.segments),
    [
      [{ scheduleSlotId: "slot-1", periodStart: 3, periodEnd: 4 }],
      [{ scheduleSlotId: "slot-1", periodStart: 3, periodEnd: 4 }],
    ],
  );
  assert.equal(before[0]?.key, "SY-2026-27|AC-123|2026-08-20");
  assert.equal(after[0]?.key, before[0]?.key);
});

test("10 — slots A/B distincts sur meeting day all → bonnes périodes selon la semaine", () => {
  const sessions = compute({
    slots: [
      slot({ id: "s-a", dayOfWeek: 1, weekKind: "A", periodStart: 1, periodEnd: 2 }),
      slot({ id: "s-b", dayOfWeek: 1, weekKind: "B", periodStart: 3, periodEnd: 4 }),
    ],
    weeks: mondayWeeks("2026-08-10", 2),
    meetingDays: [meetingDay({ dayOfWeek: 1, weekKind: "all" })],
  });
  assert.equal(sessions.length, 2);
  assert.equal(sessions[0]?.date, "2026-08-10");
  assert.equal(sessions[0]?.weekKind, "A");
  assert.deepEqual(sessions[0]?.segments, [{ scheduleSlotId: "s-a", periodStart: 1, periodEnd: 2 }]);
  assert.equal(sessions[1]?.date, "2026-08-17");
  assert.equal(sessions[1]?.weekKind, "B");
  assert.deepEqual(sessions[1]?.segments, [{ scheduleSlotId: "s-b", periodStart: 3, periodEnd: 4 }]);
});

test("11 — slot sur un jour absent des meeting days → pas de séance supplémentaire", () => {
  const sessions = compute({
    slots: [
      slot({ id: "s-wed", dayOfWeek: 3, weekKind: "all", periodStart: 1, periodEnd: 2 }),
      slot({ id: "s-mon", dayOfWeek: 1, weekKind: "all", periodStart: 2, periodEnd: 3 }),
    ],
    weeks: mondayWeeks("2026-08-10", 1),
    meetingDays: [meetingDay({ dayOfWeek: 1, weekKind: "all" })],
  });
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.dayOfWeek, 1);
  assert.equal(sessions[0]?.date, "2026-08-10");
  assert.deepEqual(sessions[0]?.segments, [{ scheduleSlotId: "s-mon", periodStart: 2, periodEnd: 3 }]);
  assert.equal(
    sessions.some((entry) => entry.dayOfWeek === 3),
    false,
  );
});

test("12 — ordre et sequenceNumber déterministes", () => {
  const weeks = mondayWeeks("2026-08-10", 2);
  const meetingDays = [
    meetingDay({ dayOfWeek: 4, weekKind: "B" }),
    meetingDay({ dayOfWeek: 1, weekKind: "all" }),
  ];
  const slots = [
    slot({ id: "s-thu", dayOfWeek: 4, weekKind: "B", periodStart: 1, periodEnd: 2 }),
    slot({ id: "s-mon", dayOfWeek: 1, weekKind: "all", periodStart: 2, periodEnd: 3 }),
  ];
  const first = compute({ slots, weeks, meetingDays });
  const shuffled = compute({ slots: shuffle(slots), weeks, meetingDays: shuffle(meetingDays) });
  assert.deepEqual(shuffled, first);
  assert.deepEqual(first, compute({ slots, weeks, meetingDays }));
  assert.deepEqual(first.map((entry) => entry.sequenceNumber), [1, 2, 3]);
  assert.deepEqual(
    first.map((entry) => entry.key),
    [
      "SY-2026-27|AC-123|2026-08-10",
      "SY-2026-27|AC-123|2026-08-17",
      "SY-2026-27|AC-123|2026-08-20",
    ],
  );
});

test("slot validFrom n’efface pas la séance meeting day, seulement le segment", () => {
  const sessions = compute({
    slots: [slot({ dayOfWeek: 1, weekKind: "all", validFrom: "2026-08-17" })],
    weeks: mondayWeeks("2026-08-10", 2),
    meetingDays: [meetingDay({ dayOfWeek: 1, weekKind: "all" })],
  });
  assert.deepEqual(
    sessions.map((entry) => ({ date: entry.date, segments: entry.segments.length })),
    [
      { date: "2026-08-10", segments: 0 },
      { date: "2026-08-17", segments: 1 },
    ],
  );
});

test("cours mixte : meeting days pour l’un, slots legacy pour l’autre", () => {
  const other = { id: "AC-LEGACY", classId: "class-ma", contextId: "ctx-other" };
  const sessions = compute({
    courses: [course, other],
    slots: [
      slot({ id: "legacy", annualCourseId: other.id, dayOfWeek: 5, weekKind: "all", periodStart: 1, periodEnd: 2 }),
      slot({ id: "ignored-wed", dayOfWeek: 3, weekKind: "all", periodStart: 1, periodEnd: 2 }),
    ],
    weeks: mondayWeeks("2026-08-10", 1),
    meetingDays: [meetingDay({ dayOfWeek: 1, weekKind: "all" })],
  });
  assert.deepEqual(
    sessions.map((entry) => ({ id: entry.annualCourseId, date: entry.date, day: entry.dayOfWeek, segs: entry.segments.length })),
    [
      { id: course.id, date: "2026-08-10", day: 1, segs: 0 },
      { id: other.id, date: "2026-08-14", day: 5, segs: 1 },
    ],
  );
});
