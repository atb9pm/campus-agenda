import assert from "node:assert/strict";
import test from "node:test";

import type { TeacherCourseAssignment } from "../src/features/annual-courses/types.ts";
import { APP_VERSION } from "../src/lib/app-version.ts";
import {
  attendanceDraftIsComplete,
  attendanceInputsFromDraft,
  buildAttendanceRhythmSummary,
  buildAttendanceWeekPreview,
  buildClassDayBlocks,
  buildClassScheduleTemplate,
  compactLunchBlocks,
  findConflictingSlot,
  formatAttendancePresenceDetail,
  formatSlotRhythmLabel,
  formatTeachersLine,
  groupSlotsByAnnualCourse,
  nextAdditionalDraftDay,
  teachersForAnnualCourse,
  type ClassAttendanceDay,
  type CourseScheduleSlot,
  type CourseWeekKind,
  type CourseWeekday,
} from "../src/features/course-schedule/index.ts";
import { SQL_MIGRATION_FILES } from "../src/lib/persistence/sql/migrate.ts";

function attendance(
  dayOfWeek: CourseWeekday,
  weekKind: CourseWeekKind,
  role: ClassAttendanceDay["role"],
  id = `${role}-${dayOfWeek}-${weekKind}`,
): ClassAttendanceDay {
  return {
    id,
    classId: "mec-auto-3a",
    dayOfWeek,
    weekKind,
    role,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function slot(partial: Partial<CourseScheduleSlot> & Pick<CourseScheduleSlot, "id" | "annualCourseId">): CourseScheduleSlot {
  return {
    dayOfWeek: 1,
    periodStart: 1,
    periodEnd: 2,
    weekKind: "all",
    validFrom: null,
    validTo: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

const mondayAll = attendance(1, "all", "PRIMARY");
const thursdayB = attendance(4, "B", "ADDITIONAL");
const thursdayA = attendance(4, "A", "ADDITIONAL");

const referenceDays = [mondayAll, thursdayB];

test("version 2.27.0 — aucune migration SQL", () => {
  assert.equal(APP_VERSION, "2.27.0");
  assert.equal(SQL_MIGRATION_FILES.at(-1), "0023_class_attendance_days.sql");
  assert.equal(
    SQL_MIGRATION_FILES.some((file) => file.startsWith("0024")),
    false,
  );
});

test("A — résumé PRIMARY Lundi all + ADDITIONAL Jeudi B → A = Lundi, B = Lundi + Jeudi", () => {
  const summary = buildAttendanceRhythmSummary(referenceDays);
  assert.deepEqual(
    summary.weekA.map((day) => day.dayOfWeek),
    [1],
  );
  assert.deepEqual(
    summary.weekB.map((day) => day.dayOfWeek),
    [1, 4],
  );
  assert.equal(summary.weekALine, "Lundi");
  assert.equal(summary.weekBLine, "Lundi + Jeudi");
});

test("B — résumé ADDITIONAL Jeudi A → A = Lundi + Jeudi, B = Lundi", () => {
  const summary = buildAttendanceRhythmSummary([mondayAll, thursdayA]);
  assert.equal(summary.weekALine, "Lundi + Jeudi");
  assert.equal(summary.weekBLine, "Lundi");
});

test("C — trame Lundi all + Jeudi B : deux jours, pas deux copies du lundi", () => {
  const template = buildClassScheduleTemplate({
    days: referenceDays,
    slots: [
      slot({ id: "gen", annualCourseId: "generales", periodStart: 1, periodEnd: 3 }),
      slot({ id: "moteur-jeu", annualCourseId: "moteur", dayOfWeek: 4, periodStart: 1, periodEnd: 2, weekKind: "B" }),
    ],
  });
  assert.deepEqual(
    template.days.map((day) => day.dayOfWeek),
    [1, 4],
  );
  assert.equal(template.days.filter((day) => day.dayOfWeek === 1).length, 1);
  assert.equal(template.days[0]?.coverage, "all");
  assert.equal(template.days[0]?.coverageLabel, "Toutes les semaines");
  assert.equal(template.days[0]?.roleLabel, "Jour principal");
  assert.equal(template.days[1]?.coverage, "B");
  assert.equal(template.days[1]?.roleLabel, "Jour complémentaire");
});

test("D — Jeudi A + Jeudi B : un seul jeudi en trame, couverture A+B", () => {
  const template = buildClassScheduleTemplate({
    days: [mondayAll, thursdayA, thursdayB],
    slots: [],
  });
  assert.deepEqual(
    template.days.map((day) => day.dayOfWeek),
    [1, 4],
  );
  const thursday = template.days.find((day) => day.dayOfWeek === 4);
  assert.equal(thursday?.coverage, "A+B");
  assert.equal(thursday?.coverageLabel, "Semaines A et B");
  assert.equal(thursday?.roleLabel, "Jour complémentaire");
});

test("E — Moteur P4 + P6 + Jeudi B reste 3 CourseScheduleSlot distincts", () => {
  const slots = [
    slot({ id: "m4", annualCourseId: "moteur", periodStart: 4, periodEnd: 4 }),
    slot({ id: "m6", annualCourseId: "moteur", periodStart: 6, periodEnd: 6 }),
    slot({
      id: "m-jeu",
      annualCourseId: "moteur",
      dayOfWeek: 4,
      periodStart: 1,
      periodEnd: 2,
      weekKind: "B",
    }),
  ];
  assert.equal(slots.length, 3);
  assert.equal(new Set(slots.map((entry) => entry.id)).size, 3);
  const [p4, p6] = slots;
  assert.notEqual(`${p4?.periodStart}-${p4?.periodEnd}`, "4-6");
  assert.equal(p4?.periodStart, 4);
  assert.equal(p4?.periodEnd, 4);
  assert.equal(p6?.periodStart, 6);
  assert.equal(p6?.periodEnd, 6);
});

test("F — présentation groupée : un AnnualCourse Moteur + 3 créneaux", () => {
  const slots = [
    slot({ id: "m4", annualCourseId: "moteur", periodStart: 4, periodEnd: 4 }),
    slot({ id: "m6", annualCourseId: "moteur", periodStart: 6, periodEnd: 6 }),
    slot({
      id: "m-jeu",
      annualCourseId: "moteur",
      dayOfWeek: 4,
      periodStart: 1,
      periodEnd: 2,
      weekKind: "B",
    }),
  ];
  const groups = groupSlotsByAnnualCourse([{ id: "moteur" }, { id: "chassis" }], slots);
  assert.equal(groups.length, 2);
  assert.equal(groups[0]?.course.id, "moteur");
  assert.equal(groups[0]?.slots.length, 3);
  assert.deepEqual(
    groups[0]?.slots.map((entry) => entry.id),
    ["m4", "m6", "m-jeu"],
  );
  assert.equal(groups[1]?.slots.length, 0);
});

test("G — P4 + P6 : la trame contient P4 Moteur, P5 Pause, P6 Moteur", () => {
  const template = buildClassScheduleTemplate({
    days: [mondayAll],
    slots: [
      slot({ id: "m4", annualCourseId: "moteur", periodStart: 4, periodEnd: 4 }),
      slot({ id: "m6", annualCourseId: "moteur", periodStart: 6, periodEnd: 6 }),
    ],
  });
  const monday = template.days[0]!;
  assert.deepEqual(
    monday.blocks.map((block) => ({
      kind: block.kind,
      start: block.periodStart,
      end: block.periodEnd,
    })),
    [
      { kind: "course", start: 4, end: 4 },
      { kind: "lunch", start: 5, end: 5 },
      { kind: "course", start: 6, end: 6 },
    ],
  );
  assert.equal(
    monday.blocks.some((block) => block.kind === "course" && block.periodStart === 4 && block.periodEnd === 6),
    false,
  );
});

test("H — Jeudi P1-P2 uniquement : pas de P5 dans la trame compacte", () => {
  const thursdaySlots = [
    slot({
      id: "m-jeu",
      annualCourseId: "moteur",
      dayOfWeek: 4,
      periodStart: 1,
      periodEnd: 2,
      weekKind: "B",
    }),
  ];
  const raw = buildClassDayBlocks(thursdaySlots, 4);
  assert.equal(
    raw.some((block) => block.kind === "lunch"),
    true,
    "buildClassDayBlocks conserve P5 pour les autres vues",
  );
  const compact = compactLunchBlocks(raw);
  assert.equal(
    compact.some((block) => block.kind === "lunch"),
    false,
  );
  const template = buildClassScheduleTemplate({
    days: referenceDays,
    slots: thursdaySlots,
  });
  const thursday = template.days.find((day) => day.dayOfWeek === 4)!;
  assert.equal(
    thursday.blocks.some((block) => block.kind === "lunch"),
    false,
  );
});

test("I — Lundi P1-P2 A Moteur + B Transmission : pas de conflit, rythmes visibles", () => {
  const moteurA = slot({
    id: "moteur-a",
    annualCourseId: "moteur",
    periodStart: 1,
    periodEnd: 2,
    weekKind: "A",
  });
  const transmissionB = slot({
    id: "trans-b",
    annualCourseId: "transmission",
    periodStart: 1,
    periodEnd: 2,
    weekKind: "B",
  });
  assert.equal(findConflictingSlot(moteurA, [transmissionB]), undefined);
  const template = buildClassScheduleTemplate({
    days: [mondayAll],
    slots: [moteurA, transmissionB],
  });
  const block = template.days[0]?.blocks.find((entry) => entry.kind === "course");
  assert.equal(block?.periodStart, 1);
  assert.equal(block?.periodEnd, 2);
  assert.deepEqual(
    block?.slots.map((entry) => `${entry.annualCourseId}:${entry.weekKind}`).sort(),
    ["moteur:A", "transmission:B"],
  );
});

test("J — vue Semaine A : Moteur uniquement", () => {
  const moteurA = slot({
    id: "moteur-a",
    annualCourseId: "moteur",
    periodStart: 1,
    periodEnd: 2,
    weekKind: "A",
  });
  const transmissionB = slot({
    id: "trans-b",
    annualCourseId: "transmission",
    periodStart: 1,
    periodEnd: 2,
    weekKind: "B",
  });
  const preview = buildAttendanceWeekPreview({
    days: [mondayAll],
    slots: [moteurA, transmissionB],
    weekKind: "A",
  });
  const courseIds = preview.days
    .flatMap((day) => day.blocks)
    .flatMap((block) => block.slots)
    .map((entry) => entry.annualCourseId);
  assert.deepEqual(courseIds, ["moteur"]);
});

test("K — vue Semaine B : Transmission uniquement", () => {
  const moteurA = slot({
    id: "moteur-a",
    annualCourseId: "moteur",
    periodStart: 1,
    periodEnd: 2,
    weekKind: "A",
  });
  const transmissionB = slot({
    id: "trans-b",
    annualCourseId: "transmission",
    periodStart: 1,
    periodEnd: 2,
    weekKind: "B",
  });
  const preview = buildAttendanceWeekPreview({
    days: [mondayAll],
    slots: [moteurA, transmissionB],
    weekKind: "B",
  });
  const courseIds = preview.days
    .flatMap((day) => day.blocks)
    .flatMap((block) => block.slots)
    .map((entry) => entry.annualCourseId);
  assert.deepEqual(courseIds, ["transmission"]);
});

test("L — TeacherCourseAssignment : enseignant une seule fois par groupe de branche", () => {
  const assignments: TeacherCourseAssignment[] = [
    {
      id: "as1",
      annualCourseId: "moteur",
      teacherId: "t-francois",
      role: "PRIMARY",
      validFrom: "2020-01-01T00:00:00.000Z",
      validTo: null,
      createdByAdminId: "admin",
      createdAt: "2026-01-01T00:00:00.000Z",
      endedAt: null,
      overrideReason: null,
      overrideByAdminId: null,
    },
  ];
  const slots = [
    slot({ id: "m4", annualCourseId: "moteur", periodStart: 4, periodEnd: 4 }),
    slot({ id: "m6", annualCourseId: "moteur", periodStart: 6, periodEnd: 6 }),
    slot({
      id: "m-jeu",
      annualCourseId: "moteur",
      dayOfWeek: 4,
      periodStart: 1,
      periodEnd: 2,
      weekKind: "B",
    }),
  ];
  const groups = groupSlotsByAnnualCourse([{ id: "moteur" }], slots);
  assert.equal(groups.length, 1);
  const teachers = teachersForAnnualCourse(
    assignments,
    [{ id: "t-francois", displayName: "François Cheseaux" }],
    groups[0]!.course.id,
    "2026-08-31T00:00:00.000Z",
  );
  assert.equal(teachers.length, 1);
  assert.equal(formatTeachersLine(teachers), "François Cheseaux — titulaire");
});

test("libellés de créneau : jour + rythme long", () => {
  assert.equal(
    formatSlotRhythmLabel({ dayOfWeek: 1, weekKind: "all" }),
    "Lundi · Toutes les semaines",
  );
  assert.equal(formatSlotRhythmLabel({ dayOfWeek: 1, weekKind: "A" }), "Lundi · Semaine A");
  assert.equal(formatSlotRhythmLabel({ dayOfWeek: 4, weekKind: "B" }), "Jeudi · Semaine B");
});

test("jours enregistrés : rythme explicite A + B / B uniquement", () => {
  assert.equal(formatAttendancePresenceDetail(mondayAll), "A + B · Toutes les semaines");
  assert.equal(formatAttendancePresenceDetail(thursdayB), "B uniquement");
  assert.equal(formatAttendancePresenceDetail(thursdayA), "A uniquement");
});

test("nouveau jour complémentaire : weekKind vide, enregistrement interdit", () => {
  const next = nextAdditionalDraftDay(1, []);
  assert.equal(next.weekKind, "");
  assert.equal(
    attendanceDraftIsComplete({ primaryDay: 1, additional: [next] }),
    false,
  );
  assert.deepEqual(attendanceInputsFromDraft({ primaryDay: 1, additional: [next] }), [
    { dayOfWeek: 1, weekKind: "all", role: "PRIMARY" },
  ]);
  assert.equal(
    attendanceDraftIsComplete({
      primaryDay: 1,
      additional: [{ dayOfWeek: 4, weekKind: "B" }],
    }),
    true,
  );
});
