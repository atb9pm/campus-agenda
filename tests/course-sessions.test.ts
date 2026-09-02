import assert from "node:assert/strict";
import test from "node:test";

import type { AnnualCourse } from "../src/features/annual-courses/types.ts";
import type { CourseScheduleSlot, CourseWeekKind, CourseWeekday } from "../src/features/course-schedule/types.ts";
import { validateCourseScheduleSlotInput } from "../src/features/course-schedule/index.ts";
import type { CourseScheduleServiceDeps } from "../src/features/course-schedule/service.ts";
import {
  computeCourseSessions,
  courseSessionKey,
  formatCourseSessionHeading,
  formatCourseSessionPeriods,
  formatCourseSessionSummary,
  listComputedCourseSessions,
} from "../src/features/course-sessions/index.ts";
import type { CourseSession } from "../src/features/course-sessions/types.ts";
import type { SchoolClassRecord } from "../src/features/school-catalog/types.ts";
import type { SchoolWeekEntry, SchoolYearWithWeeks } from "../src/features/school-year/types.ts";
import { APP_VERSION } from "../src/lib/app-version.ts";
import type { AnnualCourseStore } from "../src/lib/persistence/annual-course-types.ts";
import type { CourseScheduleStore } from "../src/lib/persistence/course-schedule-types.ts";
import type { SchoolCatalogStore } from "../src/lib/persistence/school-catalog-types.ts";
import type { SchoolYearStore } from "../src/lib/persistence/school-year-types.ts";
import { SQL_MIGRATION_FILES } from "../src/lib/persistence/sql/migrate.ts";

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

function compute(input: {
  slots: CourseScheduleSlot[];
  weeks: SchoolWeekEntry[];
  holidays?: ComputeParams["holidays"];
  exceptions?: ComputeParams["exceptions"];
  courses?: ComputeParams["courses"];
  schoolYearId?: string;
}) {
  return computeCourseSessions({
    schoolYearId: input.schoolYearId ?? SCHOOL_YEAR_ID,
    courses: input.courses ?? [course],
    slots: input.slots,
    weeks: input.weeks,
    holidays: input.holidays,
    exceptions: input.exceptions,
  });
}

type ComputeParams = Parameters<typeof computeCourseSessions>[0];

function shuffleSlots(slots: CourseScheduleSlot[]): CourseScheduleSlot[] {
  const copy = [...slots];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = (index * 5 + 2) % (index + 1);
    const current = copy[index]!;
    copy[index] = copy[swap]!;
    copy[swap] = current;
  }
  return copy;
}

test("version — CourseSession calculée, dernière migration 0024, aucune table CourseSession", () => {
  assert.match(APP_VERSION, /^\d+\.\d+\.\d+$/);
  assert.equal(SQL_MIGRATION_FILES.at(-1), "0024_structured_agenda_bridge.sql");
  assert.equal(
    SQL_MIGRATION_FILES.some((file) => file.startsWith("0025")),
    false,
  );
});

test("CourseSession n’a pas de trainingYear — l’identité reste contextId", () => {
  const session: CourseSession = compute({
    slots: [slot({})],
    weeks: mondayWeeks("2026-08-10", 1),
  })[0]!;
  assert.equal("trainingYear" in session, false);
  assert.equal("periodStart" in session, false);
  assert.equal("slotIds" in session, false);
  assert.equal(session.contextId, "ctx-moteur-y3");
  assert.equal(session.annualCourseId, "AC-123");
  assert.equal(session.classId, "class-ma");
  assert.equal(session.schoolYearId, SCHOOL_YEAR_ID);
  assert.equal(session.key, courseSessionKey(SCHOOL_YEAR_ID, "AC-123", "2026-08-10"));
  assert.equal(session.key, "SY-2026-27|AC-123|2026-08-10");
});

test("Moteur lundi P2-P3 — 5e séance le 07.09.2026", () => {
  const sessions = compute({
    slots: [slot({ periodStart: 2, periodEnd: 3 })],
    weeks: mondayWeeks("2026-08-10", 5),
  });
  assert.equal(sessions.length, 5);
  const fifth = sessions[4]!;
  assert.equal(fifth.date, "2026-09-07");
  assert.equal(fifth.sequenceNumber, 5);
  assert.equal(fifth.dayOfWeek, 1);
  assert.deepEqual(fifth.segments, [{ scheduleSlotId: "slot-1", periodStart: 2, periodEnd: 3 }]);
  assert.equal(
    formatCourseSessionSummary("Moteur", fifth),
    "Moteur — lundi 07.09.2026\nSéance n° 5\nP2-P3",
  );
  assert.equal(formatCourseSessionHeading("Moteur", fifth), "Moteur — lundi 07.09.2026");
});

test("A — P2 + P3 même cours/date → 1 session", () => {
  const sessions = compute({
    slots: [
      slot({ id: "s-p2", periodStart: 2, periodEnd: 2 }),
      slot({ id: "s-p3", periodStart: 3, periodEnd: 3 }),
    ],
    weeks: mondayWeeks("2026-08-10", 1),
  });
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.sequenceNumber, 1);
  assert.deepEqual(sessions[0]?.segments, [
    { scheduleSlotId: "s-p2", periodStart: 2, periodEnd: 2 },
    { scheduleSlotId: "s-p3", periodStart: 3, periodEnd: 3 },
  ]);
  assert.equal(formatCourseSessionPeriods(sessions[0]!.segments), "P2-P3");
});

test("B — P4 + P6 même cours/date → 1 session, 2 segments", () => {
  const sessions = compute({
    slots: [
      slot({ id: "s-p4", periodStart: 4, periodEnd: 4 }),
      slot({ id: "s-p6", periodStart: 6, periodEnd: 6 }),
    ],
    weeks: mondayWeeks("2026-08-10", 1),
  });
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.sequenceNumber, 1);
  assert.equal(sessions[0]?.segments.length, 2);
  assert.deepEqual(sessions[0]?.segments, [
    { scheduleSlotId: "s-p4", periodStart: 4, periodEnd: 4 },
    { scheduleSlotId: "s-p6", periodStart: 6, periodEnd: 6 },
  ]);
  assert.equal(formatCourseSessionPeriods(sessions[0]!.segments), "P4 · P6");
  assert.notEqual(formatCourseSessionPeriods(sessions[0]!.segments), "P4-P6");
});

test("C — P1-P2 + P3-P4 + P6 → 1 session, 3 segments", () => {
  const sessions = compute({
    slots: [
      slot({ id: "s-p12", periodStart: 1, periodEnd: 2 }),
      slot({ id: "s-p34", periodStart: 3, periodEnd: 4 }),
      slot({ id: "s-p6", periodStart: 6, periodEnd: 6 }),
    ],
    weeks: mondayWeeks("2026-08-10", 1),
  });
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.segments.length, 3);
  assert.equal(formatCourseSessionPeriods(sessions[0]!.segments), "P1-P4 · P6");
});

test("D — lundi + jeudi même AnnualCourse → 2 sessions", () => {
  const sessions = compute({
    slots: [
      slot({ id: "s-mon", dayOfWeek: 1, periodStart: 4, periodEnd: 4 }),
      slot({ id: "s-thu", dayOfWeek: 4, periodStart: 1, periodEnd: 2 }),
    ],
    weeks: mondayWeeks("2026-08-10", 1),
  });
  assert.equal(sessions.length, 2);
  assert.deepEqual(sessions.map((entry) => entry.date), ["2026-08-10", "2026-08-13"]);
  assert.equal(sessions[0]?.sequenceNumber, 1);
  assert.equal(sessions[1]?.sequenceNumber, 2);
  assert.equal(sessions[0]?.dayOfWeek, 1);
  assert.equal(sessions[1]?.dayOfWeek, 4);
});

test("E — lundi all + jeudi B sur paire A/B → 3 sessions", () => {
  const sessions = compute({
    slots: [
      slot({ id: "s-mon", dayOfWeek: 1, weekKind: "all", periodStart: 2, periodEnd: 3 }),
      slot({ id: "s-thu", dayOfWeek: 4, weekKind: "B", periodStart: 1, periodEnd: 2 }),
    ],
    weeks: mondayWeeks("2026-08-10", 2),
  });
  assert.equal(sessions.length, 3);
  assert.deepEqual(
    sessions.map((entry) => ({ date: entry.date, weekKind: entry.weekKind, day: entry.dayOfWeek })),
    [
      { date: "2026-08-10", weekKind: "A", day: 1 },
      { date: "2026-08-17", weekKind: "B", day: 1 },
      { date: "2026-08-20", weekKind: "B", day: 4 },
    ],
  );
  assert.deepEqual(sessions.map((entry) => entry.sequenceNumber), [1, 2, 3]);
});

test("F — jour férié → séance supprimée", () => {
  const sessions = compute({
    slots: [slot({})],
    weeks: mondayWeeks("2026-08-10", 3),
    holidays: [{ date: "2026-08-17", label: "Fête" }],
  });
  assert.deepEqual(sessions.map((entry) => entry.date), ["2026-08-10", "2026-08-24"]);
});

test("G — exception class rétablit un férié", () => {
  const sessions = compute({
    slots: [slot({})],
    weeks: mondayWeeks("2026-08-10", 2),
    holidays: [{ date: "2026-08-17", label: "Fête" }],
    exceptions: [{ date: "2026-08-17", state: "class", label: "Cours rattrapé" }],
  });
  assert.deepEqual(sessions.map((entry) => entry.date), ["2026-08-10", "2026-08-17"]);
});

test("H — exception holiday supprime un jour normal", () => {
  const sessions = compute({
    slots: [slot({})],
    weeks: mondayWeeks("2026-08-10", 2),
    exceptions: [{ date: "2026-08-10", state: "holiday", label: "Pont" }],
  });
  assert.deepEqual(sessions.map((entry) => entry.date), ["2026-08-17"]);
  assert.equal(sessions[0]?.sequenceNumber, 1);
});

test("I — exception class hors SchoolWeekEntry → aucune séance", () => {
  const sessions = compute({
    slots: [slot({})],
    weeks: mondayWeeks("2026-08-10", 1),
    exceptions: [{ date: "2026-07-15", state: "class", label: "Hors plan" }],
  });
  assert.deepEqual(sessions.map((entry) => entry.date), ["2026-08-10"]);
  assert.equal(
    sessions.some((entry) => entry.date === "2026-07-15"),
    false,
  );
});

test("J — vacances = semaine absente → aucune séance inventée", () => {
  const weeks = mondayWeeks("2026-08-10", 3);
  const withoutWeek2 = [weeks[0]!, weeks[2]!];
  const sessions = compute({
    slots: [slot({})],
    weeks: withoutWeek2,
  });
  assert.deepEqual(sessions.map((entry) => entry.date), ["2026-08-10", "2026-08-24"]);
  assert.equal(
    sessions.some((entry) => entry.date === "2026-08-17"),
    false,
  );
});

test("K — validFrom inclusif", () => {
  const sessions = compute({
    slots: [slot({ validFrom: "2026-08-17" })],
    weeks: mondayWeeks("2026-08-10", 2),
  });
  assert.deepEqual(sessions.map((entry) => entry.date), ["2026-08-17"]);
});

test("L — validTo inclusif", () => {
  const sessions = compute({
    slots: [slot({ validTo: "2026-08-10" })],
    weeks: mondayWeeks("2026-08-10", 2),
  });
  assert.deepEqual(sessions.map((entry) => entry.date), ["2026-08-10"]);
});

test("M — validFrom > validTo → refus écriture", () => {
  const parsed = validateCourseScheduleSlotInput({
    annualCourseId: course.id,
    dayOfWeek: 1,
    periodStart: 2,
    periodEnd: 3,
    weekKind: "all",
    validFrom: "2026-09-10",
    validTo: "2026-09-01",
  });
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.match(parsed.reason, /antérieure ou égale/);

  const badFormat = validateCourseScheduleSlotInput({
    annualCourseId: course.id,
    dayOfWeek: 1,
    periodStart: 2,
    periodEnd: 3,
    weekKind: "all",
    validFrom: "2026-09-07T00:00:00.000Z",
    validTo: null,
  });
  assert.equal(badFormat.ok, false);
});

test("N — dernière SchoolWeekEntry lundi 28.06 + vendredi → 02.07 malgré endsOn 28.06", () => {
  const sessions = compute({
    slots: [slot({ dayOfWeek: 5, periodStart: 1, periodEnd: 2 })],
    weeks: [{ number: 40, kind: "A", monday: "2027-06-28" }],
  });
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.date, "2027-07-02");
  assert.equal(sessions[0]?.dayOfWeek, 5);
  assert.equal(sessions[0]?.schoolWeekNumber, 40);
});

test("O — déterminisme : deux appels mêmes entrées → deepEqual", () => {
  const input = {
    slots: [
      slot({ id: "s-p4", periodStart: 4, periodEnd: 4 }),
      slot({ id: "s-p6", periodStart: 6, periodEnd: 6 }),
    ],
    weeks: mondayWeeks("2026-08-10", 3),
    holidays: [{ date: "2026-08-17", label: "Fête" }],
  };
  assert.deepEqual(compute(input), compute(input));
});

test("P — ordre aléatoire des slots → même résultat", () => {
  const slots = [
    slot({ id: "s-p6", periodStart: 6, periodEnd: 6 }),
    slot({ id: "s-p1", periodStart: 1, periodEnd: 2 }),
    slot({ id: "s-p4", periodStart: 4, periodEnd: 4 }),
    slot({ id: "s-p3", periodStart: 3, periodEnd: 3, dayOfWeek: 4 }),
  ];
  const weeks = mondayWeeks("2026-08-10", 2);
  assert.deepEqual(compute({ slots: shuffleSlots(slots), weeks }), compute({ slots, weeks }));
});

test("Q — numérotation : jour supprimé ne crée aucun trou", () => {
  const sessions = compute({
    slots: [slot({})],
    weeks: mondayWeeks("2026-08-10", 3),
    holidays: [{ date: "2026-08-17", label: "Fête" }],
  });
  assert.deepEqual(sessions.map((entry) => entry.sequenceNumber), [1, 2]);
  assert.deepEqual(sessions.map((entry) => entry.date), ["2026-08-10", "2026-08-24"]);
});

test("R — 0 ClassAttendanceDay + slots existants → séances générées", () => {
  const sessions = compute({
    slots: [slot({ periodStart: 4, periodEnd: 4 }), slot({ id: "s-p6", periodStart: 6, periodEnd: 6 })],
    weeks: mondayWeeks("2026-08-10", 1),
  });
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.segments.length, 2);
});

test("P1-P2 + P3-P4 adjacents s’affichent P1-P4", () => {
  assert.equal(
    formatCourseSessionPeriods([
      { scheduleSlotId: "a", periodStart: 1, periodEnd: 2 },
      { scheduleSlotId: "b", periodStart: 3, periodEnd: 4 },
    ]),
    "P1-P4",
  );
});

function annualCourse(patch: Partial<AnnualCourse> = {}): AnnualCourse {
  return {
    id: course.id,
    schoolYearId: SCHOOL_YEAR_ID,
    classId: course.classId,
    contextId: course.contextId,
    isArchived: false,
    archivedAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...patch,
  };
}

function yearRecord(status: SchoolYearWithWeeks["status"] = "active"): SchoolYearWithWeeks {
  return {
    id: SCHOOL_YEAR_ID,
    label: "2026-2027",
    status,
    startsOn: "2026-08-10",
    endsOn: "2026-08-10",
    sourceFilename: null,
    importedAt: null,
    activatedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    weeks: mondayWeeks("2026-08-10", 2),
  };
}

function serviceDeps(options: {
  year?: SchoolYearWithWeeks;
  courses?: AnnualCourse[];
  slots?: CourseScheduleSlot[];
  classYearId?: string;
  missingClass?: boolean;
}): CourseScheduleServiceDeps {
  const year = options.year ?? yearRecord();
  const courses = options.courses ?? [annualCourse()];
  const slots = options.slots ?? [slot({})];
  return {
    years: {
      getSchoolYearById: async (id: string) => (id === year.id ? year : null),
      listDayExceptions: async () => [],
    } as unknown as SchoolYearStore,
    courses: {
      listCourses: async () => courses,
      getCourse: async (id: string) => courses.find((entry) => entry.id === id) ?? null,
    } as unknown as AnnualCourseStore,
    schedules: {
      listSlots: async () => slots,
    } as unknown as CourseScheduleStore,
    catalog: {
      listClasses: async () =>
        options.missingClass
          ? []
          : ([{ id: course.classId, schoolYearId: options.classYearId ?? SCHOOL_YEAR_ID }] as SchoolClassRecord[]),
    } as unknown as SchoolCatalogStore,
  };
}

test("service — schoolYearId obligatoire et filtres cohérents", async () => {
  const missingYear = await listComputedCourseSessions(serviceDeps({}), { schoolYearId: "" });
  assert.equal(missingYear.ok, false);

  const unknownYear = await listComputedCourseSessions(serviceDeps({}), { schoolYearId: "missing" });
  assert.equal(unknownYear.ok, false);
  if (!unknownYear.ok) assert.equal(unknownYear.status, 404);

  const classMismatch = await listComputedCourseSessions(serviceDeps({ classYearId: "other-year" }), {
    schoolYearId: SCHOOL_YEAR_ID,
    classId: course.classId,
  });
  assert.equal(classMismatch.ok, false);

  const listed = await listComputedCourseSessions(serviceDeps({}), { schoolYearId: SCHOOL_YEAR_ID });
  assert.equal(listed.ok, true);
  if (listed.ok) {
    assert.equal(listed.value.length, 2);
    assert.equal(listed.value[0]?.key, "SY-2026-27|AC-123|2026-08-10");
  }
});

test("archives — année active exclut l’AnnualCourse archivé ; année archivée le reconstruit", async () => {
  const archivedCourse = annualCourse({ isArchived: true, archivedAt: "2026-12-01T00:00:00.000Z" });
  const active = await listComputedCourseSessions(
    serviceDeps({ year: yearRecord("active"), courses: [archivedCourse] }),
    { schoolYearId: SCHOOL_YEAR_ID },
  );
  assert.equal(active.ok, true);
  if (active.ok) assert.equal(active.value.length, 0);

  const historical = await listComputedCourseSessions(
    serviceDeps({ year: yearRecord("archived"), courses: [archivedCourse] }),
    { schoolYearId: SCHOOL_YEAR_ID },
  );
  assert.equal(historical.ok, true);
  if (historical.ok) assert.equal(historical.value.length, 2);
});
