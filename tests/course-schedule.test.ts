import assert from "node:assert/strict";
import test from "node:test";

import {
  archiveAnnualCourse,
  assignTeacherToCourse,
  createAnnualCourse,
  deleteAnnualCourse,
  ANNUAL_COURSE_SCHEDULE_DELETE_REASON,
  ANNUAL_COURSE_USED_DELETE_REASON,
  annualCourseDeleteBlockers,
  type AnnualCourse,
  type AnnualCourseServiceDeps,
} from "../src/features/annual-courses/index.ts";
import {
  APP_VERSION,
} from "../src/lib/app-version.ts";
import {
  LUNCH_PERIOD,
  NO_TEACHER_ASSIGNED_LABEL,
  TEACHABLE_PERIODS,
  allowedPeriodEnds,
  buildClassDayBlocks,
  buildClassSchedulePreview,
  buildGlobalDayGrid,
  createCourseScheduleSlot,
  deleteCourseScheduleSlot,
  filterSlotsForScheduleView,
  formatTeachersLine,
  isOperationalAnnualCourse,
  isTeachablePeriod,
  listClassScheduleSlots,
  rangeCrossesLunch,
  teachersForAnnualCourse,
  updateCourseScheduleSlot,
  usedWeekdays,
  weekKindsConflict,
  type CourseScheduleServiceDeps,
  type CourseScheduleSlotInput,
  type CourseWeekKind,
} from "../src/features/course-schedule/index.ts";
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
import type { TeacherAccountRecord } from "../src/features/teacher-accounts/types.ts";

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

function slotInput(
  annualCourseId: string,
  overrides: Partial<CourseScheduleSlotInput> = {},
): CourseScheduleSlotInput {
  return {
    annualCourseId,
    dayOfWeek: 4,
    periodStart: 1,
    periodEnd: 2,
    weekKind: "all",
    ...overrides,
  };
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
  electroCtx: PedagogicalContextRecord;
  chassisCtx: PedagogicalContextRecord;
  transmissionCtx: PedagogicalContextRecord;
  francois: TeacherAccountRecord;
  bernard: TeacherAccountRecord;
}

async function makeWorld(kind: StoreKind, extraYears: SchoolYearRecord[] = []): Promise<World> {
  const years = [yearRecord("year-2026", "2026-2027"), ...extraYears];
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
  const electro = branches.find((entry) => entry.label === "Électricité") ?? branches[1]!;
  const chassis = branches.find((entry) => entry.label === "Châssis") ?? branches[2]!;
  const transmission = branches.find((entry) => entry.label === "Transmission") ?? branches[3]!;
  await catalog.updateBranch(moteur.id, { teachingType: "TECHNICAL" });
  await catalog.updateBranch(electro.id, { teachingType: "TECHNICAL" });
  await catalog.updateBranch(chassis.id, { teachingType: "TECHNICAL" });
  await catalog.updateBranch(transmission.id, { teachingType: "TECHNICAL" });

  const moteurCtx = await catalog.createContext({
    professionId: profession.id,
    trainingYear: 1,
    branchId: moteur.id,
  });
  const electroCtx = await catalog.createContext({
    professionId: profession.id,
    trainingYear: 1,
    branchId: electro.id,
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
  assert.equal(moteurCtx.ok && electroCtx.ok && chassisCtx.ok && transmissionCtx.ok, true);
  if (!moteurCtx.ok || !electroCtx.ok || !chassisCtx.ok || !transmissionCtx.ok) {
    throw new Error("CTX");
  }

  const classA = await catalog.createClass({
    code: "MECMA1A",
    label: "MECMA1A",
    schoolYearId: "year-2026",
    schoolYearLabel: "2026-2027",
    professionId: profession.id,
    trainingYear: 1,
    parallelCode: "A",
  });
  const classB = await catalog.createClass({
    code: "MECMA1B",
    label: "MECMA1B",
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
  const bernard = await teachersStore.createAccount({
    displayName: "Bernard",
    initials: "BeB",
    teachingType: "TECHNICAL",
  });
  assert.equal(francois.ok && bernard.ok, true);
  if (!francois.ok || !bernard.ok) throw new Error("teachers");

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
    electroCtx: electroCtx.value,
    chassisCtx: chassisCtx.value,
    transmissionCtx: transmissionCtx.value,
    francois: francois.account,
    bernard: bernard.account,
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

test("version 2.25.0 — créneaux et horaire généré", () => {
  assert.equal(APP_VERSION, "2.25.0");
  assert.equal(SQL_MIGRATION_FILES.at(-1), "0022_course_schedule_slots.sql");
  assert.equal(isTeachablePeriod(LUNCH_PERIOD), false);
  assert.deepEqual([...TEACHABLE_PERIODS], [1, 2, 3, 4, 6, 7, 8, 9, 10]);
  assert.equal(rangeCrossesLunch(4, 6), true);
  assert.equal(rangeCrossesLunch(6, 10), false);
  assert.deepEqual(allowedPeriodEnds(4), [4]);
  assert.deepEqual(allowedPeriodEnds(6), [6, 7, 8, 9, 10]);
  assert.equal(weekKindsConflict("all", "A"), true);
  assert.equal(weekKindsConflict("A", "B"), false);
  assert.equal(weekKindsConflict("A", "A"), true);
});

testBoth("A — création jeudi P1-P2 / all", async (world) => {
  const course = await courseFor(world, world.classA, world.moteurCtx);
  const created = await createCourseScheduleSlot(world.scheduleDeps, slotInput(course.id));
  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.equal(created.value.dayOfWeek, 4);
  assert.equal(created.value.periodStart, 1);
  assert.equal(created.value.periodEnd, 2);
  assert.equal(created.value.weekKind, "all");
  const listed = await world.scheduleDeps.schedules.listSlotsByAnnualCourse(course.id);
  assert.equal(listed.length, 1);
});

testBoth("B — P5 rejetée", async (world) => {
  const course = await courseFor(world, world.classA, world.moteurCtx);
  const created = await createCourseScheduleSlot(world.scheduleDeps, slotInput(course.id, {
    periodStart: 5,
    periodEnd: 5,
  }));
  assert.equal(created.ok, false);
  if (created.ok) return;
  assert.equal(created.code, "LUNCH_PERIOD");
});

testBoth("C — P4-P6 traverse la pause", async (world) => {
  const course = await courseFor(world, world.classA, world.moteurCtx);
  const created = await createCourseScheduleSlot(world.scheduleDeps, slotInput(course.id, {
    periodStart: 4,
    periodEnd: 6,
  }));
  assert.equal(created.ok, false);
  if (created.ok) return;
  assert.equal(created.code, "CROSSES_LUNCH");
});

testBoth("D — P6-P10 autorisé", async (world) => {
  const course = await courseFor(world, world.classA, world.moteurCtx);
  const created = await createCourseScheduleSlot(world.scheduleDeps, slotInput(course.id, {
    periodStart: 6,
    periodEnd: 10,
  }));
  assert.equal(created.ok, true);
});

testBoth("E — deux créneaux identiques all → conflit", async (world) => {
  const course = await courseFor(world, world.classA, world.moteurCtx);
  const first = await createCourseScheduleSlot(world.scheduleDeps, slotInput(course.id));
  assert.equal(first.ok, true);
  const second = await createCourseScheduleSlot(world.scheduleDeps, slotInput(course.id));
  assert.equal(second.ok, false);
  if (second.ok) return;
  assert.equal(second.code, "OVERLAP");
});

testBoth("F — A + B sur la même période autorisé", async (world) => {
  const chassis = await courseFor(world, world.classA, world.chassisCtx);
  const transmission = await courseFor(world, world.classA, world.transmissionCtx);
  const a = await createCourseScheduleSlot(world.scheduleDeps, slotInput(chassis.id, {
    periodStart: 6,
    periodEnd: 7,
    weekKind: "A",
  }));
  const b = await createCourseScheduleSlot(world.scheduleDeps, slotInput(transmission.id, {
    periodStart: 6,
    periodEnd: 7,
    weekKind: "B",
  }));
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
});

testBoth("G — all + A → conflit", async (world) => {
  const moteur = await courseFor(world, world.classA, world.moteurCtx);
  const electro = await courseFor(world, world.classA, world.electroCtx);
  const all = await createCourseScheduleSlot(world.scheduleDeps, slotInput(moteur.id));
  assert.equal(all.ok, true);
  const weekA = await createCourseScheduleSlot(world.scheduleDeps, slotInput(electro.id, { weekKind: "A" }));
  assert.equal(weekA.ok, false);
  if (weekA.ok) return;
  assert.equal(weekA.code, "OVERLAP");
});

testBoth("H — deux cours différents P1-P2 / A → conflit même classe", async (world) => {
  const moteur = await courseFor(world, world.classA, world.moteurCtx);
  const electro = await courseFor(world, world.classA, world.electroCtx);
  const first = await createCourseScheduleSlot(world.scheduleDeps, slotInput(moteur.id, { weekKind: "A" }));
  const second = await createCourseScheduleSlot(world.scheduleDeps, slotInput(electro.id, { weekKind: "A" }));
  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
});

testBoth("I — même période pour deux classes différentes → autorisé", async (world) => {
  const courseA = await courseFor(world, world.classA, world.moteurCtx);
  const courseB = await courseFor(world, world.classB, world.moteurCtx);
  const first = await createCourseScheduleSlot(world.scheduleDeps, slotInput(courseA.id));
  const second = await createCourseScheduleSlot(world.scheduleDeps, slotInput(courseB.id));
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
});

testBoth("J — même AnnualCourse deux créneaux différents → autorisé", async (world) => {
  const course = await courseFor(world, world.classA, world.moteurCtx);
  const morning = await createCourseScheduleSlot(world.scheduleDeps, slotInput(course.id));
  const afternoon = await createCourseScheduleSlot(world.scheduleDeps, slotInput(course.id, {
    periodStart: 7,
    periodEnd: 8,
  }));
  assert.equal(morning.ok, true);
  assert.equal(afternoon.ok, true);
  const listed = await listClassScheduleSlots(world.scheduleDeps, world.classA.id, "year-2026");
  assert.equal(listed.length, 2);
});

testBoth("K — sans attribution, horaire possible et libellé enseignant", async (world) => {
  const course = await courseFor(world, world.classA, world.moteurCtx);
  const created = await createCourseScheduleSlot(world.scheduleDeps, slotInput(course.id));
  assert.equal(created.ok, true);
  const teachers = teachersForAnnualCourse([], [world.francois], course.id);
  assert.equal(teachers.length, 0);
  assert.equal(formatTeachersLine(teachers), NO_TEACHER_ASSIGNED_LABEL);
});

testBoth("L/M/N — mutations horaire sans toucher TeacherCourseAssignment", async (world) => {
  const course = await courseFor(world, world.classA, world.moteurCtx);
  const assigned = await assignTeacherToCourse(world.courseDeps, {
    annualCourseId: course.id,
    teacherId: world.francois.id,
    role: "PRIMARY",
    createdByAdminId: "admin-1",
  });
  assert.equal(assigned.ok, true);
  const before = await world.courseDeps.courses.listAssignments();
  assert.equal(before.length, 1);
  const snapshot = JSON.stringify(before);

  const created = await createCourseScheduleSlot(world.scheduleDeps, slotInput(course.id));
  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.equal(JSON.stringify(await world.courseDeps.courses.listAssignments()), snapshot);

  const updated = await updateCourseScheduleSlot(world.scheduleDeps, created.value.id, {
    dayOfWeek: 4,
    periodStart: 3,
    periodEnd: 4,
    weekKind: "all",
  });
  assert.equal(updated.ok, true);
  assert.equal(JSON.stringify(await world.courseDeps.courses.listAssignments()), snapshot);

  const removed = await deleteCourseScheduleSlot(world.scheduleDeps, created.value.id);
  assert.equal(removed.ok, true);
  assert.equal(JSON.stringify(await world.courseDeps.courses.listAssignments()), snapshot);
});

testBoth("O — classe inactive → modification refusée", async (world) => {
  const course = await courseFor(world, world.classA, world.moteurCtx);
  await world.catalog.updateClass(world.classA.id, { isActive: false });
  const created = await createCourseScheduleSlot(world.scheduleDeps, slotInput(course.id));
  assert.equal(created.ok, false);
  if (created.ok) return;
  assert.equal(created.status, 409);
});

testBoth("P — classe archivée → modification refusée", async (world) => {
  const course = await courseFor(world, world.classA, world.moteurCtx);
  await world.catalog.updateClass(world.classA.id, { isArchived: true });
  const created = await createCourseScheduleSlot(world.scheduleDeps, slotInput(course.id));
  assert.equal(created.ok, false);
  if (created.ok) return;
  assert.equal(created.status, 409);
});

testBoth("Q — année archivée → modification refusée", async (world) => {
  const course = await courseFor(world, world.classA, world.moteurCtx);
  world.years[0]!.status = "archived";
  const created = await createCourseScheduleSlot(world.scheduleDeps, slotInput(course.id));
  assert.equal(created.ok, false);
  if (created.ok) return;
  assert.equal(created.status, 409);
});

testBoth("cours annuel archivé → aucun nouveau créneau", async (world) => {
  const course = await courseFor(world, world.classA, world.moteurCtx);
  const archived = await archiveAnnualCourse(world.courseDeps, course.id);
  assert.equal(archived.ok, true);
  const created = await createCourseScheduleSlot(world.scheduleDeps, slotInput(course.id));
  assert.equal(created.ok, false);
});

test("R — vue classe uniquement jeudi", () => {
  const slots = [
    {
      id: "s1",
      annualCourseId: "c1",
      dayOfWeek: 4 as const,
      periodStart: 1,
      periodEnd: 2,
      weekKind: "all" as CourseWeekKind,
      validFrom: null,
      validTo: null,
      createdAt: "t",
      updatedAt: "t",
    },
  ];
  assert.deepEqual(usedWeekdays(slots), [4]);
  const preview = buildClassSchedulePreview({
    schoolClass: {
      id: "cl-a",
      code: "MECMA1A",
      label: "MECMA1A",
      sortOrder: 1,
      isActive: true,
      schoolYearId: "year-2026",
      schoolYearLabel: "2026-2027",
      professionId: null,
      trainingYear: 1,
      parallelCode: "A",
      isArchived: false,
      archivedAt: null,
    },
    slots,
  });
  assert.deepEqual(preview.days.map((day) => day.dayOfWeek), [4]);
  assert.equal(preview.days[0]?.dayLabel, "Jeudi");
});

test("S — vue classe jeudi + vendredi", () => {
  const slots = [
    {
      id: "s1",
      annualCourseId: "c1",
      dayOfWeek: 4 as const,
      periodStart: 1,
      periodEnd: 2,
      weekKind: "all" as CourseWeekKind,
      validFrom: null,
      validTo: null,
      createdAt: "t",
      updatedAt: "t",
    },
    {
      id: "s2",
      annualCourseId: "c1",
      dayOfWeek: 5 as const,
      periodStart: 6,
      periodEnd: 7,
      weekKind: "all" as CourseWeekKind,
      validFrom: null,
      validTo: null,
      createdAt: "t",
      updatedAt: "t",
    },
  ];
  assert.deepEqual(usedWeekdays(slots), [4, 5]);
});

test("T — vue globale P5 = pause de midi", () => {
  const grid = buildGlobalDayGrid({
    dayOfWeek: 4,
    weekKind: "all",
    slots: [],
    courses: [],
    classes: [
      {
        id: "cl-a",
        code: "MECMA1A",
        label: "MECMA1A",
        sortOrder: 1,
        isActive: true,
        schoolYearId: "year-2026",
        schoolYearLabel: "2026-2027",
        professionId: null,
        trainingYear: 1,
        parallelCode: "A",
        isArchived: false,
        archivedAt: null,
      },
    ],
    contexts: [],
    branches: [],
  });
  const lunch = grid.rows.find((row) => row.period === 5);
  assert.equal(lunch?.kind, "lunch");
  assert.equal(lunch?.label, "🍴 Pause de midi");
  const thursday = buildClassDayBlocks(
    [
      {
        id: "s1",
        annualCourseId: "c1",
        dayOfWeek: 4,
        periodStart: 1,
        periodEnd: 2,
        weekKind: "all",
        validFrom: null,
        validTo: null,
        createdAt: "t",
        updatedAt: "t",
      },
    ],
    4,
  );
  assert.ok(thursday.some((block) => block.kind === "lunch" && block.periodStart === 5));
});

testBoth("U — persistance après rechargement SQLite / mémoire", async (world) => {
  const course = await courseFor(world, world.classA, world.moteurCtx);
  const created = await createCourseScheduleSlot(world.scheduleDeps, slotInput(course.id, {
    periodStart: 8,
    periodEnd: 10,
  }));
  assert.equal(created.ok, true);
  if (!created.ok) return;
  if (world.kind === "sqlite" && world.db) {
    const reloaded = new SqlCourseScheduleStore(world.db);
    const slot = await reloaded.getSlot(created.value.id);
    assert.equal(slot?.periodStart, 8);
    assert.equal(slot?.periodEnd, 10);
    assert.equal(slot?.annualCourseId, course.id);
  } else {
    const slot = await world.scheduleDeps.schedules.getSlot(created.value.id);
    assert.equal(slot?.periodStart, 8);
  }
});

testBoth("V — même classCode sur deux années, aucune collision", async (world) => {
  const year2 = yearRecord("year-2027", "2027-2028");
  world.years.push(year2);
  const professionId = world.classA.professionId!;
  const classNext = await world.catalog.createClass({
    code: "MECMA1A",
    label: "MECMA1A",
    schoolYearId: "year-2027",
    schoolYearLabel: "2027-2028",
    professionId,
    trainingYear: 1,
    parallelCode: "A",
  });
  const courseA = await courseFor(world, world.classA, world.moteurCtx);
  const courseNext = await createAnnualCourse(world.courseDeps, {
    schoolYearId: "year-2027",
    classId: classNext.id,
    contextId: world.moteurCtx.id,
  });
  assert.equal(courseNext.ok, true);
  if (!courseNext.ok) return;
  const first = await createCourseScheduleSlot(world.scheduleDeps, slotInput(courseA.id));
  const second = await createCourseScheduleSlot(world.scheduleDeps, slotInput(courseNext.value.id));
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
});

test("SQLite — CHECK P5 et P4-P6 au niveau persistence", async () => {
  const world = await makeWorld("sqlite");
  assert.ok(world.db);
  const course = await courseFor(world, world.classA, world.moteurCtx);
  await assert.rejects(
    () =>
      world.db!
        .prepare(
          `INSERT INTO course_schedule_slots (
            id, annual_course_id, day_of_week, period_start, period_end, week_kind, created_at, updated_at
          ) VALUES (?, ?, 4, 5, 5, 'all', datetime('now'), datetime('now'))`,
        )
        .bind("css-p5", course.id)
        .run(),
    /CHECK|constraint/i,
  );
  await assert.rejects(
    () =>
      world.db!
        .prepare(
          `INSERT INTO course_schedule_slots (
            id, annual_course_id, day_of_week, period_start, period_end, week_kind, created_at, updated_at
          ) VALUES (?, ?, 4, 4, 6, 'all', datetime('now'), datetime('now'))`,
        )
        .bind("css-lunch", course.id)
        .run(),
    /CHECK|constraint/i,
  );
});

test("titulaires et coenseignants affichés, jamais écrits par l’horaire", async () => {
  const world = await makeWorld("memory");
  const course = await courseFor(world, world.classA, world.moteurCtx);
  const primary = await assignTeacherToCourse(world.courseDeps, {
    annualCourseId: course.id,
    teacherId: world.francois.id,
    role: "PRIMARY",
    createdByAdminId: "admin-1",
  });
  const co = await assignTeacherToCourse(world.courseDeps, {
    annualCourseId: course.id,
    teacherId: world.bernard.id,
    role: "CO_TEACHER",
    createdByAdminId: "admin-1",
  });
  assert.equal(primary.ok && co.ok, true);
  const line = formatTeachersLine(
    teachersForAnnualCourse(
      await world.courseDeps.courses.listAssignments(),
      [world.francois, world.bernard],
      course.id,
    ),
  );
  assert.match(line, /François — titulaire/i);
  assert.match(line, /Bernard — coenseignant/i);
});

test("blocker — créneau prioritaire sur attributions/notes", () => {
  assert.equal(isOperationalAnnualCourse({ isArchived: false }), true);
  assert.equal(isOperationalAnnualCourse({ isArchived: true }), false);
  assert.equal(
    annualCourseDeleteBlockers({ assignmentCount: 0, noteCount: 0, scheduleSlotCount: 1 }),
    ANNUAL_COURSE_SCHEDULE_DELETE_REASON,
  );
  assert.equal(
    annualCourseDeleteBlockers({ assignmentCount: 1, noteCount: 0, scheduleSlotCount: 0 }),
    ANNUAL_COURSE_USED_DELETE_REASON,
  );
});

testBoth("A — AnnualCourse + créneau → suppression refusée 409 USED", async (world) => {
  const course = await courseFor(world, world.classA, world.moteurCtx);
  const created = await createCourseScheduleSlot(world.scheduleDeps, slotInput(course.id));
  assert.equal(created.ok, true);
  const deleted = await deleteAnnualCourse(world.courseDeps, course.id);
  assert.equal(deleted.ok, false);
  if (deleted.ok) return;
  assert.equal(deleted.status, 409);
  assert.equal(deleted.code, "USED");
  assert.equal(deleted.reason, ANNUAL_COURSE_SCHEDULE_DELETE_REASON);
  assert.equal(await world.courseDeps.courses.getCourse(course.id) !== null, true);
});

testBoth("B — créneau supprimé → AnnualCourse supprimable", async (world) => {
  const course = await courseFor(world, world.classA, world.moteurCtx);
  const created = await createCourseScheduleSlot(world.scheduleDeps, slotInput(course.id));
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const removed = await deleteCourseScheduleSlot(world.scheduleDeps, created.value.id);
  assert.equal(removed.ok, true);
  const deleted = await deleteAnnualCourse(world.courseDeps, course.id);
  assert.equal(deleted.ok, true);
  assert.equal(await world.courseDeps.courses.getCourse(course.id), null);
});

testBoth("attributions continuent de bloquer la suppression", async (world) => {
  const course = await courseFor(world, world.classA, world.moteurCtx);
  const assigned = await assignTeacherToCourse(world.courseDeps, {
    annualCourseId: course.id,
    teacherId: world.francois.id,
    role: "PRIMARY",
    createdByAdminId: "admin-1",
  });
  assert.equal(assigned.ok, true);
  const deleted = await deleteAnnualCourse(world.courseDeps, course.id);
  assert.equal(deleted.ok, false);
  if (deleted.ok) return;
  assert.equal(deleted.code, "USED");
  assert.equal(deleted.reason, ANNUAL_COURSE_USED_DELETE_REASON);
});

testBoth("C — cours archivé n’entre plus en conflit", async (world) => {
  const archivedCourse = await courseFor(world, world.classA, world.moteurCtx);
  const first = await createCourseScheduleSlot(world.scheduleDeps, slotInput(archivedCourse.id));
  assert.equal(first.ok, true);
  const archived = await archiveAnnualCourse(world.courseDeps, archivedCourse.id);
  assert.equal(archived.ok, true);
  const activeCourse = await courseFor(world, world.classA, world.electroCtx);
  const second = await createCourseScheduleSlot(world.scheduleDeps, slotInput(activeCourse.id));
  assert.equal(second.ok, true);
});

testBoth("D/E — aperçu et vue globale année active ignorent le cours archivé", async (world) => {
  const course = await courseFor(world, world.classA, world.moteurCtx);
  const created = await createCourseScheduleSlot(world.scheduleDeps, slotInput(course.id));
  assert.equal(created.ok, true);
  await archiveAnnualCourse(world.courseDeps, course.id);
  const courses = await world.courseDeps.courses.listCourses();
  const slots = await world.scheduleDeps.schedules.listSlots();
  const preview = buildClassSchedulePreview({
    schoolClass: world.classA,
    slots,
    courses,
    yearStatus: "active",
  });
  assert.equal(preview.days.length, 0);
  const global = buildGlobalDayGrid({
    dayOfWeek: 4,
    weekKind: "all",
    slots,
    courses,
    classes: [world.classA],
    contexts: [world.moteurCtx],
    branches: await world.catalog.listBranches(),
    yearStatus: "active",
  });
  const occupied = global.rows.filter((row) => row.kind === "course" && row.cells.some((cell) => cell.entries.length > 0));
  assert.equal(occupied.length, 0);

  const historical = buildClassSchedulePreview({
    schoolClass: world.classA,
    slots,
    courses,
    yearStatus: "archived",
  });
  assert.equal(historical.days.length, 1);
});

testBoth("F — créneau d’un cours archivé reste en persistence", async (world) => {
  const course = await courseFor(world, world.classA, world.moteurCtx);
  const created = await createCourseScheduleSlot(world.scheduleDeps, slotInput(course.id));
  assert.equal(created.ok, true);
  if (!created.ok) return;
  await archiveAnnualCourse(world.courseDeps, course.id);
  const persisted = await world.scheduleDeps.schedules.getSlot(created.value.id);
  assert.equal(persisted?.id, created.value.id);
  assert.equal(persisted?.annualCourseId, course.id);
  const stillListed = await world.scheduleDeps.schedules.listSlotsByAnnualCourse(course.id);
  assert.equal(stillListed.length, 1);
});

testBoth("G — année archivée : aucune mutation de créneau", async (world) => {
  const course = await courseFor(world, world.classA, world.moteurCtx);
  const created = await createCourseScheduleSlot(world.scheduleDeps, slotInput(course.id));
  assert.equal(created.ok, true);
  if (!created.ok) return;
  world.years[0]!.status = "archived";
  const update = await updateCourseScheduleSlot(world.scheduleDeps, created.value.id, {
    dayOfWeek: 4,
    periodStart: 3,
    periodEnd: 4,
    weekKind: "all",
  });
  assert.equal(update.ok, false);
  const removed = await deleteCourseScheduleSlot(world.scheduleDeps, created.value.id);
  assert.equal(removed.ok, false);
  const another = await createCourseScheduleSlot(world.scheduleDeps, slotInput(course.id, {
    periodStart: 6,
    periodEnd: 7,
  }));
  assert.equal(another.ok, false);
  assert.equal((await world.scheduleDeps.schedules.getSlot(created.value.id))?.periodStart, 1);
});

testBoth("H — régression A/B, P5, P4-P6, multi-classes", async (world) => {
  const moteur = await courseFor(world, world.classA, world.moteurCtx);
  const chassis = await courseFor(world, world.classA, world.chassisCtx);
  const transmission = await courseFor(world, world.classA, world.transmissionCtx);
  const other = await courseFor(world, world.classB, world.moteurCtx);
  assert.equal((await createCourseScheduleSlot(world.scheduleDeps, slotInput(moteur.id, {
    periodStart: 5,
    periodEnd: 5,
  }))).ok, false);
  assert.equal((await createCourseScheduleSlot(world.scheduleDeps, slotInput(moteur.id, {
    periodStart: 4,
    periodEnd: 6,
  }))).ok, false);
  assert.equal((await createCourseScheduleSlot(world.scheduleDeps, slotInput(chassis.id, {
    periodStart: 6,
    periodEnd: 7,
    weekKind: "A",
  }))).ok, true);
  assert.equal((await createCourseScheduleSlot(world.scheduleDeps, slotInput(transmission.id, {
    periodStart: 6,
    periodEnd: 7,
    weekKind: "B",
  }))).ok, true);
  assert.equal((await createCourseScheduleSlot(world.scheduleDeps, slotInput(other.id, {
    periodStart: 6,
    periodEnd: 7,
    weekKind: "A",
  }))).ok, true);
});

test("filterSlotsForScheduleView — année active vs archivée", () => {
  const slots = [
    {
      id: "s1",
      annualCourseId: "live",
      dayOfWeek: 4 as const,
      periodStart: 1,
      periodEnd: 2,
      weekKind: "all" as const,
      validFrom: null,
      validTo: null,
      createdAt: "t",
      updatedAt: "t",
    },
    {
      id: "s2",
      annualCourseId: "old",
      dayOfWeek: 4 as const,
      periodStart: 3,
      periodEnd: 4,
      weekKind: "all" as const,
      validFrom: null,
      validTo: null,
      createdAt: "t",
      updatedAt: "t",
    },
  ];
  const courses = [
    { id: "live", isArchived: false },
    { id: "old", isArchived: true },
  ];
  assert.deepEqual(
    filterSlotsForScheduleView({ slots, courses, yearStatus: "active" }).map((entry) => entry.id),
    ["s1"],
  );
  assert.deepEqual(
    filterSlotsForScheduleView({ slots, courses, yearStatus: "draft" }).map((entry) => entry.id),
    ["s1"],
  );
  assert.deepEqual(
    filterSlotsForScheduleView({ slots, courses, yearStatus: "archived" }).map((entry) => entry.id),
    ["s1", "s2"],
  );
});
