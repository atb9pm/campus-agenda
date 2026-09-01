import assert from "node:assert/strict";
import test from "node:test";

import { getCourseDaysForAttendanceWeek } from "../src/features/calendar/attendance-course-days.ts";
import { validateAgendaScheduleTarget } from "../src/features/agenda/schedule-target.ts";
import { DEMO_CATALOG } from "../src/features/classes/index.ts";
import type { CourseScheduleSlot } from "../src/features/course-schedule/types.ts";
import type { SchoolWeek } from "../src/features/calendar/types.ts";

function week(number: number, kind: "A" | "B"): SchoolWeek {
  return { number, kind, monday: new Date(2026, 0, 5, 12) };
}

const tuesdayFriday = [
  { dayOfWeek: 2 as const, weekKind: "all" as const, role: "PRIMARY" as const },
  { dayOfWeek: 5 as const, weekKind: "A" as const, role: "ADDITIONAL" as const },
];

test("jours dynamiques — Mardi all + Vendredi A, jamais Lundi/Jeudi B", () => {
  const weekA = getCourseDaysForAttendanceWeek(week(1, "A"), tuesdayFriday);
  const weekB = getCourseDaysForAttendanceWeek(week(2, "B"), tuesdayFriday);
  assert.deepEqual(weekA.map((slot) => slot.dayIndex).sort(), [1, 4]);
  assert.deepEqual(weekB.map((slot) => slot.dayIndex), [1]);
  assert.equal(weekA.some((slot) => slot.dayIndex === 0 || slot.dayIndex === 3), false);
  assert.equal(weekB.some((slot) => slot.dayIndex === 0 || slot.dayIndex === 3), false);
});

test("publication dynamique — Moteur mardi all, Châssis vendredi A", () => {
  const weeks = [week(1, "A"), week(2, "B")].map((entry) => ({
    number: entry.number,
    kind: entry.kind,
    monday: "2026-01-05",
  }));
  const moteurSlots: CourseScheduleSlot[] = [
    {
      id: "slot-moteur",
      annualCourseId: "ac-moteur",
      dayOfWeek: 2,
      periodStart: 1,
      periodEnd: 2,
      weekKind: "all",
      validFrom: null,
      validTo: null,
      createdAt: "",
      updatedAt: "",
    },
  ];
  const chassisSlots: CourseScheduleSlot[] = [
    {
      id: "slot-chassis",
      annualCourseId: "ac-chassis",
      dayOfWeek: 5,
      periodStart: 1,
      periodEnd: 2,
      weekKind: "A",
      validFrom: null,
      validTo: null,
      createdAt: "",
      updatedAt: "",
    },
  ];

  const moteurA = validateAgendaScheduleTarget({
    schoolWeekNumber: 1,
    dayIndex: 1,
    weeks,
    attendanceDays: tuesdayFriday,
    slots: moteurSlots,
  });
  const chassisA = validateAgendaScheduleTarget({
    schoolWeekNumber: 1,
    dayIndex: 4,
    weeks,
    attendanceDays: tuesdayFriday,
    slots: chassisSlots,
  });
  const moteurB = validateAgendaScheduleTarget({
    schoolWeekNumber: 2,
    dayIndex: 1,
    weeks,
    attendanceDays: tuesdayFriday,
    slots: moteurSlots,
  });
  const chassisB = validateAgendaScheduleTarget({
    schoolWeekNumber: 2,
    dayIndex: 4,
    weeks,
    attendanceDays: tuesdayFriday,
    slots: chassisSlots,
  });
  const missingWeek = validateAgendaScheduleTarget({
    schoolWeekNumber: 5,
    dayIndex: 1,
    weeks,
    attendanceDays: tuesdayFriday,
    slots: moteurSlots,
  });

  assert.equal(moteurA.ok, true);
  assert.equal(chassisA.ok, true);
  assert.equal(moteurB.ok, true);
  assert.equal(chassisB.ok, false);
  assert.equal(missingWeek.ok, false);
  if (moteurA.ok) assert.equal(moteurA.source, "structured");
  if (!chassisB.ok) assert.match(chassisB.reason, /créneau|présente/i);
});

test("fallback TMA isolé uniquement sans donnée structurée", () => {
  const weeks = [
    { number: 1, kind: "A" as const, monday: "2026-01-05" },
    { number: 2, kind: "B" as const, monday: "2026-01-12" },
  ];
  const mondayA = validateAgendaScheduleTarget({ schoolWeekNumber: 1, dayIndex: 0, weeks });
  const thursdayA = validateAgendaScheduleTarget({ schoolWeekNumber: 1, dayIndex: 3, weeks });
  const thursdayB = validateAgendaScheduleTarget({ schoolWeekNumber: 2, dayIndex: 3, weeks });
  assert.equal(mondayA.ok, true);
  if (mondayA.ok) assert.equal(mondayA.source, "legacy-tma");
  assert.equal(thursdayA.ok, false);
  assert.equal(thursdayB.ok, true);
});

test("classe hors DEMO_CATALOG — les helpers ne la transforment pas en TMA", () => {
  assert.equal(DEMO_CATALOG.classrooms.some((entry) => entry.id === "classe-hors-demo"), false);
  const days = getCourseDaysForAttendanceWeek(week(3, "A"), tuesdayFriday);
  assert.deepEqual(days.map((slot) => slot.dayIndex).sort(), [1, 4]);
});

const structuredWeeks = [
  { number: 1, kind: "A" as const, monday: "2026-01-05" },
  { number: 2, kind: "B" as const, monday: "2026-01-12" },
];

const tuesdayAttendance = [{ dayOfWeek: 2 as const, weekKind: "all" as const, role: "PRIMARY" as const }];

function tuesdaySlot(): CourseScheduleSlot {
  return {
    id: "slot-mardi",
    annualCourseId: "ac-structure",
    dayOfWeek: 2,
    periodStart: 1,
    periodEnd: 2,
    weekKind: "all",
    validFrom: null,
    validTo: null,
    createdAt: "",
    updatedAt: "",
  };
}

function fridayASlot(): CourseScheduleSlot {
  return {
    id: "slot-vendredi-a",
    annualCourseId: "ac-structure",
    dayOfWeek: 5,
    periodStart: 1,
    periodEnd: 2,
    weekKind: "A",
    validFrom: null,
    validTo: null,
    createdAt: "",
    updatedAt: "",
  };
}

test("A — AnnualCourse résolu + présence mardi + 0 slot → publication refusée", () => {
  const result = validateAgendaScheduleTarget({
    schoolWeekNumber: 1,
    dayIndex: 1,
    weeks: structuredWeeks,
    attendanceDays: tuesdayAttendance,
    slots: [],
    resolvedStructuredCourse: true,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /Aucun créneau d'horaire pour cette branche ce jour-là/);
});

test("B — même cours + slot mardi all → publication autorisée", () => {
  const result = validateAgendaScheduleTarget({
    schoolWeekNumber: 1,
    dayIndex: 1,
    weeks: structuredWeeks,
    attendanceDays: tuesdayAttendance,
    slots: [tuesdaySlot()],
    resolvedStructuredCourse: true,
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.source, "structured");
});

test("C — slot vendredi A : semaine A autorisée, semaine B refusée", () => {
  const weekA = validateAgendaScheduleTarget({
    schoolWeekNumber: 1,
    dayIndex: 4,
    weeks: structuredWeeks,
    attendanceDays: [
      { dayOfWeek: 5, weekKind: "A", role: "ADDITIONAL" },
    ],
    slots: [fridayASlot()],
    resolvedStructuredCourse: true,
  });
  const weekB = validateAgendaScheduleTarget({
    schoolWeekNumber: 2,
    dayIndex: 4,
    weeks: structuredWeeks,
    attendanceDays: [
      { dayOfWeek: 5, weekKind: "A", role: "ADDITIONAL" },
    ],
    slots: [fridayASlot()],
    resolvedStructuredCourse: true,
  });
  assert.equal(weekA.ok, true);
  if (weekA.ok) assert.equal(weekA.source, "structured");
  assert.equal(weekB.ok, false);
  if (!weekB.ok) assert.match(weekB.reason, /créneau|présente/i);
});

test("D — aucun AnnualCourse structuré fiable → fallback TMA conservé", () => {
  const mondayA = validateAgendaScheduleTarget({
    schoolWeekNumber: 1,
    dayIndex: 0,
    weeks: structuredWeeks,
    resolvedStructuredCourse: false,
  });
  const thursdayB = validateAgendaScheduleTarget({
    schoolWeekNumber: 2,
    dayIndex: 3,
    weeks: structuredWeeks,
    resolvedStructuredCourse: false,
  });
  const thursdayA = validateAgendaScheduleTarget({
    schoolWeekNumber: 1,
    dayIndex: 3,
    weeks: structuredWeeks,
    resolvedStructuredCourse: false,
  });
  assert.equal(mondayA.ok, true);
  if (mondayA.ok) assert.equal(mondayA.source, "legacy-tma");
  assert.equal(thursdayB.ok, true);
  if (thursdayB.ok) assert.equal(thursdayB.source, "legacy-tma");
  assert.equal(thursdayA.ok, false);
});

test("E — AnnualCourse structuré sans slot → jamais fallback TMA", () => {
  const mondayWithoutSlots = validateAgendaScheduleTarget({
    schoolWeekNumber: 1,
    dayIndex: 0,
    weeks: structuredWeeks,
    slots: [],
    resolvedStructuredCourse: true,
  });
  const mondayWithAttendanceOnly = validateAgendaScheduleTarget({
    schoolWeekNumber: 1,
    dayIndex: 0,
    weeks: structuredWeeks,
    attendanceDays: tuesdayAttendance,
    slots: [],
    resolvedStructuredCourse: true,
  });
  assert.equal(mondayWithoutSlots.ok, false);
  if (!mondayWithoutSlots.ok) {
    assert.match(mondayWithoutSlots.reason, /Aucun créneau d'horaire pour cette branche ce jour-là/);
  }
  assert.equal(mondayWithAttendanceOnly.ok, false);
  if (!mondayWithAttendanceOnly.ok) {
    assert.doesNotMatch(mondayWithAttendanceOnly.reason, /Jour de cours invalide/);
  }
});
