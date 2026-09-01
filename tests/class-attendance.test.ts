import assert from "node:assert/strict";
import test from "node:test";

import {
  archiveAnnualCourse,
  assignTeacherToCourse,
  createAnnualCourse,
  type AnnualCourse,
  type AnnualCourseServiceDeps,
} from "../src/features/annual-courses/index.ts";
import { APP_VERSION } from "../src/lib/app-version.ts";
import {
  ATTENDANCE_DAY_MISMATCH_CODE,
  ATTENDANCE_IN_USE_CODE,
  ATTENDANCE_NOT_CONFIGURED_CODE,
  LUNCH_PERIOD,
  attendanceCoversScheduleSlot,
  attendanceDaysForWeek,
  buildAttendanceWeekPreview,
  createCourseScheduleSlot,
  deleteCourseScheduleSlot,
  formatSlotDayBadge,
  replaceAttendanceDaysForClass,
  scheduleEditorStateAfterYearChange,
  suggestAttendanceDraftFromSlots,
  updateCourseScheduleSlot,
  validateAttendancePlan,
  type ClassAttendanceDay,
  type ClassAttendanceDayInput,
  type CourseScheduleServiceDeps,
  type CourseScheduleSlot,
  type CourseWeekKind,
  type CourseWeekday,
} from "../src/features/course-schedule/index.ts";
import { classDeleteBlockers as catalogClassDeleteBlockers } from "../src/features/school-catalog/index.ts";
import {
  MemoryAnnualCourseStore,
  resetMemoryAnnualCourseStore,
} from "../src/lib/persistence/memory-annual-course-store.ts";
import { MemoryCourseScheduleStore } from "../src/lib/persistence/memory-course-schedule-store.ts";
import {
  getMemoryAnnualCourseNotesStore,
  resetMemoryPedagogicalPathStore,
} from "../src/lib/persistence/memory-pedagogical-path-store.ts";
import {
  getMemorySchoolCatalogStore,
  resetMemorySchoolCatalogStore,
} from "../src/lib/persistence/memory-school-catalog-store.ts";
import {
  getMemoryTeacherAccountStore,
  resetMemoryTeacherAccountStore,
} from "../src/lib/persistence/memory-teacher-account-store.ts";
import type { SchoolYearRecord } from "../src/features/school-year/types.ts";
import type { SchoolYearStore } from "../src/lib/persistence/school-year-types.ts";
import { createNodeSqliteDatabase } from "../src/lib/persistence/sql/adapters.ts";
import { applyMigrations, SQL_MIGRATION_FILES } from "../src/lib/persistence/sql/migrate.ts";
import { SqlAnnualCourseStore } from "../src/lib/persistence/sql/sql-annual-course-store.ts";
import { SqlAnnualCourseNotesStore } from "../src/lib/persistence/sql/sql-pedagogical-path-store.ts";
import { SqlCourseScheduleStore } from "../src/lib/persistence/sql/sql-course-schedule-store.ts";
import { SqlSchoolCatalogStore } from "../src/lib/persistence/sql/sql-school-catalog-store.ts";
import { SqlTeacherAccountStore } from "../src/lib/persistence/sql/sql-teacher-account-store.ts";
import type { SchoolCatalogStore } from "../src/lib/persistence/school-catalog-types.ts";
import type { SchoolClassRecord } from "../src/features/school-catalog/types.ts";
import type { PedagogicalContextRecord } from "../src/features/school-catalog/profession-types.ts";

type StoreKind = "memory" | "sqlite";

function yearRecord(id: string, label: string, status: SchoolYearRecord["status"] = "active"): SchoolYearRecord {
  return {
    id,
    label,
    status,
    startsOn: "2026-08-17",
    endsOn: "2027-07-02",
    sourceFilename: null,
    importedAt: null,
    activatedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function yearsFrom(records: SchoolYearRecord[]): SchoolYearStore {
  return { listSchoolYears: async () => records } as SchoolYearStore;
}

interface World {
  kind: StoreKind;
  db: ReturnType<typeof createNodeSqliteDatabase> | null;
  years: SchoolYearRecord[];
  catalog: SchoolCatalogStore;
  courseDeps: AnnualCourseServiceDeps;
  scheduleDeps: CourseScheduleServiceDeps;
  classA: SchoolClassRecord;
  classB: SchoolClassRecord;
  moteurCtx: PedagogicalContextRecord;
  chassisCtx: PedagogicalContextRecord;
  transmissionCtx: PedagogicalContextRecord;
}

async function makeWorld(kind: StoreKind): Promise<World> {
  const years = [yearRecord("year-2026", "2026-2027")];
  let catalog: SchoolCatalogStore;
  let courses: AnnualCourseServiceDeps["courses"];
  let notes: AnnualCourseServiceDeps["notes"];
  let teachersStore: AnnualCourseServiceDeps["teachers"];
  let schedules: CourseScheduleServiceDeps["schedules"];
  let db: ReturnType<typeof createNodeSqliteDatabase> | null = null;

  if (kind === "memory") {
    resetMemorySchoolCatalogStore();
    resetMemoryAnnualCourseStore();
    resetMemoryPedagogicalPathStore();
    resetMemoryTeacherAccountStore();
    catalog = getMemorySchoolCatalogStore();
    await catalog.ensureSeeded();
    courses = new MemoryAnnualCourseStore();
    notes = getMemoryAnnualCourseNotesStore();
    teachersStore = getMemoryTeacherAccountStore();
    schedules = new MemoryCourseScheduleStore();
  } else {
    db = createNodeSqliteDatabase(":memory:");
    await applyMigrations(db);
    catalog = new SqlSchoolCatalogStore(db);
    await catalog.ensureSeeded();
    courses = new SqlAnnualCourseStore(db);
    notes = new SqlAnnualCourseNotesStore(db);
    teachersStore = new SqlTeacherAccountStore(db);
    schedules = new SqlCourseScheduleStore(db);
  }

  const yearStore = yearsFrom(years);
  const profession = await catalog.createProfession({
    label: "Mécatronicien automobile",
    durationYears: 4,
  });
  const branches = await catalog.listBranches();
  const moteur = branches.find((entry) => entry.label === "Moteur") ?? branches[0]!;
  const chassis = branches.find((entry) => entry.label === "Châssis") ?? branches[2]!;
  const transmission = branches.find((entry) => entry.label === "Transmission") ?? branches[3]!;
  await catalog.updateBranch(moteur.id, { teachingType: "TECHNICAL" });
  await catalog.updateBranch(chassis.id, { teachingType: "TECHNICAL" });
  await catalog.updateBranch(transmission.id, { teachingType: "TECHNICAL" });

  const moteurCtx = await catalog.createContext({
    professionId: profession.id,
    trainingYear: 1,
    branchId: moteur.id,
  });
  const chassisCtx = await catalog.createContext({
    professionId: profession.id,
    trainingYear: 1,
    branchId: chassis.id,
  });
  const transmissionCtx = await catalog.createContext({
    professionId: profession.id,
    trainingYear: 1,
    branchId: transmission.id,
  });
  assert.equal(moteurCtx.ok && chassisCtx.ok && transmissionCtx.ok, true);
  if (!moteurCtx.ok || !chassisCtx.ok || !transmissionCtx.ok) throw new Error("CTX");

  const classA = await catalog.createClass({
    code: "MMA1A",
    label: "MMA1A",
    schoolYearId: "year-2026",
    schoolYearLabel: "2026-2027",
    professionId: profession.id,
    trainingYear: 1,
    parallelCode: "A",
  });
  const classB = await catalog.createClass({
    code: "MMA1B",
    label: "MMA1B",
    schoolYearId: "year-2026",
    schoolYearLabel: "2026-2027",
    professionId: profession.id,
    trainingYear: 1,
    parallelCode: "B",
  });

  const francois = await teachersStore.createAccount({
    displayName: "François",
    initials: "FrF",
    teachingType: "TECHNICAL",
  });
  assert.equal(francois.ok, true);
  if (!francois.ok) throw new Error("teacher");

  const courseDeps: AnnualCourseServiceDeps = {
    courses,
    catalog,
    years: yearStore,
    teachers: teachersStore,
    notes,
    schedules,
  };
  const scheduleDeps: CourseScheduleServiceDeps = {
    schedules,
    courses,
    catalog,
    years: yearStore,
    teachers: teachersStore,
  };

  return {
    kind,
    db,
    years,
    catalog,
    courseDeps,
    scheduleDeps,
    classA,
    classB,
    moteurCtx: moteurCtx.value,
    chassisCtx: chassisCtx.value,
    transmissionCtx: transmissionCtx.value,
  };
}

async function courseFor(
  world: World,
  schoolClass: SchoolClassRecord,
  context: PedagogicalContextRecord,
): Promise<AnnualCourse> {
  const created = await createAnnualCourse(world.courseDeps, {
    schoolYearId: schoolClass.schoolYearId ?? "year-2026",
    classId: schoolClass.id,
    contextId: context.id,
  });
  assert.equal(created.ok, true);
  if (!created.ok) throw new Error(created.reason);
  return created.value;
}

function testBoth(name: string, run: (world: World) => Promise<void>) {
  test(`Memory — ${name}`, async () => {
    await run(await makeWorld("memory"));
  });
  test(`SQLite — ${name}`, async () => {
    await run(await makeWorld("sqlite"));
  });
}

function plan(
  ...days: ClassAttendanceDayInput[]
): ClassAttendanceDayInput[] {
  return days;
}

function slot(
  dayOfWeek: CourseWeekday,
  weekKind: CourseWeekKind,
): Pick<CourseScheduleSlot, "dayOfWeek" | "weekKind"> {
  return { dayOfWeek, weekKind };
}

test("version 2.27.0 — jours de présence, migration 0023 après 0022, pas de 0024", () => {
  assert.equal(APP_VERSION, "2.27.0");
  assert.ok(SQL_MIGRATION_FILES.includes("0022_course_schedule_slots.sql"));
  assert.equal(SQL_MIGRATION_FILES.at(-1), "0023_class_attendance_days.sql");
  assert.ok(
    SQL_MIGRATION_FILES.indexOf("0022_course_schedule_slots.sql") <
      SQL_MIGRATION_FILES.indexOf("0023_class_attendance_days.sql"),
  );
  assert.equal(
    SQL_MIGRATION_FILES.some((file) => file.startsWith("0024")),
    false,
  );
});

test("A — PRIMARY Lundi all → OK", () => {
  const result = validateAttendancePlan(plan({ dayOfWeek: 1, weekKind: "all", role: "PRIMARY" }));
  assert.equal(result.ok, true);
});

test("B — PRIMARY Lundi A → refus", () => {
  const result = validateAttendancePlan(plan({ dayOfWeek: 1, weekKind: "A", role: "PRIMARY" }));
  assert.equal(result.ok, false);
});

test("C — deux PRIMARY → refus", () => {
  const result = validateAttendancePlan(
    plan(
      { dayOfWeek: 1, weekKind: "all", role: "PRIMARY" },
      { dayOfWeek: 4, weekKind: "all", role: "PRIMARY" },
    ),
  );
  assert.equal(result.ok, false);
});

test("D — ADDITIONAL Jeudi B → OK", () => {
  const result = validateAttendancePlan(
    plan(
      { dayOfWeek: 1, weekKind: "all", role: "PRIMARY" },
      { dayOfWeek: 4, weekKind: "B", role: "ADDITIONAL" },
    ),
  );
  assert.equal(result.ok, true);
});

test("E — Lundi all + Lundi B → refus redondant", () => {
  const result = validateAttendancePlan(
    plan(
      { dayOfWeek: 1, weekKind: "all", role: "PRIMARY" },
      { dayOfWeek: 1, weekKind: "B", role: "ADDITIONAL" },
    ),
  );
  assert.equal(result.ok, false);
});

test("F — Jeudi A + Jeudi B → autorisé", () => {
  const result = validateAttendancePlan(
    plan(
      { dayOfWeek: 1, weekKind: "all", role: "PRIMARY" },
      { dayOfWeek: 4, weekKind: "A", role: "ADDITIONAL" },
      { dayOfWeek: 4, weekKind: "B", role: "ADDITIONAL" },
    ),
  );
  assert.equal(result.ok, true);
});

test("G — Lundi all couvre slot Lundi all", () => {
  assert.equal(attendanceCoversScheduleSlot([{ dayOfWeek: 1, weekKind: "all" }], slot(1, "all")), true);
});

test("H — Lundi all couvre slot Lundi A", () => {
  assert.equal(attendanceCoversScheduleSlot([{ dayOfWeek: 1, weekKind: "all" }], slot(1, "A")), true);
});

test("I — Lundi all couvre slot Lundi B", () => {
  assert.equal(attendanceCoversScheduleSlot([{ dayOfWeek: 1, weekKind: "all" }], slot(1, "B")), true);
});

test("J — Jeudi B couvre slot Jeudi B", () => {
  assert.equal(attendanceCoversScheduleSlot([{ dayOfWeek: 4, weekKind: "B" }], slot(4, "B")), true);
});

test("K — Jeudi B ne couvre pas slot Jeudi all", () => {
  assert.equal(attendanceCoversScheduleSlot([{ dayOfWeek: 4, weekKind: "B" }], slot(4, "all")), false);
});

test("L — Jeudi B ne couvre pas slot Jeudi A", () => {
  assert.equal(attendanceCoversScheduleSlot([{ dayOfWeek: 4, weekKind: "B" }], slot(4, "A")), false);
});

test("M — Jeudi A + Jeudi B couvrent slot Jeudi all", () => {
  assert.equal(
    attendanceCoversScheduleSlot(
      [
        { dayOfWeek: 4, weekKind: "A" },
        { dayOfWeek: 4, weekKind: "B" },
      ],
      slot(4, "all"),
    ),
    true,
  );
});

testBoth("N — aucun ClassAttendanceDay → créneau ATTENDANCE_NOT_CONFIGURED", async (world) => {
  const course = await courseFor(world, world.classA, world.moteurCtx);
  const created = await createCourseScheduleSlot(world.scheduleDeps, {
    annualCourseId: course.id,
    dayOfWeek: 1,
    periodStart: 1,
    periodEnd: 2,
    weekKind: "all",
  });
  assert.equal(created.ok, false);
  if (created.ok) return;
  assert.equal(created.code, ATTENDANCE_NOT_CONFIGURED_CODE);
  assert.equal(created.status, 409);
});

test("O/P — migration 0023 conserve les créneaux 0022 et n’invente aucun jour", async () => {
  const db = createNodeSqliteDatabase(":memory:");
  await applyMigrations(db, { until: "0022_course_schedule_slots.sql" });
  const catalog = new SqlSchoolCatalogStore(db);
  await catalog.ensureSeeded();
  const profession = await catalog.createProfession({ label: "Mécatronique", durationYears: 4 });
  const branch = (await catalog.listBranches())[0]!;
  await catalog.updateBranch(branch.id, { teachingType: "TECHNICAL" });
  const context = await catalog.createContext({
    professionId: profession.id,
    trainingYear: 1,
    branchId: branch.id,
  });
  assert.equal(context.ok, true);
  if (!context.ok) return;
  const schoolClass = await catalog.createClass({
    code: "MMA1A",
    label: "MMA1A",
    schoolYearId: "year-2026",
    schoolYearLabel: "2026-2027",
    professionId: profession.id,
    trainingYear: 1,
    parallelCode: "A",
  });
  const courses = new SqlAnnualCourseStore(db);
  const course = await courses.createCourse({
    id: "ac-pr52",
    schoolYearId: "year-2026",
    classId: schoolClass.id,
    contextId: context.value.id,
    isArchived: false,
    archivedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  await db
    .prepare(
      `INSERT INTO course_schedule_slots (
        id, annual_course_id, day_of_week, period_start, period_end, week_kind, created_at, updated_at
      ) VALUES (?, ?, 1, 1, 2, 'all', datetime('now'), datetime('now'))`,
    )
    .bind("css-pr52", course.id)
    .run();
  const before = await db
    .prepare("SELECT id, annual_course_id, day_of_week FROM course_schedule_slots")
    .bind()
    .all<{ id: string; annual_course_id: string; day_of_week: number }>();
  assert.equal(before.results?.length, 1);
  assert.equal(before.results?.[0]?.id, "css-pr52");

  await applyMigrations(db);
  const store = new SqlCourseScheduleStore(db);
  const slots = await store.listSlots();
  assert.equal(slots.length, 1);
  assert.equal(slots[0]?.id, "css-pr52");
  assert.equal(slots[0]?.annualCourseId, course.id);
  assert.equal(slots[0]?.dayOfWeek, 1);
  assert.equal((await store.listAttendanceDays()).length, 0);
});

testBoth("Q/S — plan incompatible ou jour utilisé → ATTENDANCE_IN_USE, ancien plan intact", async (world) => {
  const saved = await replaceAttendanceDaysForClass(
    world.scheduleDeps,
    world.classA.id,
    plan(
      { dayOfWeek: 1, weekKind: "all", role: "PRIMARY" },
      { dayOfWeek: 4, weekKind: "B", role: "ADDITIONAL" },
    ),
  );
  assert.equal(saved.ok, true);
  const course = await courseFor(world, world.classA, world.chassisCtx);
  const created = await createCourseScheduleSlot(world.scheduleDeps, {
    annualCourseId: course.id,
    dayOfWeek: 4,
    periodStart: 1,
    periodEnd: 4,
    weekKind: "B",
  });
  assert.equal(created.ok, true);

  const refused = await replaceAttendanceDaysForClass(
    world.scheduleDeps,
    world.classA.id,
    plan({ dayOfWeek: 2, weekKind: "all", role: "PRIMARY" }),
  );
  assert.equal(refused.ok, false);
  if (refused.ok) return;
  assert.equal(refused.code, ATTENDANCE_IN_USE_CODE);
  assert.equal(refused.status, 409);

  const still = await world.scheduleDeps.schedules.listAttendanceDaysByClass(world.classA.id);
  assert.deepEqual(
    still.map((day) => `${day.dayOfWeek}:${day.weekKind}:${day.role}`).sort(),
    ["1:all:PRIMARY", "4:B:ADDITIONAL"],
  );
});

test("R — échec SQL du replace → ancien plan intact", async () => {
  const world = await makeWorld("sqlite");
  const saved = await replaceAttendanceDaysForClass(
    world.scheduleDeps,
    world.classA.id,
    plan({ dayOfWeek: 1, weekKind: "all", role: "PRIMARY" }),
  );
  assert.equal(saved.ok, true);
  const before = await world.scheduleDeps.schedules.listAttendanceDaysByClass(world.classA.id);
  assert.equal(before.length, 1);

  await assert.rejects(
    () =>
      world.scheduleDeps.schedules.replaceAttendanceDaysForClass(world.classA.id, [
        {
          id: "cad-bad",
          classId: world.classA.id,
          dayOfWeek: 1,
          weekKind: "A",
          role: "PRIMARY",
          createdAt: "t",
          updatedAt: "t",
        },
      ]),
    /CHECK|constraint/i,
  );
  const after = await world.scheduleDeps.schedules.listAttendanceDaysByClass(world.classA.id);
  assert.equal(after.length, 1);
  assert.equal(after[0]?.id, before[0]?.id);
  assert.equal(after[0]?.weekKind, "all");
});

testBoth("T — après suppression du créneau, le plan redevient modifiable", async (world) => {
  await replaceAttendanceDaysForClass(
    world.scheduleDeps,
    world.classA.id,
    plan(
      { dayOfWeek: 1, weekKind: "all", role: "PRIMARY" },
      { dayOfWeek: 4, weekKind: "B", role: "ADDITIONAL" },
    ),
  );
  const course = await courseFor(world, world.classA, world.chassisCtx);
  const created = await createCourseScheduleSlot(world.scheduleDeps, {
    annualCourseId: course.id,
    dayOfWeek: 4,
    periodStart: 1,
    periodEnd: 4,
    weekKind: "B",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const removed = await deleteCourseScheduleSlot(world.scheduleDeps, created.value.id);
  assert.equal(removed.ok, true);
  const updated = await replaceAttendanceDaysForClass(
    world.scheduleDeps,
    world.classA.id,
    plan({ dayOfWeek: 1, weekKind: "all", role: "PRIMARY" }),
  );
  assert.equal(updated.ok, true);
  assert.equal((await world.scheduleDeps.schedules.listAttendanceDaysByClass(world.classA.id)).length, 1);
});

testBoth("U — classe inactive → plan non modifiable", async (world) => {
  await world.catalog.updateClass(world.classA.id, { isActive: false });
  const result = await replaceAttendanceDaysForClass(
    world.scheduleDeps,
    world.classA.id,
    plan({ dayOfWeek: 1, weekKind: "all", role: "PRIMARY" }),
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 409);
});

testBoth("V — classe archivée → plan non modifiable", async (world) => {
  await world.catalog.updateClass(world.classA.id, { isArchived: true });
  const result = await replaceAttendanceDaysForClass(
    world.scheduleDeps,
    world.classA.id,
    plan({ dayOfWeek: 1, weekKind: "all", role: "PRIMARY" }),
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 409);
});

testBoth("W — année archivée → plan non modifiable", async (world) => {
  world.years[0]!.status = "archived";
  const result = await replaceAttendanceDaysForClass(
    world.scheduleDeps,
    world.classA.id,
    plan({ dayOfWeek: 1, weekKind: "all", role: "PRIMARY" }),
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 409);
});

testBoth("X — TeacherCourseAssignment inchangé par la présence", async (world) => {
  const course = await courseFor(world, world.classA, world.moteurCtx);
  const assigned = await assignTeacherToCourse(world.courseDeps, {
    annualCourseId: course.id,
    teacherId: (await world.courseDeps.teachers!.listAccounts())[0]!.id,
    role: "PRIMARY",
    createdByAdminId: "admin-1",
  });
  assert.equal(assigned.ok, true);
  const snapshot = JSON.stringify(await world.courseDeps.courses.listAssignments());
  await replaceAttendanceDaysForClass(
    world.scheduleDeps,
    world.classA.id,
    plan({ dayOfWeek: 1, weekKind: "all", role: "PRIMARY" }),
  );
  await createCourseScheduleSlot(world.scheduleDeps, {
    annualCourseId: course.id,
    dayOfWeek: 1,
    periodStart: 1,
    periodEnd: 2,
    weekKind: "all",
  });
  assert.equal(JSON.stringify(await world.courseDeps.courses.listAssignments()), snapshot);
});

testBoth("Y — P5 toujours refusée", async (world) => {
  await replaceAttendanceDaysForClass(
    world.scheduleDeps,
    world.classA.id,
    plan({ dayOfWeek: 1, weekKind: "all", role: "PRIMARY" }),
  );
  const course = await courseFor(world, world.classA, world.moteurCtx);
  const created = await createCourseScheduleSlot(world.scheduleDeps, {
    annualCourseId: course.id,
    dayOfWeek: 1,
    periodStart: LUNCH_PERIOD,
    periodEnd: LUNCH_PERIOD,
    weekKind: "all",
  });
  assert.equal(created.ok, false);
  if (created.ok) return;
  assert.equal(created.code, "LUNCH_PERIOD");
});

testBoth("Z — P4-P6 toujours refusé", async (world) => {
  await replaceAttendanceDaysForClass(
    world.scheduleDeps,
    world.classA.id,
    plan({ dayOfWeek: 1, weekKind: "all", role: "PRIMARY" }),
  );
  const course = await courseFor(world, world.classA, world.moteurCtx);
  const created = await createCourseScheduleSlot(world.scheduleDeps, {
    annualCourseId: course.id,
    dayOfWeek: 1,
    periodStart: 4,
    periodEnd: 6,
    weekKind: "all",
  });
  assert.equal(created.ok, false);
  if (created.ok) return;
  assert.equal(created.code, "CROSSES_LUNCH");
});

test("AA/AB/AC — aperçu A/B : PRIMARY all, ADDITIONAL B, jour vide visible", () => {
  const days: ClassAttendanceDay[] = [
    {
      id: "p",
      classId: "cl",
      dayOfWeek: 1,
      weekKind: "all",
      role: "PRIMARY",
      createdAt: "t",
      updatedAt: "t",
    },
    {
      id: "a",
      classId: "cl",
      dayOfWeek: 4,
      weekKind: "B",
      role: "ADDITIONAL",
      createdAt: "t",
      updatedAt: "t",
    },
  ];
  const slots: CourseScheduleSlot[] = [
    {
      id: "s1",
      annualCourseId: "c1",
      dayOfWeek: 1,
      periodStart: 1,
      periodEnd: 2,
      weekKind: "all",
      validFrom: null,
      validTo: null,
      createdAt: "t",
      updatedAt: "t",
    },
  ];
  assert.deepEqual(
    attendanceDaysForWeek(days, "A").map((day) => day.dayOfWeek),
    [1],
  );
  assert.deepEqual(
    attendanceDaysForWeek(days, "B").map((day) => day.dayOfWeek),
    [1, 4],
  );
  const weekA = buildAttendanceWeekPreview({ days, slots, weekKind: "A" });
  const weekB = buildAttendanceWeekPreview({ days, slots, weekKind: "B" });
  assert.deepEqual(weekA.days.map((day) => day.dayOfWeek), [1]);
  assert.equal(weekA.days.some((day) => day.dayOfWeek === 4), false);
  assert.deepEqual(weekB.days.map((day) => day.dayOfWeek), [1, 4]);
  const thursday = weekB.days.find((day) => day.dayOfWeek === 4);
  assert.equal(thursday?.empty, true);
  assert.equal(thursday?.roleLabel, "jour complémentaire");
  assert.equal(formatSlotDayBadge(slots[0]!, days), "Lundi · principal");
  assert.equal(formatSlotDayBadge({ dayOfWeek: 4, weekKind: "B" }, days), "Jeudi · complémentaire B");
});

testBoth("AD — même code de classe sur deux années, aucune collision classId", async (world) => {
  world.years.push(yearRecord("year-2027", "2027-2028"));
  const classNext = await world.catalog.createClass({
    code: "MMA1A",
    label: "MMA1A",
    schoolYearId: "year-2027",
    schoolYearLabel: "2027-2028",
    professionId: world.classA.professionId!,
    trainingYear: 1,
    parallelCode: "A",
  });
  const first = await replaceAttendanceDaysForClass(
    world.scheduleDeps,
    world.classA.id,
    plan({ dayOfWeek: 1, weekKind: "all", role: "PRIMARY" }),
  );
  const second = await replaceAttendanceDaysForClass(
    world.scheduleDeps,
    classNext.id,
    plan({ dayOfWeek: 3, weekKind: "all", role: "PRIMARY" }),
  );
  assert.equal(first.ok && second.ok, true);
  const daysA = await world.scheduleDeps.schedules.listAttendanceDaysByClass(world.classA.id);
  const daysNext = await world.scheduleDeps.schedules.listAttendanceDaysByClass(classNext.id);
  assert.equal(daysA[0]?.dayOfWeek, 1);
  assert.equal(daysNext[0]?.dayOfWeek, 3);
});

test("AE — attendanceDays bloquent la suppression définitive de classe", () => {
  const schoolClass = {
    id: "cl-1",
    code: "MMA1A",
    label: "MMA1A",
    sortOrder: 1,
    isActive: true,
    schoolYearId: "year-2026",
    schoolYearLabel: "2026-2027",
    professionId: null,
    trainingYear: 1,
    parallelCode: "A",
    isArchived: false,
    archivedAt: null,
  };
  const blocked = catalogClassDeleteBlockers(schoolClass, [schoolClass], {
    classrooms: [],
    courses: [],
    assignments: [],
    notes: [],
    agendaItems: [],
    timetableSlots: [],
    linkedClassroomIds: [],
    studentAccesses: [],
    attendanceDays: [{ classId: "cl-1" }, { classId: "cl-1" }],
  });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.match(blocked.reason, /2 jours de cours configurés/);
});

testBoth("jour non couvert → ATTENDANCE_DAY_MISMATCH", async (world) => {
  await replaceAttendanceDaysForClass(
    world.scheduleDeps,
    world.classA.id,
    plan({ dayOfWeek: 1, weekKind: "all", role: "PRIMARY" }),
  );
  const course = await courseFor(world, world.classA, world.moteurCtx);
  const created = await createCourseScheduleSlot(world.scheduleDeps, {
    annualCourseId: course.id,
    dayOfWeek: 4,
    periodStart: 1,
    periodEnd: 2,
    weekKind: "B",
  });
  assert.equal(created.ok, false);
  if (created.ok) return;
  assert.equal(created.code, ATTENDANCE_DAY_MISMATCH_CODE);
});

testBoth("alternance A/B sur le jour principal all reste possible", async (world) => {
  await replaceAttendanceDaysForClass(
    world.scheduleDeps,
    world.classA.id,
    plan({ dayOfWeek: 1, weekKind: "all", role: "PRIMARY" }),
  );
  const moteur = await courseFor(world, world.classA, world.moteurCtx);
  const transmission = await courseFor(world, world.classA, world.transmissionCtx);
  const weekA = await createCourseScheduleSlot(world.scheduleDeps, {
    annualCourseId: moteur.id,
    dayOfWeek: 1,
    periodStart: 1,
    periodEnd: 2,
    weekKind: "A",
  });
  const weekB = await createCourseScheduleSlot(world.scheduleDeps, {
    annualCourseId: transmission.id,
    dayOfWeek: 1,
    periodStart: 1,
    periodEnd: 2,
    weekKind: "B",
  });
  assert.equal(weekA.ok && weekB.ok, true);
});

test("suggestion visuelle : un seul jour de créneaux → PRIMARY, plusieurs → aucune", () => {
  assert.deepEqual(suggestAttendanceDraftFromSlots([{ dayOfWeek: 1 }, { dayOfWeek: 1 }]), [
    { dayOfWeek: 1, weekKind: "all", role: "PRIMARY" },
  ]);
  assert.equal(suggestAttendanceDraftFromSlots([{ dayOfWeek: 1 }, { dayOfWeek: 4 }]), null);
});

testBoth("update d’un créneau hors couverture → ATTENDANCE_DAY_MISMATCH", async (world) => {
  await replaceAttendanceDaysForClass(
    world.scheduleDeps,
    world.classA.id,
    plan({ dayOfWeek: 1, weekKind: "all", role: "PRIMARY" }),
  );
  const course = await courseFor(world, world.classA, world.moteurCtx);
  const created = await createCourseScheduleSlot(world.scheduleDeps, {
    annualCourseId: course.id,
    dayOfWeek: 1,
    periodStart: 1,
    periodEnd: 2,
    weekKind: "all",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const updated = await updateCourseScheduleSlot(world.scheduleDeps, created.value.id, {
    dayOfWeek: 5,
    periodStart: 1,
    periodEnd: 2,
    weekKind: "A",
  });
  assert.equal(updated.ok, false);
  if (updated.ok) return;
  assert.equal(updated.code, ATTENDANCE_DAY_MISMATCH_CODE);
});

testBoth("A/B/C/D — cours archivé + créneau Jeudi B bloque la suppression du jour", async (world) => {
  const saved = await replaceAttendanceDaysForClass(
    world.scheduleDeps,
    world.classA.id,
    plan(
      { dayOfWeek: 1, weekKind: "all", role: "PRIMARY" },
      { dayOfWeek: 4, weekKind: "B", role: "ADDITIONAL" },
    ),
  );
  assert.equal(saved.ok, true);
  const chassis = await courseFor(world, world.classA, world.chassisCtx);
  const created = await createCourseScheduleSlot(world.scheduleDeps, {
    annualCourseId: chassis.id,
    dayOfWeek: 4,
    periodStart: 1,
    periodEnd: 4,
    weekKind: "B",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const archived = await archiveAnnualCourse(world.courseDeps, chassis.id);
  assert.equal(archived.ok, true);

  const refused = await replaceAttendanceDaysForClass(
    world.scheduleDeps,
    world.classA.id,
    plan({ dayOfWeek: 1, weekKind: "all", role: "PRIMARY" }),
  );
  assert.equal(refused.ok, false);
  if (refused.ok) return;
  assert.equal(refused.code, ATTENDANCE_IN_USE_CODE);
  assert.equal(refused.status, 409);

  const persisted = await world.scheduleDeps.schedules.getSlot(created.value.id);
  assert.equal(persisted?.id, created.value.id);
  assert.equal(persisted?.dayOfWeek, 4);
  assert.equal(persisted?.weekKind, "B");

  const still = await world.scheduleDeps.schedules.listAttendanceDaysByClass(world.classA.id);
  assert.deepEqual(
    still.map((day) => `${day.dayOfWeek}:${day.weekKind}:${day.role}`).sort(),
    ["1:all:PRIMARY", "4:B:ADDITIONAL"],
  );
});

test("aperçu historique — année archivée + cours archivé + Jeudi B", () => {
  const days: ClassAttendanceDay[] = [
    {
      id: "p",
      classId: "cl",
      dayOfWeek: 1,
      weekKind: "all",
      role: "PRIMARY",
      createdAt: "t",
      updatedAt: "t",
    },
    {
      id: "a",
      classId: "cl",
      dayOfWeek: 4,
      weekKind: "B",
      role: "ADDITIONAL",
      createdAt: "t",
      updatedAt: "t",
    },
  ];
  const slots: CourseScheduleSlot[] = [
    {
      id: "s-b",
      annualCourseId: "chassis",
      dayOfWeek: 4,
      periodStart: 1,
      periodEnd: 4,
      weekKind: "B",
      validFrom: null,
      validTo: null,
      createdAt: "t",
      updatedAt: "t",
    },
  ];
  const historical = buildAttendanceWeekPreview({
    days,
    slots,
    weekKind: "B",
    courses: [{ id: "chassis", isArchived: true }],
    yearStatus: "archived",
  });
  const thursday = historical.days.find((day) => day.dayOfWeek === 4);
  assert.equal(thursday?.empty, false);
  assert.equal(thursday?.roleLabel, "jour complémentaire");
  assert.equal(thursday?.blocks.some((block) => block.kind === "course"), true);

  const operational = buildAttendanceWeekPreview({
    days,
    slots,
    weekKind: "B",
    courses: [{ id: "chassis", isArchived: true }],
    yearStatus: "active",
  });
  assert.equal(operational.days.find((day) => day.dayOfWeek === 4)?.empty, true);
});

test("E — legacy sans ClassAttendanceDay : aucun rôle principal/complémentaire inventé", () => {
  assert.equal(formatSlotDayBadge({ dayOfWeek: 1, weekKind: "all" }, []), "Lundi · Toutes");
  assert.equal(formatSlotDayBadge({ dayOfWeek: 1, weekKind: "A" }, []), "Lundi · A");
  assert.equal(formatSlotDayBadge({ dayOfWeek: 1, weekKind: "B" }, []), "Lundi · B");
  assert.equal(formatSlotDayBadge({ dayOfWeek: 4, weekKind: "B" }, []), "Jeudi · B");
  assert.equal(formatSlotDayBadge({ dayOfWeek: 1, weekKind: "all" }, []).includes("principal"), false);
  assert.equal(formatSlotDayBadge({ dayOfWeek: 4, weekKind: "B" }, []).includes("complémentaire"), false);
});

test("F — legacy Lundi A + Lundi B : distinction A/B dans l’aperçu, sans rôle", () => {
  const slots: CourseScheduleSlot[] = [
    {
      id: "moteur",
      annualCourseId: "c-a",
      dayOfWeek: 1,
      periodStart: 1,
      periodEnd: 2,
      weekKind: "A",
      validFrom: null,
      validTo: null,
      createdAt: "t",
      updatedAt: "t",
    },
    {
      id: "trans",
      annualCourseId: "c-b",
      dayOfWeek: 1,
      periodStart: 1,
      periodEnd: 2,
      weekKind: "B",
      validFrom: null,
      validTo: null,
      createdAt: "t",
      updatedAt: "t",
    },
  ];
  const weekA = buildAttendanceWeekPreview({ days: [], slots, weekKind: "A" });
  const weekB = buildAttendanceWeekPreview({ days: [], slots, weekKind: "B" });
  assert.deepEqual(weekA.days.map((day) => day.dayOfWeek), [1]);
  assert.equal(weekA.days[0]?.role, null);
  assert.equal(weekA.days[0]?.roleLabel, null);
  assert.deepEqual(
    weekA.days[0]?.blocks.filter((block) => block.kind === "course").flatMap((block) => block.slots.map((slot) => slot.id)),
    ["moteur"],
  );
  assert.deepEqual(
    weekB.days[0]?.blocks.filter((block) => block.kind === "course").flatMap((block) => block.slots.map((slot) => slot.id)),
    ["trans"],
  );
  assert.equal(weekA.days[0]?.blocks.some((block) => block.slots.some((slot) => slot.id === "trans")), false);
});

test("G — badges principal/complémentaire uniquement après configuration", () => {
  const days: ClassAttendanceDay[] = [
    {
      id: "p",
      classId: "cl",
      dayOfWeek: 1,
      weekKind: "all",
      role: "PRIMARY",
      createdAt: "t",
      updatedAt: "t",
    },
    {
      id: "a",
      classId: "cl",
      dayOfWeek: 4,
      weekKind: "B",
      role: "ADDITIONAL",
      createdAt: "t",
      updatedAt: "t",
    },
  ];
  assert.equal(formatSlotDayBadge({ dayOfWeek: 1, weekKind: "all" }, days), "Lundi · principal");
  assert.equal(formatSlotDayBadge({ dayOfWeek: 1, weekKind: "A" }, days), "Lundi · principal · A");
  assert.equal(formatSlotDayBadge({ dayOfWeek: 1, weekKind: "B" }, days), "Lundi · principal · B");
  assert.equal(formatSlotDayBadge({ dayOfWeek: 4, weekKind: "B" }, days), "Jeudi · complémentaire B");
});

test("H — régression : présence all autorise slot all / A / B", () => {
  const days = [{ dayOfWeek: 1 as const, weekKind: "all" as const }];
  assert.equal(attendanceCoversScheduleSlot(days, { dayOfWeek: 1, weekKind: "all" }), true);
  assert.equal(attendanceCoversScheduleSlot(days, { dayOfWeek: 1, weekKind: "A" }), true);
  assert.equal(attendanceCoversScheduleSlot(days, { dayOfWeek: 1, weekKind: "B" }), true);
});

test("changement d’année — reset complet des brouillons", () => {
  const next = scheduleEditorStateAfterYearChange("year-2027");
  assert.equal(next.selectedYearId, "year-2027");
  assert.equal(next.selectedClassId, "");
  assert.equal(next.editingDays, false);
  assert.equal(next.attendanceDraft.primaryDay, "");
  assert.deepEqual(next.attendanceDraft.additional, []);
  assert.equal(next.slotDraft, null);
  assert.equal(next.error, "");
});
