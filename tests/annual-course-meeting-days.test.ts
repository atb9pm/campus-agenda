import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createAnnualCourse,
  deleteAnnualCourse,
  MEETING_DAY_COURSE_MISSING_REASON,
  MEETING_DAY_NO_PRIMARY_REASON,
  MEETING_DAY_ROLE_REASON,
  MEETING_DAY_SAME_DAY_REASON,
  MEETING_DAY_TOO_MANY_REASON,
  MEETING_DAY_TWO_PRIMARY_REASON,
  MEETING_DAY_WEEKDAY_REASON,
  MEETING_DAY_WEEK_KIND_REASON,
  replaceAnnualCourseMeetingDays,
  validateAnnualCourseMeetingDayPlan,
  type AnnualCourse,
  type AnnualCourseMeetingDayInput,
  type AnnualCourseServiceDeps,
} from "../src/features/annual-courses/index.ts";
import { APP_VERSION } from "../src/lib/app-version.ts";
import {
  CAMPUS_BACKUP_COLUMNS,
  CAMPUS_BACKUP_FOREIGN_KEYS,
  CAMPUS_BACKUP_INSERT_ORDER,
} from "../src/lib/persistence/campus-backup-tables.ts";
import { validateAttendancePlan } from "../src/features/course-schedule/index.ts";
import { computeCourseSessions } from "../src/features/course-sessions/index.ts";
import type { CourseWeekKind, CourseWeekday } from "../src/features/course-schedule/types.ts";
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

function yearRecord(id: string, label: string): SchoolYearRecord {
  return {
    id,
    label,
    status: "active",
    startsOn: "2026-08-17",
    endsOn: "2027-07-02",
    sourceFilename: null,
    importedAt: null,
    activatedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function yearsFrom(records: SchoolYearRecord[]): SchoolYearStore {
  return {
    listSchoolYears: async () => records,
    getSchoolYearById: async (id: string) => records.find((entry) => entry.id === id) ?? null,
  } as SchoolYearStore;
}

function day(
  dayOfWeek: CourseWeekday,
  weekKind: CourseWeekKind,
  role: AnnualCourseMeetingDayInput["role"],
): AnnualCourseMeetingDayInput {
  return { dayOfWeek, weekKind, role };
}

interface World {
  kind: StoreKind;
  courseDeps: AnnualCourseServiceDeps;
  schoolClass: SchoolClassRecord;
  context: PedagogicalContextRecord;
}

async function makeWorld(kind: StoreKind): Promise<World> {
  const years = [yearRecord("year-2026", "2026-2027")];
  resetMemorySchoolCatalogStore();
  resetMemoryAnnualCourseStore();
  resetMemoryPedagogicalPathStore();
  resetMemoryTeacherAccountStore();

  let catalog: SchoolCatalogStore;
  let courses: AnnualCourseServiceDeps["courses"];
  let notes: AnnualCourseServiceDeps["notes"];
  let teachers: AnnualCourseServiceDeps["teachers"];
  let schedules: NonNullable<AnnualCourseServiceDeps["schedules"]>;

  if (kind === "memory") {
    catalog = getMemorySchoolCatalogStore();
    await catalog.ensureSeeded();
    courses = new MemoryAnnualCourseStore();
    notes = getMemoryAnnualCourseNotesStore();
    teachers = getMemoryTeacherAccountStore();
    schedules = new MemoryCourseScheduleStore();
  } else {
    const db = createNodeSqliteDatabase(":memory:");
    await applyMigrations(db);
    catalog = new SqlSchoolCatalogStore(db);
    await catalog.ensureSeeded();
    courses = new SqlAnnualCourseStore(db);
    notes = new SqlAnnualCourseNotesStore(db);
    teachers = new SqlTeacherAccountStore(db);
    schedules = new SqlCourseScheduleStore(db);
  }

  const profession = await catalog.createProfession({
    label: "Mécatronicien automobile",
    durationYears: 4,
  });
  const branches = await catalog.listBranches();
  const moteur = branches.find((entry) => entry.label === "Moteur") ?? branches[0]!;
  await catalog.updateBranch(moteur.id, { teachingType: "TECHNICAL" });
  const context = await catalog.createContext({
    professionId: profession.id,
    trainingYear: 3,
    branchId: moteur.id,
  });
  assert.equal(context.ok, true);
  if (!context.ok) throw new Error("CTX");
  const schoolClass = await catalog.createClass({
    code: "MECAUTO3A",
    label: "MECAUTO3A",
    schoolYearId: "year-2026",
    schoolYearLabel: "2026-2027",
    professionId: profession.id,
    trainingYear: 3,
    parallelCode: "A",
  });

  return {
    kind,
    schoolClass,
    context: context.value,
    courseDeps: {
      courses,
      catalog,
      years: yearsFrom(years),
      teachers,
      notes,
      schedules,
    },
  };
}

async function courseFor(world: World): Promise<AnnualCourse> {
  const created = await createAnnualCourse(world.courseDeps, {
    schoolYearId: schoolYearIdOf(world),
    classId: world.schoolClass.id,
    contextId: world.context.id,
  });
  assert.equal(created.ok, true);
  if (!created.ok) throw new Error(created.reason);
  return created.value;
}

function schoolYearIdOf(world: World): string {
  return world.schoolClass.schoolYearId ?? "year-2026";
}

function testBoth(name: string, run: (world: World) => Promise<void>) {
  test(`Memory — ${name}`, async () => {
    await run(await makeWorld("memory"));
  });
  test(`SQLite — ${name}`, async () => {
    await run(await makeWorld("sqlite"));
  });
}

test("version — meeting days 0034, backup après annual_courses", async () => {
  assert.match(APP_VERSION, /^\d+\.\d+\.\d+$/);
  assert.ok(SQL_MIGRATION_FILES.includes("0034_annual_course_meeting_days.sql"));
  assert.equal(SQL_MIGRATION_FILES.at(-1), "0034_annual_course_meeting_days.sql");
  assert.ok(CAMPUS_BACKUP_INSERT_ORDER.includes("annual_course_meeting_days"));
  assert.ok(
    CAMPUS_BACKUP_INSERT_ORDER.indexOf("annual_courses") <
      CAMPUS_BACKUP_INSERT_ORDER.indexOf("annual_course_meeting_days"),
  );
  assert.equal(CAMPUS_BACKUP_COLUMNS.annual_course_meeting_days?.some((col) => col.name === "annual_course_id"), true);
  assert.ok(
    CAMPUS_BACKUP_FOREIGN_KEYS.some(
      (entry) => entry.table === "annual_course_meeting_days" && entry.parent === "annual_courses",
    ),
  );
  const sql = await readFile(new URL("../migrations/0034_annual_course_meeting_days.sql", import.meta.url), "utf8");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS annual_course_meeting_days/);
  assert.doesNotMatch(sql, /week_kind = 'all'/);
  assert.doesNotMatch(sql, /ON DELETE CASCADE/);
});

test("valide — PRIMARY lundi all", () => {
  const result = validateAnnualCourseMeetingDayPlan([day(1, "all", "PRIMARY")]);
  assert.equal(result.ok, true);
});

test("valide — PRIMARY jeudi B", () => {
  const result = validateAnnualCourseMeetingDayPlan([day(4, "B", "PRIMARY")]);
  assert.equal(result.ok, true);
});

test("valide — PRIMARY mardi A", () => {
  const result = validateAnnualCourseMeetingDayPlan([day(2, "A", "PRIMARY")]);
  assert.equal(result.ok, true);
});

test("valide — PRIMARY lundi all + ADDITIONAL jeudi B", () => {
  const result = validateAnnualCourseMeetingDayPlan([day(1, "all", "PRIMARY"), day(4, "B", "ADDITIONAL")]);
  assert.equal(result.ok, true);
});

test("valide — PRIMARY mardi A + ADDITIONAL vendredi B", () => {
  const result = validateAnnualCourseMeetingDayPlan([day(2, "A", "PRIMARY"), day(5, "B", "ADDITIONAL")]);
  assert.equal(result.ok, true);
});

test("valide — PRIMARY lundi all + ADDITIONAL jeudi all", () => {
  const result = validateAnnualCourseMeetingDayPlan([day(1, "all", "PRIMARY"), day(4, "all", "ADDITIONAL")]);
  assert.equal(result.ok, true);
});

test("valide — plan vide (cours sans meeting days)", () => {
  const result = validateAnnualCourseMeetingDayPlan([]);
  assert.equal(result.ok, true);
});

test("invalide — aucun PRIMARY", () => {
  const result = validateAnnualCourseMeetingDayPlan([day(4, "B", "ADDITIONAL")]);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, MEETING_DAY_NO_PRIMARY_REASON);
});

test("invalide — deux PRIMARY", () => {
  const result = validateAnnualCourseMeetingDayPlan([day(1, "all", "PRIMARY"), day(4, "B", "PRIMARY")]);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, MEETING_DAY_TWO_PRIMARY_REASON);
});

test("invalide — plus de deux jours", () => {
  const result = validateAnnualCourseMeetingDayPlan([
    day(1, "all", "PRIMARY"),
    day(4, "B", "ADDITIONAL"),
    day(5, "all", "ADDITIONAL"),
  ]);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, MEETING_DAY_TOO_MANY_REASON);
});

test("invalide — PRIMARY et ADDITIONAL le même jour", () => {
  const result = validateAnnualCourseMeetingDayPlan([day(1, "all", "PRIMARY"), day(1, "B", "ADDITIONAL")]);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, MEETING_DAY_SAME_DAY_REASON);
});

test("invalide — jour hors 1–5", () => {
  const result = validateAnnualCourseMeetingDayPlan([
    { dayOfWeek: 6 as CourseWeekday, weekKind: "all", role: "PRIMARY" },
  ]);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, MEETING_DAY_WEEKDAY_REASON);
});

test("invalide — weekKind invalide", () => {
  const result = validateAnnualCourseMeetingDayPlan([
    { dayOfWeek: 1, weekKind: "C" as CourseWeekKind, role: "PRIMARY" },
  ]);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, MEETING_DAY_WEEK_KIND_REASON);
});

test("invalide — rôle invalide", () => {
  const result = validateAnnualCourseMeetingDayPlan([
    { dayOfWeek: 1, weekKind: "all", role: "OWNER" as AnnualCourseMeetingDayInput["role"] },
  ]);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, MEETING_DAY_ROLE_REASON);
});

test("ClassAttendanceDay refuse toujours PRIMARY jeudi B — règles distinctes", () => {
  const classPlan = validateAttendancePlan([{ dayOfWeek: 4, weekKind: "B", role: "PRIMARY" }]);
  assert.equal(classPlan.ok, false);
  const coursePlan = validateAnnualCourseMeetingDayPlan([day(4, "B", "PRIMARY")]);
  assert.equal(coursePlan.ok, true);
});

test("CourseSession sans meetingDays fournis reste calculé depuis les slots", () => {
  const sessions = computeCourseSessions({
    schoolYearId: "year-2026",
    courses: [{ id: "ac-1", classId: "cl-1", contextId: "ctx-1" }],
    slots: [],
    weeks: [{ number: 1, monday: "2026-08-17", kind: "A" }],
  });
  assert.equal(sessions.length, 0);
});

testBoth("cours existant sans plan reste valide", async (world) => {
  const course = await courseFor(world);
  const listed = await world.courseDeps.schedules!.listMeetingDaysByAnnualCourse(course.id);
  assert.equal(listed.length, 0);
  const emptied = await replaceAnnualCourseMeetingDays(world.courseDeps, course.id, []);
  assert.equal(emptied.ok, true);
  if (!emptied.ok) return;
  assert.equal(emptied.value.length, 0);
});

testBoth("persiste CP1 lundi all PRIMARY", async (world) => {
  const course = await courseFor(world);
  const saved = await replaceAnnualCourseMeetingDays(world.courseDeps, course.id, [day(1, "all", "PRIMARY")]);
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  assert.equal(saved.value.length, 1);
  assert.equal(saved.value[0]!.dayOfWeek, 1);
  assert.equal(saved.value[0]!.weekKind, "all");
  assert.equal(saved.value[0]!.role, "PRIMARY");
  assert.equal(saved.value[0]!.annualCourseId, course.id);
});

testBoth("persiste CP3 jeudi B PRIMARY", async (world) => {
  const course = await courseFor(world);
  const saved = await replaceAnnualCourseMeetingDays(world.courseDeps, course.id, [day(4, "B", "PRIMARY")]);
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  assert.equal(saved.value[0]!.weekKind, "B");
  assert.equal(saved.value[0]!.role, "PRIMARY");
});

testBoth("persiste Injection lundi all + jeudi B", async (world) => {
  const course = await courseFor(world);
  const saved = await replaceAnnualCourseMeetingDays(world.courseDeps, course.id, [
    day(1, "all", "PRIMARY"),
    day(4, "B", "ADDITIONAL"),
  ]);
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  assert.equal(saved.value.length, 2);
  const byRole = Object.fromEntries(saved.value.map((entry) => [entry.role, entry]));
  assert.equal(byRole.PRIMARY?.dayOfWeek, 1);
  assert.equal(byRole.ADDITIONAL?.dayOfWeek, 4);
  assert.equal(byRole.ADDITIONAL?.weekKind, "B");
});

testBoth("remplace atomiquement le plan d’un cours", async (world) => {
  const course = await courseFor(world);
  await replaceAnnualCourseMeetingDays(world.courseDeps, course.id, [
    day(1, "all", "PRIMARY"),
    day(4, "B", "ADDITIONAL"),
  ]);
  const replaced = await replaceAnnualCourseMeetingDays(world.courseDeps, course.id, [day(2, "A", "PRIMARY")]);
  assert.equal(replaced.ok, true);
  if (!replaced.ok) return;
  assert.equal(replaced.value.length, 1);
  assert.equal(replaced.value[0]!.dayOfWeek, 2);
  assert.equal(replaced.value[0]!.weekKind, "A");
  const all = await world.courseDeps.schedules!.listMeetingDays();
  assert.equal(all.filter((entry) => entry.annualCourseId === course.id).length, 1);
});

testBoth("AnnualCourse inexistant refusé par le service", async (world) => {
  const missing = await replaceAnnualCourseMeetingDays(world.courseDeps, "ac-missing", [
    day(1, "all", "PRIMARY"),
  ]);
  assert.equal(missing.ok, false);
  if (missing.ok) return;
  assert.equal(missing.reason, MEETING_DAY_COURSE_MISSING_REASON);
  assert.equal(missing.status, 404);
});

testBoth("supprimer le cours enlève ses meeting days", async (world) => {
  const course = await courseFor(world);
  const saved = await replaceAnnualCourseMeetingDays(world.courseDeps, course.id, [day(1, "all", "PRIMARY")]);
  assert.equal(saved.ok, true);
  const deleted = await deleteAnnualCourse(world.courseDeps, course.id);
  assert.equal(deleted.ok, true);
  const leftover = await world.courseDeps.schedules!.listMeetingDaysByAnnualCourse(course.id);
  assert.equal(leftover.length, 0);
});

test("SQLite — INSERT sur un cours inexistant viole la FK", async () => {
  const db = createNodeSqliteDatabase(":memory:");
  await applyMigrations(db);
  await db.exec("PRAGMA foreign_keys = ON");
  const schedules = new SqlCourseScheduleStore(db);
  await assert.rejects(
    () =>
      schedules.replaceMeetingDaysForAnnualCourse("ac-ghost", [
        {
          id: "acmd-ghost",
          annualCourseId: "ac-ghost",
          dayOfWeek: 1,
          weekKind: "all",
          role: "PRIMARY",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ]),
    /FOREIGN KEY/i,
  );
});
