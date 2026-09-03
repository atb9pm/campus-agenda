import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ANNUAL_COURSE_AGENDA_DELETE_REASON,
  assignTeacherToCourse,
  assignTemporaryReplacement,
  createAnnualCourse,
  deleteAnnualCourse,
  type AnnualCourseServiceDeps,
} from "../src/features/annual-courses/index.ts";
import {
  assignmentInstantForSessionDate,
  ensureRuntimeClassroomForSchoolClass,
  ensureRuntimeSubjectForAnnualCourse,
  evaluateTeacherAgendaPublishAccess,
  findUniqueAdoptableSubject,
  inspectClassroomAgendaBinding,
  reconcileStructuredClassrooms,
  resolveStructuredAgendaTarget,
  resolveStructuredSchoolClassForClassroom,
  runtimeClassroomIdForSchoolClass,
  runtimeSubjectIdForAnnualCourse,
  STRUCTURED_SUBJECT_UNLINKED_REASON,
} from "../src/features/agenda-bridge/index.ts";
import { isoDateForSchoolWeekDay } from "../src/features/school-days/index.ts";
import {
  STRUCTURED_AGENDA_PATCH_FORBIDDEN_REASON,
  structuredAgendaPatchGuard,
} from "../src/features/agenda/index.ts";
import {
  STRUCTURED_PUBLISH_ALREADY_REASON,
  STRUCTURED_PUBLISH_COURSE_ARCHIVED_REASON,
  STRUCTURED_PUBLISH_FORBIDDEN_REASON,
  STRUCTURED_PUBLISH_ITEM_MOVED_REASON,
  STRUCTURED_PUBLISH_SESSION_GONE_REASON,
  STRUCTURED_PUBLISH_YEAR_ARCHIVED_REASON,
  STRUCTURED_PUBLISH_YEAR_DRAFT_REASON,
  publishReferenceItemToAgenda,
  recoverStructuredPublishUniqueConflict,
  structuredPublishIdsFromBody,
  type StructuredPublishDeps,
} from "../src/features/course-publications/index.ts";
import { listComputedCourseSessions } from "../src/features/course-sessions/index.ts";
import { addItem, addSession, createEmptyPath, moveItem, updateItem } from "../src/features/pedagogical-path/index.ts";
import { APP_VERSION } from "../src/lib/app-version.ts";
import { MemoryAgendaStore } from "../src/lib/persistence/memory-store.ts";
import {
  MemoryAnnualCourseStore,
  resetMemoryAnnualCourseStore,
} from "../src/lib/persistence/memory-annual-course-store.ts";
import { MemoryCourseScheduleStore } from "../src/lib/persistence/memory-course-schedule-store.ts";
import {
  getMemoryAnnualCourseNotesStore,
  MemoryPedagogicalPathStore,
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
import { resetMemoryLegacySchool } from "../src/lib/persistence/memory-legacy-school.ts";
import { MemoryRuntimeAgendaAdapterStore } from "../src/lib/persistence/memory-runtime-adapter-store.ts";
import { createNodeSqliteDatabase } from "../src/lib/persistence/sql/adapters.ts";
import { applyMigrations, SQL_MIGRATION_FILES } from "../src/lib/persistence/sql/migrate.ts";
import { SqlAgendaStore } from "../src/lib/persistence/sql/sql-agenda-store.ts";
import { SqlAnnualCourseStore } from "../src/lib/persistence/sql/sql-annual-course-store.ts";
import { SqlCourseScheduleStore } from "../src/lib/persistence/sql/sql-course-schedule-store.ts";
import { SqlAnnualCourseNotesStore, SqlPedagogicalPathStore } from "../src/lib/persistence/sql/sql-pedagogical-path-store.ts";
import { SqlRuntimeAgendaAdapterStore } from "../src/lib/persistence/sql/sql-runtime-adapter-store.ts";
import { SqlSchoolCatalogStore } from "../src/lib/persistence/sql/sql-school-catalog-store.ts";
import { SqlTeacherAccountStore } from "../src/lib/persistence/sql/sql-teacher-account-store.ts";
import {
  canonicalizeCampusDump,
  dumpCampusTables,
  restoreCampusTables,
  validateCampusTables,
} from "../src/lib/persistence/sql/sql-campus-backup.ts";
import { exportCampusSnapshot, restoreCampusSnapshot } from "../src/lib/persistence/campus-backup.ts";
import { getMemoryAgendaStore, resetMemoryAgendaStore } from "../src/lib/persistence/memory-store.ts";
import { MemorySchoolYearStore, resetMemorySchoolYearStore } from "../src/lib/persistence/memory-school-year-store.ts";
import { MemoryMembershipStore, resetMemoryMembershipStore } from "../src/lib/persistence/memory-membership-store.ts";
import { getMemoryTeacherSetupStore, resetMemoryTeacherSetupStore } from "../src/lib/persistence/memory-teacher-setup-store.ts";
import { getMemoryTeacherNotesStore, resetMemoryTeacherNotesStore } from "../src/lib/persistence/memory-teacher-notes-store.ts";
import { getMemoryTemplateStore, resetMemoryTemplateStore } from "../src/lib/persistence/memory-template-store.ts";
import { getMemoryTimetableStore, resetMemoryTimetableStore } from "../src/lib/persistence/memory-timetable-store.ts";
import { getMemoryAnnualCourseStore } from "../src/lib/persistence/memory-annual-course-store.ts";
import { getMemoryCourseScheduleStore, resetMemoryCourseScheduleStore } from "../src/lib/persistence/memory-course-schedule-store.ts";
import { getMemoryPedagogicalPathStore } from "../src/lib/persistence/memory-pedagogical-path-store.ts";
import { seedDemoDatabase } from "../src/lib/persistence/sql/seed.ts";
import { SqlSchoolYearStore } from "../src/lib/persistence/sql/sql-school-year-store.ts";
import { SqlMembershipStore } from "../src/lib/persistence/sql/sql-membership-store.ts";
import { SqlTeacherSetupStore } from "../src/lib/persistence/sql/sql-teacher-setup-store.ts";
import { SqlTeacherNotesStore } from "../src/lib/persistence/sql/sql-teacher-notes-store.ts";
import { SqlTemplateStore } from "../src/lib/persistence/sql/sql-template-store.ts";
import { SqlTimetableStore } from "../src/lib/persistence/sql/sql-timetable-store.ts";
import type { CampusBackupDeps } from "../src/lib/persistence/campus-backup.ts";
import { CAMPUS_BACKUP_INSERT_ORDER } from "../src/lib/persistence/campus-backup-tables.ts";
import type { CampusTableDump } from "../src/lib/persistence/sql/sql-campus-backup.ts";
import type { SchoolYearStore } from "../src/lib/persistence/school-year-types.ts";
import type { SchoolYearRecord } from "../src/features/school-year/types.ts";
import type { SchoolDayException } from "../src/features/school-days/types.ts";
import type { AgendaStore } from "../src/lib/persistence/types.ts";
import type { RuntimeAgendaAdapterStore } from "../src/lib/persistence/runtime-agenda-types.ts";

process.env.CAMPUS_ALLOW_DEMO_PASSWORD ??= "1";

function mondayWeeks(startMonday: string, count: number) {
  const weeks: Array<{ number: number; kind: "A" | "B"; monday: string }> = [];
  const [year, month, day] = startMonday.split("-").map(Number);
  const cursor = new Date(year!, month! - 1, day, 12);
  for (let number = 1; number <= count; number += 1) {
    const iso = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
    weeks.push({ number, kind: number % 2 === 1 ? "A" : "B", monday: iso });
    cursor.setDate(cursor.getDate() + 7);
  }
  return weeks;
}

function yearsStub(exceptions: SchoolDayException[] = []): SchoolYearStore {
  const year: SchoolYearRecord = {
    id: "year-2027",
    label: "2027-2028",
    status: "active",
    startsOn: "2027-08-01",
    endsOn: "2028-07-31",
    sourceFilename: null,
    importedAt: null,
    activatedAt: "2027-08-01T00:00:00.000Z",
    createdAt: "2027-01-01T00:00:00.000Z",
  };
  const previous: SchoolYearRecord = {
    ...year,
    id: "year-2026",
    label: "2026-2027",
    status: "active",
    startsOn: "2026-08-01",
    endsOn: "2027-07-31",
    activatedAt: null,
  };
  const weeks2027 = mondayWeeks("2027-08-16", 16);
  const weeks2026 = mondayWeeks("2026-08-17", 8);
  return {
    listSchoolYears: async () => [year, previous],
    getActiveSchoolYear: async () => ({ ...year, weeks: weeks2027 }),
    getSchoolYearById: async (id: string) => {
      if (id === "year-2026") return { ...previous, weeks: weeks2026 };
      if (id === "year-2027") return { ...year, weeks: weeks2027 };
      return null;
    },
    listDayExceptions: async () => exceptions,
  } as SchoolYearStore;
}

interface World {
  kind: "memory" | "sqlite";
  adapters: RuntimeAgendaAdapterStore;
  agenda: AgendaStore;
  catalog: ReturnType<typeof getMemorySchoolCatalogStore> | SqlSchoolCatalogStore;
  courses: MemoryAnnualCourseStore | SqlAnnualCourseStore;
  years: SchoolYearStore;
  exceptions: SchoolDayException[];
  teachers: ReturnType<typeof getMemoryTeacherAccountStore> | SqlTeacherAccountStore;
  schedules: MemoryCourseScheduleStore | SqlCourseScheduleStore;
  paths: MemoryPedagogicalPathStore | SqlPedagogicalPathStore;
  notes: ReturnType<typeof getMemoryAnnualCourseNotesStore> | SqlAnnualCourseNotesStore;
  courseDeps: AnnualCourseServiceDeps;
  publishDeps: StructuredPublishDeps;
  persistSchoolYearRow?: (id: string, label: string) => Promise<void>;
  close?: () => void;
}

async function memoryWorld(): Promise<World> {
  resetMemorySchoolCatalogStore();
  resetMemoryAnnualCourseStore();
  resetMemoryPedagogicalPathStore();
  resetMemoryTeacherAccountStore();
  resetMemoryLegacySchool();
  const exceptions: SchoolDayException[] = [];
  const catalog = getMemorySchoolCatalogStore();
  await catalog.ensureSeeded();
  const adapters = new MemoryRuntimeAgendaAdapterStore();
  const agenda = new MemoryAgendaStore([]);
  const courses = new MemoryAnnualCourseStore();
  const years = yearsStub(exceptions);
  const teachers = getMemoryTeacherAccountStore();
  const schedules = new MemoryCourseScheduleStore();
  const paths = new MemoryPedagogicalPathStore();
  const notes = getMemoryAnnualCourseNotesStore();
  const courseDeps: AnnualCourseServiceDeps = {
    courses,
    catalog,
    years,
    teachers,
    notes,
    schedules,
    agenda,
  };
  const publishDeps: StructuredPublishDeps = {
    courses,
    catalog,
    years,
    teachers,
    schedules,
    paths,
    agenda,
    adapters,
  };
  return {
    kind: "memory",
    adapters,
    agenda,
    catalog,
    courses,
    years,
    exceptions,
    teachers,
    schedules,
    paths,
    notes,
    courseDeps,
    publishDeps,
  };
}

async function sqliteWorld(): Promise<World> {
  const db = createNodeSqliteDatabase(":memory:");
  await applyMigrations(db);
  const exceptions: SchoolDayException[] = [];
  const catalog = new SqlSchoolCatalogStore(db);
  await catalog.ensureSeeded();
  const adapters = new SqlRuntimeAgendaAdapterStore(db);
  const agenda = new SqlAgendaStore(db);
  const courses = new SqlAnnualCourseStore(db);
  const years = yearsStub(exceptions);
  const teachers = new SqlTeacherAccountStore(db);
  const schedules = new SqlCourseScheduleStore(db);
  const paths = new SqlPedagogicalPathStore(db);
  const notes = new SqlAnnualCourseNotesStore(db);
  const courseDeps: AnnualCourseServiceDeps = {
    courses,
    catalog,
    years,
    teachers,
    notes,
    schedules,
    agenda,
  };
  const publishDeps: StructuredPublishDeps = {
    courses,
    catalog,
    years,
    teachers,
    schedules,
    paths,
    agenda,
    adapters,
  };
  return {
    kind: "sqlite",
    adapters,
    agenda,
    catalog,
    courses,
    years,
    exceptions,
    teachers,
    schedules,
    paths,
    notes,
    courseDeps,
    publishDeps,
    persistSchoolYearRow: async (id: string, label: string) => {
      await db.exec(
        `INSERT OR IGNORE INTO school_years (id, label, status, starts_on, ends_on, created_at)
         VALUES ('${id.replace(/'/g, "")}', '${label.replace(/'/g, "")}', 'active', '2027-08-01', '2028-07-31', datetime('now'))`,
      );
    },
    close: () => db.close(),
  };
}

async function seedStructuredCourse(world: World, options?: { classCode?: string; schoolYearId?: string }) {
  const profession = await world.catalog.createProfession({
    label: `Mécatronicien PR59 ${Math.random().toString(36).slice(2, 7)}`,
    durationYears: 4,
  });
  const branches = await world.catalog.listBranches();
  const moteur = branches.find((entry) => entry.label === "Moteur") ?? branches[0]!;
  await world.catalog.updateBranch(moteur.id, { teachingType: "TECHNICAL" });
  const ctx = await world.catalog.createContext({
    professionId: profession.id,
    trainingYear: 1,
    branchId: moteur.id,
  });
  assert.equal(ctx.ok, true);
  if (!ctx.ok) throw new Error(ctx.reason);
  const schoolYearId = options?.schoolYearId ?? "year-2027";
  const schoolClass = await world.catalog.createClass({
    code: options?.classCode ?? "PR59A",
    label: options?.classCode ?? "PR59 A",
    schoolYearId,
    schoolYearLabel: schoolYearId === "year-2026" ? "2026-2027" : "2027-2028",
    professionId: profession.id,
    trainingYear: 1,
    parallelCode: "A",
  });
  const teacher = await world.teachers.createAccount({
    displayName: "Tina Titulaire",
    initials: `T${world.kind === "memory" ? "m" : "s"}${Math.random().toString(36).slice(2, 5)}`,
    teachingType: "TECHNICAL",
  });
  assert.equal(teacher.ok, true);
  if (!teacher.ok) throw new Error(teacher.reason);
  const courseResult = await createAnnualCourse(world.courseDeps, {
    schoolYearId,
    classId: schoolClass.id,
    contextId: ctx.value.id,
  });
  assert.equal(courseResult.ok, true);
  if (!courseResult.ok) throw new Error(courseResult.reason);
  return {
    profession,
    moteur,
    context: ctx.value,
    schoolClass,
    teacher: teacher.account,
    course: courseResult.value,
  };
}

async function seedPathAndSlots(
  world: World,
  courseId: string,
  contextId: string,
  items: Array<{ id: string; type: "HOMEWORK" | "TEST" | "INFORMATION"; title: string; detail?: string }>,
) {
  let path = createEmptyPath({ id: `path-${contextId}`, contextId, createdAt: "2027-01-01T00:00:00.000Z" });
  const sessionAdded = addSession(path, { id: `rs-${contextId}-1`, label: "Introduction" });
  assert.equal(sessionAdded.ok, true);
  if (!sessionAdded.ok) throw new Error(sessionAdded.reason);
  path = sessionAdded.value;
  for (const item of items) {
    const added = addItem(path, `rs-${contextId}-1`, item);
    assert.equal(added.ok, true);
    if (!added.ok) throw new Error(added.reason);
    path = added.value;
  }
  await world.paths.savePath(path);
  await world.schedules.createSlot({
    id: `slot-${courseId}-p4`,
    annualCourseId: courseId,
    dayOfWeek: 1,
    periodStart: 4,
    periodEnd: 4,
    weekKind: "all",
    validFrom: null,
    validTo: null,
    createdAt: "2027-01-01T00:00:00.000Z",
    updatedAt: "2027-01-01T00:00:00.000Z",
  });
  await world.schedules.createSlot({
    id: `slot-${courseId}-p6`,
    annualCourseId: courseId,
    dayOfWeek: 1,
    periodStart: 6,
    periodEnd: 6,
    weekKind: "all",
    validFrom: null,
    validTo: null,
    createdAt: "2027-01-01T00:00:00.000Z",
    updatedAt: "2027-01-01T00:00:00.000Z",
  });
  return path;
}

async function bridgeSubjectOptions(world: World, seeded: Awaited<ReturnType<typeof seedStructuredCourse>>) {
  return {
    schoolClass: seeded.schoolClass,
    course: seeded.course,
    branch: seeded.moteur,
    allSchoolClasses: await world.catalog.listClasses(),
    courses: await world.courses.listCourses(),
    contexts: await world.catalog.listContexts(),
    branches: await world.catalog.listBranches(),
  };
}

async function ensureClassroom(world: World, schoolClass: Awaited<ReturnType<typeof seedStructuredCourse>>["schoolClass"]) {
  return ensureRuntimeClassroomForSchoolClass(
    world.adapters,
    schoolClass,
    await world.catalog.listClasses(),
  );
}

function emptyCampusTables(): CampusTableDump {
  const tables: CampusTableDump = {};
  for (const name of CAMPUS_BACKUP_INSERT_ORDER) tables[name] = [];
  return tables;
}

test("version 2.32.0 — dernière migration 0024, aucune table CourseSession", async () => {
  assert.equal(APP_VERSION, "2.42.0");
  assert.equal(SQL_MIGRATION_FILES.at(-1), "0024_structured_agenda_bridge.sql");
  assert.equal(SQL_MIGRATION_FILES.some((file) => file.startsWith("0025")), false);
  const sql = await readFile(new URL("../migrations/0024_structured_agenda_bridge.sql", import.meta.url), "utf8");
  assert.match(sql, /school_class_id/);
  assert.match(sql, /annual_course_id/);
  assert.match(sql, /course_session_key/);
  assert.doesNotMatch(sql, /CREATE TABLE\s+course_sessions/i);
  assert.doesNotMatch(sql, /PRAGMA foreign_keys\s*=\s*ON/i);
});

for (const factory of [
  { name: "Memory", build: memoryWorld },
  { name: "SQLite", build: sqliteWorld },
]) {
  test(`${factory.name} — pont SchoolClass / AnnualCourse idempotent et sûr`, async () => {
    const world = await factory.build();
    try {
      const seeded = await seedStructuredCourse(world);
      const first = await ensureClassroom(world, seeded.schoolClass);
      const second = await ensureClassroom(world, seeded.schoolClass);
      assert.equal(first.ok, true);
      assert.equal(second.ok, true);
      if (!first.ok || !second.ok) return;
      assert.equal(first.value.id, second.value.id);
      assert.equal(first.value.schoolClassId, seeded.schoolClass.id);
      const classrooms = (await world.adapters.listClassrooms()).filter(
        (entry) => entry.schoolClassId === seeded.schoolClass.id,
      );
      assert.equal(classrooms.length, 1);

      const subjectFirst = await ensureRuntimeSubjectForAnnualCourse(
        world.adapters,
        await bridgeSubjectOptions(world, seeded),
      );
      const subjectSecond = await ensureRuntimeSubjectForAnnualCourse(
        world.adapters,
        await bridgeSubjectOptions(world, seeded),
      );
      assert.equal(subjectFirst.ok, true);
      assert.equal(subjectSecond.ok, true);
      if (!subjectFirst.ok || !subjectSecond.ok) return;
      assert.equal(subjectFirst.value.subject.id, subjectSecond.value.subject.id);
      assert.equal(subjectFirst.value.subject.annualCourseId, seeded.course.id);
      assert.equal(subjectFirst.value.subject.classroomId, first.value.id);
      assert.equal(subjectFirst.value.subject.name, seeded.moteur.label);
      const subjects = (await world.adapters.listSubjects()).filter(
        (entry) => entry.annualCourseId === seeded.course.id,
      );
      assert.equal(subjects.length, 1);

      for (let index = 0; index < 8; index += 1) {
        await ensureClassroom(world, seeded.schoolClass);
        await ensureRuntimeSubjectForAnnualCourse(world.adapters, await bridgeSubjectOptions(world, seeded));
      }
      assert.equal(
        (await world.adapters.listClassrooms()).filter((entry) => entry.schoolClassId === seeded.schoolClass.id)
          .length,
        1,
      );
      assert.equal(
        (await world.adapters.listSubjects()).filter((entry) => entry.annualCourseId === seeded.course.id).length,
        1,
      );

      const resolvedClass = await resolveStructuredSchoolClassForClassroom(
        world.adapters,
        first.value.id,
        await world.catalog.listClasses(),
      );
      assert.equal(resolvedClass?.id, seeded.schoolClass.id);
      const target = await resolveStructuredAgendaTarget(world.adapters, {
        classroomId: first.value.id,
        subjectId: subjectFirst.value.subject.id,
        classes: await world.catalog.listClasses(),
        courses: await world.courses.listCourses(),
      });
      assert.equal(target?.course.id, seeded.course.id);
      assert.equal(target?.schoolClass.id, seeded.schoolClass.id);
    } finally {
      world.close?.();
    }
  });

  test(`${factory.name} — deux MMA1A sur deux années → deux adapters`, async () => {
    const world = await factory.build();
    try {
      const first = await seedStructuredCourse(world, { classCode: "MMA1A", schoolYearId: "year-2027" });
      const second = await seedStructuredCourse(world, { classCode: "MMA1A", schoolYearId: "year-2026" });
      const a = await ensureClassroom(world, first.schoolClass);
      const b = await ensureClassroom(world, second.schoolClass);
      assert.equal(a.ok && b.ok, true);
      if (!a.ok || !b.ok) return;
      assert.notEqual(a.value.id, b.value.id);
      assert.equal(a.value.schoolClassId, first.schoolClass.id);
      assert.equal(b.value.schoolClassId, second.schoolClass.id);
    } finally {
      world.close?.();
    }
  });

  test(`${factory.name} — adoption unique sûre, ambiguïté, Moteur ≠ Con. Prof I`, async () => {
    const world = await factory.build();
    try {
      const seeded = await seedStructuredCourse(world, { classCode: "ADPT1" });
      await world.adapters.upsertClassroom({
        id: "legacy-unique-adpt1",
        name: "ADPT1",
        programLabel: "legacy",
        accessCodeHint: "",
        schoolClassId: null,
      });
      const adopted = await ensureClassroom(world, seeded.schoolClass);
      assert.equal(adopted.ok, true);
      if (!adopted.ok) return;
      assert.equal(adopted.value.id, "legacy-unique-adpt1");
      assert.equal(adopted.value.schoolClassId, seeded.schoolClass.id);

      const other = await seedStructuredCourse(world, { classCode: "AMB1" });
      await world.adapters.upsertClassroom({
        id: "legacy-amb-1",
        name: "AMB1",
        programLabel: "a",
        accessCodeHint: "",
        schoolClassId: null,
      });
      await world.adapters.upsertClassroom({
        id: "legacy-amb-2",
        name: "AMB1",
        programLabel: "b",
        accessCodeHint: "",
        schoolClassId: null,
      });
      const ambiguous = await ensureClassroom(world, other.schoolClass);
      assert.equal(ambiguous.ok, true);
      if (!ambiguous.ok) return;
      assert.equal(ambiguous.value.id, runtimeClassroomIdForSchoolClass(other.schoolClass.id));
      assert.equal((await world.adapters.findClassroomById("legacy-amb-1"))?.schoolClassId, null);
      assert.equal((await world.adapters.findClassroomById("legacy-amb-2"))?.schoolClassId, null);

      const classroom = adopted.value;
      await world.adapters.upsertSubject({
        id: "legacy-con-prof",
        classroomId: classroom.id,
        name: "Con. Prof I",
        annualCourseId: null,
      });
      const subject = await ensureRuntimeSubjectForAnnualCourse(
        world.adapters,
        await bridgeSubjectOptions(world, seeded),
      );
      assert.equal(subject.ok, true);
      if (!subject.ok) return;
      assert.notEqual(subject.value.subject.id, "legacy-con-prof");
      assert.equal(subject.value.subject.name, "Moteur");
      assert.equal((await world.adapters.findSubjectById("legacy-con-prof"))?.annualCourseId, null);
      assert.equal(subject.value.subject.id, runtimeSubjectIdForAnnualCourse(seeded.course.id));
    } finally {
      world.close?.();
    }
  });
}

test("publication structurée — rôles, snapshots, déduplication, snapshot figé", async () => {
  const world = await memoryWorld();
  const seeded = await seedStructuredCourse(world);
  const admin = await world.teachers.createAccount({
    displayName: "Admin",
    initials: "AdP",
    teachingType: "TECHNICAL",
    isAdmin: true,
  });
  assert.equal(admin.ok, true);
  if (!admin.ok) throw new Error(admin.reason);
  const coteacher = await world.teachers.createAccount({
    displayName: "Coco",
    initials: "CoP",
    teachingType: "TECHNICAL",
  });
  const replacement = await world.teachers.createAccount({
    displayName: "Remi",
    initials: "ReP",
    teachingType: "TECHNICAL",
  });
  const stranger = await world.teachers.createAccount({
    displayName: "Inconnu",
    initials: "XxP",
    teachingType: "TECHNICAL",
  });
  assert.ok(coteacher.ok && replacement.ok && stranger.ok);
  if (!coteacher.ok || !replacement.ok || !stranger.ok) return;

  await assignTeacherToCourse(world.courseDeps, {
    annualCourseId: seeded.course.id,
    teacherId: seeded.teacher.id,
    role: "PRIMARY",
    createdByAdminId: admin.account.id,
    validFrom: "2027-08-01",
  });
  await assignTeacherToCourse(world.courseDeps, {
    annualCourseId: seeded.course.id,
    teacherId: coteacher.account.id,
    role: "CO_TEACHER",
    createdByAdminId: admin.account.id,
    validFrom: "2027-08-01",
  });

  const path = await seedPathAndSlots(world, seeded.course.id, seeded.context.id, [
    { id: "ref-hw", type: "HOMEWORK", title: "Réviser le circuit", detail: "Pages 12-14" },
    { id: "ref-test", type: "TEST", title: "Contrôle injection", detail: "1h" },
    { id: "ref-info", type: "INFORMATION", title: "Apporter le dossier", detail: "" },
  ]);

  const sessions = await listComputedCourseSessions(world.publishDeps, {
    schoolYearId: "year-2027",
    annualCourseId: seeded.course.id,
  });
  assert.equal(sessions.ok, true);
  if (!sessions.ok) return;
  const first = sessions.value[0];
  assert.ok(first);
  assert.equal(first.segments.length, 2);
  assert.equal(first.key, `year-2027|${seeded.course.id}|${first.date}`);
  await assignTemporaryReplacement(world.courseDeps, {
    annualCourseId: seeded.course.id,
    teacherId: replacement.account.id,
    createdByAdminId: admin.account.id,
    validFrom: first.date,
    validTo: first.date,
  });

  const forged = structuredPublishIdsFromBody({
    annualCourseId: seeded.course.id,
    courseSessionKey: first.key,
    referenceItemId: "ref-hw",
    teacherId: stranger.account.id,
  });
  assert.equal("teacherId" in forged, false);

  const primary = await publishReferenceItemToAgenda(world.publishDeps, {
    teacherId: seeded.teacher.id,
    annualCourseId: seeded.course.id,
    courseSessionKey: first.key,
    referenceItemId: "ref-hw",
  });
  assert.equal(primary.ok, true);
  if (!primary.ok) return;
  assert.equal(primary.item.type, "HOMEWORK");
  assert.equal(primary.item.title, "Réviser le circuit");
  assert.equal(primary.item.detail, "Pages 12-14");
  assert.equal(primary.item.hour, 8);
  assert.equal(primary.item.annualCourseId, seeded.course.id);
  assert.equal(primary.item.courseSessionKey, first.key);
  assert.equal(primary.item.referenceItemId, "ref-hw");
  assert.equal(primary.item.authorTeacherId, seeded.teacher.id);

  const testPub = await publishReferenceItemToAgenda(world.publishDeps, {
    teacherId: coteacher.account.id,
    annualCourseId: seeded.course.id,
    courseSessionKey: first.key,
    referenceItemId: "ref-test",
  });
  assert.equal(testPub.ok, true);
  if (testPub.ok) assert.equal(testPub.item.type, "TEST");

  const infoPub = await publishReferenceItemToAgenda(world.publishDeps, {
    teacherId: replacement.account.id,
    annualCourseId: seeded.course.id,
    courseSessionKey: first.key,
    referenceItemId: "ref-info",
  });
  assert.equal(infoPub.ok, true);
  if (infoPub.ok) assert.equal(infoPub.item.type, "INFORMATION");

  const replacementOutside = await publishReferenceItemToAgenda(world.publishDeps, {
    teacherId: replacement.account.id,
    annualCourseId: seeded.course.id,
    courseSessionKey: sessions.value[1]?.key ?? first.key,
    referenceItemId: "ref-hw",
  });
  if (sessions.value[1]) {
    assert.equal(replacementOutside.ok, false);
    if (!replacementOutside.ok) {
      assert.equal(replacementOutside.status, 403);
      assert.equal(replacementOutside.reason, STRUCTURED_PUBLISH_FORBIDDEN_REASON);
    }
  }

  const unassigned = await publishReferenceItemToAgenda(world.publishDeps, {
    teacherId: stranger.account.id,
    annualCourseId: seeded.course.id,
    courseSessionKey: first.key,
    referenceItemId: "ref-hw",
  });
  assert.equal(unassigned.ok, false);
  if (!unassigned.ok) assert.equal(unassigned.status, 403);

  const duplicate = await publishReferenceItemToAgenda(world.publishDeps, {
    teacherId: seeded.teacher.id,
    annualCourseId: seeded.course.id,
    courseSessionKey: sessions.value[1]?.key ?? first.key,
    referenceItemId: "ref-hw",
  });
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) {
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.reason, STRUCTURED_PUBLISH_ALREADY_REASON);
  }

  const missingKey = await publishReferenceItemToAgenda(world.publishDeps, {
    teacherId: seeded.teacher.id,
    annualCourseId: seeded.course.id,
    courseSessionKey: "year-2027|missing|2099-01-01",
    referenceItemId: "ref-hw",
  });
  assert.equal(missingKey.ok, false);
  if (!missingKey.ok) {
    assert.equal(missingKey.status, 409);
    assert.equal(missingKey.reason, STRUCTURED_PUBLISH_SESSION_GONE_REASON);
  }

  const missingItem = await publishReferenceItemToAgenda(world.publishDeps, {
    teacherId: seeded.teacher.id,
    annualCourseId: seeded.course.id,
    courseSessionKey: first.key,
    referenceItemId: "ref-absent",
  });
  assert.equal(missingItem.ok, false);
  if (!missingItem.ok) assert.equal(missingItem.status, 404);

  const secondSession = addSession(path, { id: "rs-2", label: "Suite" });
  assert.equal(secondSession.ok, true);
  if (!secondSession.ok) return;
  let movedPath = secondSession.value;
  const moved = moveItem(movedPath, "ref-hw", { targetSessionId: "rs-2", position: 1 });
  assert.equal(moved.ok, true);
  if (!moved.ok) return;
  movedPath = moved.value;
  await world.paths.savePath(movedPath);

  const stillPublished = await world.agenda.findAgendaItemByReferenceItem(seeded.course.id, "ref-hw");
  assert.ok(stillPublished);
  const movedPublish = await publishReferenceItemToAgenda(world.publishDeps, {
    teacherId: seeded.teacher.id,
    annualCourseId: seeded.course.id,
    courseSessionKey: first.key,
    referenceItemId: "ref-hw",
  });
  assert.equal(movedPublish.ok, false);
  if (!movedPublish.ok) {
    assert.equal(movedPublish.status, 409);
    assert.ok(
      movedPublish.reason === STRUCTURED_PUBLISH_ALREADY_REASON ||
        movedPublish.reason === STRUCTURED_PUBLISH_ITEM_MOVED_REASON,
    );
  }

  const updated = updateItem(movedPath, "ref-hw", { title: "Nouveau titre", detail: "Changé" });
  assert.equal(updated.ok, true);
  if (updated.ok) await world.paths.savePath(updated.value);
  const snapshot = await world.agenda.findAgendaItem(primary.item.id);
  assert.equal(snapshot?.title, "Réviser le circuit");
  assert.equal(snapshot?.detail, "Pages 12-14");

  const deleted = await world.agenda.deleteAgendaItem(primary.item.id, seeded.teacher.id);
  assert.equal(deleted.ok, true);
  const otherSession = addSession(updated.ok ? updated.value : movedPath, { id: "rs-keep", label: "Autre" });
  if (otherSession.ok) {
    const back = moveItem(otherSession.value, "ref-hw", { targetSessionId: `rs-${seeded.context.id}-1`, position: 1 });
    if (back.ok) await world.paths.savePath(back.value);
  }
  const republish = await publishReferenceItemToAgenda(world.publishDeps, {
    teacherId: seeded.teacher.id,
    annualCourseId: seeded.course.id,
    courseSessionKey: first.key,
    referenceItemId: "ref-hw",
  });
  assert.equal(republish.ok, true);
  if (republish.ok) {
    await world.agenda.deleteAgendaItem(republish.item.id, seeded.teacher.id);
  }

  world.exceptions.push({ date: first.date, state: "holiday", label: "Férié de test" });
  const afterHoliday = await publishReferenceItemToAgenda(world.publishDeps, {
    teacherId: seeded.teacher.id,
    annualCourseId: seeded.course.id,
    courseSessionKey: first.key,
    referenceItemId: "ref-hw",
  });
  assert.equal(afterHoliday.ok, false);
  if (!afterHoliday.ok) {
    assert.equal(afterHoliday.status, 409);
    assert.equal(afterHoliday.reason, STRUCTURED_PUBLISH_SESSION_GONE_REASON);
  }
});

test("PATCH structuré — title/detail OK, ciblage refusé, horaire disparu sans blocage", async () => {
  const world = await memoryWorld();
  const seeded = await seedStructuredCourse(world);
  const admin = await world.teachers.createAccount({
    displayName: "Admin",
    initials: "AdX",
    teachingType: "TECHNICAL",
    isAdmin: true,
  });
  assert.equal(admin.ok, true);
  if (!admin.ok) return;
  await assignTeacherToCourse(world.courseDeps, {
    annualCourseId: seeded.course.id,
    teacherId: seeded.teacher.id,
    role: "PRIMARY",
    createdByAdminId: admin.account.id,
    validFrom: "2027-08-01",
  });
  await seedPathAndSlots(world, seeded.course.id, seeded.context.id, [
    { id: "ref-hw", type: "HOMEWORK", title: "Titre", detail: "Détail" },
  ]);
  const sessions = await listComputedCourseSessions(world.publishDeps, {
    schoolYearId: "year-2027",
    annualCourseId: seeded.course.id,
  });
  assert.equal(sessions.ok, true);
  if (!sessions.ok) return;
  const published = await publishReferenceItemToAgenda(world.publishDeps, {
    teacherId: seeded.teacher.id,
    annualCourseId: seeded.course.id,
    courseSessionKey: sessions.value[0]!.key,
    referenceItemId: "ref-hw",
  });
  assert.equal(published.ok, true);
  if (!published.ok) return;

  assert.equal(structuredAgendaPatchGuard(published.item, { title: "Nouveau" }).ok, true);
  assert.equal(structuredAgendaPatchGuard(published.item, { detail: "Corrigé" }).ok, true);
  assert.equal(structuredAgendaPatchGuard(published.item, { title: "A", detail: "B" }).ok, true);
  assert.equal(structuredAgendaPatchGuard(published.item, { day: 2 }).ok, false);
  assert.equal(structuredAgendaPatchGuard(published.item, { schoolWeekNumber: 9 }).ok, false);
  assert.equal(structuredAgendaPatchGuard(published.item, { subjectId: "x" }).ok, false);
  assert.equal(structuredAgendaPatchGuard(published.item, { courseSessionKey: "other" }).ok, false);
  assert.equal(structuredAgendaPatchGuard(published.item, { annualCourseId: "other" }).reason, STRUCTURED_AGENDA_PATCH_FORBIDDEN_REASON);

  const titleOnly = await world.agenda.updateAgendaItem(published.item.id, seeded.teacher.id, {
    title: "Titre corrigé",
  });
  assert.equal(titleOnly.ok, true);
  const detailOnly = await world.agenda.updateAgendaItem(published.item.id, seeded.teacher.id, {
    detail: "Détail corrigé",
  });
  assert.equal(detailOnly.ok, true);

  await world.schedules.deleteSlot(`slot-${seeded.course.id}-p4`);
  await world.schedules.deleteSlot(`slot-${seeded.course.id}-p6`);
  const afterSlotsGone = await world.agenda.updateAgendaItem(published.item.id, seeded.teacher.id, {
    title: "Toujours éditable",
  });
  assert.equal(afterSlotsGone.ok, true);
  if (afterSlotsGone.ok) {
    assert.equal(afterSlotsGone.item.title, "Toujours éditable");
    assert.equal(afterSlotsGone.item.courseSessionKey, published.item.courseSessionKey);
    assert.equal(afterSlotsGone.item.day, published.item.day);
  }

  const legacy = await world.agenda.createAgendaItem({
    classroomId: "classe-demo-tma-2a",
    subjectId: "subject-demo-moteur-2a",
    authorTeacherId: seeded.teacher.id,
    day: 0,
    hour: 8,
    schoolWeekNumber: 12,
    type: "HOMEWORK",
    title: "Legacy",
    detail: "sans pont",
  });
  assert.equal(structuredAgendaPatchGuard(legacy, { day: 3 }).ok, true);
});

test("admin Memory / SQLite — même comportement update et delete", async () => {
  async function run(store: AgendaStore, authorId: string, otherId: string, adminId: string) {
    const created = await store.createAgendaItem({
      classroomId: "classe-demo-tma-2a",
      subjectId: "subject-demo-moteur-2a",
      authorTeacherId: authorId,
      day: 0,
      hour: 8,
      schoolWeekNumber: 1,
      type: "INFORMATION",
      title: "Note",
      detail: "origin",
    });
    const authorOk = await store.updateAgendaItem(created.id, authorId, { title: "Auteur" });
    assert.equal(authorOk.ok, true);
    const otherDenied = await store.updateAgendaItem(created.id, otherId, { title: "Usurpation" });
    assert.equal(otherDenied.ok, false);
    const adminOk = await store.updateAgendaItem(created.id, adminId, { title: "Admin" });
    assert.equal(adminOk.ok, true);
    const otherDelete = await store.deleteAgendaItem(created.id, otherId);
    assert.equal(otherDelete.ok, false);
    const adminDelete = await store.deleteAgendaItem(created.id, adminId);
    assert.equal(adminDelete.ok, true);
  }

  resetMemoryTeacherAccountStore();
  resetMemoryLegacySchool();
  const memoryTeachers = getMemoryTeacherAccountStore();
  const author = await memoryTeachers.createAccount({ displayName: "Auteur", initials: "Au1", teachingType: "TECHNICAL" });
  const other = await memoryTeachers.createAccount({ displayName: "Autre", initials: "Ot1", teachingType: "TECHNICAL" });
  const admin = await memoryTeachers.createAccount({
    displayName: "Admin",
    initials: "Ad1",
    teachingType: "TECHNICAL",
    isAdmin: true,
  });
  assert.ok(author.ok && other.ok && admin.ok);
  if (!author.ok || !other.ok || !admin.ok) return;
  const memoryStore = new MemoryAgendaStore([]);
  await run(memoryStore, author.account.id, other.account.id, admin.account.id);

  const archived = await memoryTeachers.updateAccount(admin.account.id, { isArchived: true });
  assert.equal(archived.ok, true);
  const created = await memoryStore.createAgendaItem({
    classroomId: "classe-demo-tma-2a",
    subjectId: "subject-demo-moteur-2a",
    authorTeacherId: author.account.id,
    day: 0,
    hour: 8,
    schoolWeekNumber: 1,
    type: "INFORMATION",
    title: "Archive",
    detail: "x",
  });
  const archivedDenied = await memoryStore.updateAgendaItem(created.id, admin.account.id, { title: "Nope" });
  assert.equal(archivedDenied.ok, false);

  const db = createNodeSqliteDatabase(":memory:");
  await applyMigrations(db);
  await seedDemoDatabase(db);
  const sqlTeachers = new SqlTeacherAccountStore(db);
  const sqlAuthor = await sqlTeachers.createAccount({ displayName: "Auteur", initials: "Au2", teachingType: "TECHNICAL" });
  const sqlOther = await sqlTeachers.createAccount({ displayName: "Autre", initials: "Ot2", teachingType: "TECHNICAL" });
  const sqlAdmin = await sqlTeachers.createAccount({
    displayName: "Admin",
    initials: "Ad2",
    teachingType: "TECHNICAL",
    isAdmin: true,
  });
  assert.ok(sqlAuthor.ok && sqlOther.ok && sqlAdmin.ok);
  if (!sqlAuthor.ok || !sqlOther.ok || !sqlAdmin.ok) {
    db.close();
    return;
  }
  const sqlStore = new SqlAgendaStore(db);
  await run(sqlStore, sqlAuthor.account.id, sqlOther.account.id, sqlAdmin.account.id);

  await sqlTeachers.updateAccount(sqlAdmin.account.id, { isActive: false });
  const sqlItem = await sqlStore.createAgendaItem({
    classroomId: "classe-demo-tma-2a",
    subjectId: "subject-demo-moteur-2a",
    authorTeacherId: sqlAuthor.account.id,
    day: 0,
    hour: 8,
    schoolWeekNumber: 1,
    type: "INFORMATION",
    title: "Disabled",
    detail: "x",
  });
  const disabledDenied = await sqlStore.updateAgendaItem(sqlItem.id, sqlAdmin.account.id, { title: "Nope" });
  assert.equal(disabledDenied.ok, false);
  const disabledDelete = await sqlStore.deleteAgendaItem(sqlItem.id, sqlAdmin.account.id);
  assert.equal(disabledDelete.ok, false);
  db.close();
});

test("suppression AnnualCourse bloquée par publication structurée", async () => {
  const world = await memoryWorld();
  const seeded = await seedStructuredCourse(world);
  const admin = await world.teachers.createAccount({
    displayName: "Admin",
    initials: "AdD",
    teachingType: "TECHNICAL",
    isAdmin: true,
  });
  assert.equal(admin.ok, true);
  if (!admin.ok) return;
  await world.adapters.upsertClassroom({
    id: "classroom-block",
    name: "PR59A",
    programLabel: "",
    accessCodeHint: "",
    schoolClassId: seeded.schoolClass.id,
  });
  await world.adapters.upsertSubject({
    id: "subject-block",
    classroomId: "classroom-block",
    name: "Moteur",
    annualCourseId: seeded.course.id,
  });
  await world.agenda.createAgendaItem({
    classroomId: "classroom-block",
    subjectId: "subject-block",
    authorTeacherId: seeded.teacher.id,
    day: 0,
    hour: 8,
    schoolWeekNumber: 1,
    type: "HOMEWORK",
    title: "Publié",
    detail: "",
    annualCourseId: seeded.course.id,
    courseSessionKey: "year-2027|x|2027-08-16",
    referenceItemId: "ref-1",
  });
  const blocked = await deleteAnnualCourse(world.courseDeps, seeded.course.id);
  assert.equal(blocked.ok, false);
  if (!blocked.ok) {
    assert.equal(blocked.status, 409);
    assert.equal(blocked.reason, ANNUAL_COURSE_AGENDA_DELETE_REASON);
  }
  const items = await world.agenda.listAgendaItemsByAnnualCourse(seeded.course.id);
  await world.agenda.deleteAgendaItem(items[0]!.id, seeded.teacher.id);
  const allowed = await deleteAnnualCourse(world.courseDeps, seeded.course.id);
  assert.equal(allowed.ok, true);
});

test("backup v4 — nouveaux liens optionnels, références invalides refusées", () => {
  const baseTeachers = [
    {
      id: "admin-1",
      display_name: "Admin",
      initials: "Ad",
      password_hash: "x",
      is_admin: 1,
      is_active: 1,
    },
  ];
  const empty = emptyCampusTables();
  const legacy = validateCampusTables({
    ...empty,
    teachers: baseTeachers,
    classrooms: [{ id: "c1", name: "MA2" }],
    subjects: [{ id: "s1", classroom_id: "c1", name: "Moteur" }],
    agenda_items: [
      {
        id: 1,
        classroom_id: "c1",
        subject_id: "s1",
        author_teacher_id: "admin-1",
        day: 0,
        hour: 8,
        type: "HOMEWORK",
        title: "Ancien",
      },
    ],
  });
  assert.equal(legacy.ok, true);

  const withLinks = validateCampusTables({
    ...empty,
    teachers: baseTeachers,
    school_classes: [
      {
        id: "class-1",
        code: "PR59A",
        label: "PR59 A",
        is_active: 1,
      },
    ],
    annual_courses: [
      {
        id: "ac-1",
        school_year_id: "year-2027",
        class_id: "class-1",
        context_id: "ctx-1",
      },
    ],
    school_years: [
      {
        id: "year-2027",
        label: "2027-2028",
        status: "active",
        starts_on: "2027-08-01",
        ends_on: "2028-07-31",
      },
    ],
    pedagogical_contexts: [
      {
        id: "ctx-1",
        admin_code: "CTX-0001",
        profession_id: "prf-1",
        training_year: 1,
        branch_id: "br-1",
        is_active: 1,
      },
    ],
    school_professions: [
      { id: "prf-1", admin_code: "PRF-0001", label: "Mécatronique", is_active: 1 },
    ],
    school_branches: [
      { id: "br-1", code: "MOT", label: "Moteur", is_active: 1 },
    ],
    classrooms: [{ id: "c1", name: "PR59A", school_class_id: "class-1" }],
    subjects: [{ id: "s1", classroom_id: "c1", name: "Moteur", annual_course_id: "ac-1" }],
    agenda_items: [
      {
        id: 1,
        classroom_id: "c1",
        subject_id: "s1",
        author_teacher_id: "admin-1",
        day: 0,
        hour: 8,
        type: "HOMEWORK",
        title: "Structuré",
        annual_course_id: "ac-1",
        course_session_key: "year-2027|ac-1|2027-08-16",
        course_session_date: "2027-08-16",
        reference_session_id: "rs-1",
        reference_item_id: "ri-1",
      },
    ],
  });
  assert.equal(withLinks.ok, true);

  const badClassroom = validateCampusTables({
    ...empty,
    teachers: baseTeachers,
    classrooms: [{ id: "c1", name: "PR59A", school_class_id: "inconnu" }],
  });
  assert.equal(badClassroom.ok, false);

  const badSubject = validateCampusTables({
    ...empty,
    teachers: baseTeachers,
    classrooms: [{ id: "c1", name: "PR59A" }],
    subjects: [{ id: "s1", classroom_id: "c1", name: "Moteur", annual_course_id: "inconnu" }],
  });
  assert.equal(badSubject.ok, false);

  const badAgenda = validateCampusTables({
    ...empty,
    teachers: baseTeachers,
    classrooms: [{ id: "c1", name: "PR59A" }],
    subjects: [{ id: "s1", classroom_id: "c1", name: "Moteur" }],
    agenda_items: [
      {
        id: 1,
        classroom_id: "c1",
        subject_id: "s1",
        author_teacher_id: "admin-1",
        day: 0,
        hour: 8,
        type: "HOMEWORK",
        title: "X",
        annual_course_id: "inconnu",
      },
    ],
  });
  assert.equal(badAgenda.ok, false);
});

test("reconciliation classrooms structurés — aucun doublon", async () => {
  const world = await memoryWorld();
  const a = await seedStructuredCourse(world, { classCode: "REC1" });
  const b = await seedStructuredCourse(world, { classCode: "REC2" });
  await reconcileStructuredClassrooms(world.adapters, await world.catalog.listClasses());
  await reconcileStructuredClassrooms(world.adapters, await world.catalog.listClasses());
  const linked = (await world.adapters.listClassrooms()).filter(
    (entry) => entry.schoolClassId === a.schoolClass.id || entry.schoolClassId === b.schoolClass.id,
  );
  assert.equal(linked.length, 2);
});

test("backup Memory / SQLite — liens et provenance conservés", async () => {
  const world = await memoryWorld();
  const seeded = await seedStructuredCourse(world);
  const linked = await ensureRuntimeSubjectForAnnualCourse(
    world.adapters,
    await bridgeSubjectOptions(world, seeded),
  );
  assert.equal(linked.ok, true);
  if (!linked.ok) return;
  await world.agenda.createAgendaItem({
    classroomId: linked.value.classroom.id,
    subjectId: linked.value.subject.id,
    authorTeacherId: seeded.teacher.id,
    day: 0,
    hour: 8,
    schoolWeekNumber: 1,
    type: "HOMEWORK",
    title: "Backup",
    detail: "provenance",
    annualCourseId: seeded.course.id,
    courseSessionKey: `year-2027|${seeded.course.id}|2027-08-16`,
    courseSessionDate: "2027-08-16",
    referenceSessionId: "rs-1",
    referenceItemId: "ri-1",
  });

  const memoryDeps: CampusBackupDeps = {
    agenda: world.agenda,
    teacherSetups: getMemoryTeacherSetupStore(),
    teacherNotes: getMemoryTeacherNotesStore(),
    teacherAccounts: world.teachers,
    catalog: world.catalog,
    years: world.years,
    courses: world.courses,
    schedules: world.schedules,
    memberships: new MemoryMembershipStore(),
    paths: world.paths,
    courseNotes: world.notes,
    templates: getMemoryTemplateStore(),
    timetable: getMemoryTimetableStore(),
    sqlDb: null,
  };
  const exported = await exportCampusSnapshot(memoryDeps);
  const classroomRow = exported.tables.classrooms.find((row) => row.id === linked.value.classroom.id);
  const subjectRow = exported.tables.subjects.find((row) => row.id === linked.value.subject.id);
  const itemRow = exported.tables.agenda_items.find((row) => row.title === "Backup");
  assert.equal(classroomRow?.school_class_id, seeded.schoolClass.id);
  assert.equal(subjectRow?.annual_course_id, seeded.course.id);
  assert.equal(itemRow?.course_session_key, `year-2027|${seeded.course.id}|2027-08-16`);
  assert.equal(itemRow?.reference_item_id, "ri-1");

  resetMemoryLegacySchool();
  const emptied = new MemoryAgendaStore([]);
  memoryDeps.agenda = emptied;
  const restored = await restoreCampusSnapshot(memoryDeps, exported);
  assert.equal(restored.ok, true, restored.ok ? "" : restored.reason);
  const restoredClassroom = await world.adapters.findClassroomById(linked.value.classroom.id);
  const restoredSubject = await world.adapters.findSubjectById(linked.value.subject.id);
  const restoredItems = await emptied.listAgendaItemsByAnnualCourse(seeded.course.id);
  assert.equal(restoredClassroom?.schoolClassId, seeded.schoolClass.id);
  assert.equal(restoredSubject?.annualCourseId, seeded.course.id);
  assert.equal(restoredItems[0]?.referenceItemId, "ri-1");

  const db = createNodeSqliteDatabase(":memory:");
  await applyMigrations(db);
  await seedDemoDatabase(db);
  const sqlAgenda = new SqlAgendaStore(db);
  await sqlAgenda.createAgendaItem({
    classroomId: "classe-demo-tma-2a",
    subjectId: "subject-demo-moteur-2a",
    authorTeacherId: "teacher-demo-current",
    day: 0,
    hour: 8,
    schoolWeekNumber: 12,
    type: "HOMEWORK",
    title: "SQL provenance",
    detail: "x",
    annualCourseId: "ac-sql-1",
    courseSessionKey: "year-x|ac-sql-1|2027-08-16",
    courseSessionDate: "2027-08-16",
    referenceSessionId: "rs-sql",
    referenceItemId: "ri-sql",
  });
  const dump = await dumpCampusTables(db);
  assert.equal(
    dump.agenda_items.some((row) => row.reference_item_id === "ri-sql"),
    true,
  );
  const db2 = createNodeSqliteDatabase(":memory:");
  await applyMigrations(db2);
  await restoreCampusTables(db2, dump);
  const again = await dumpCampusTables(db2);
  assert.deepEqual(canonicalizeCampusDump(again).agenda_items, canonicalizeCampusDump(dump).agenda_items);
  db.close();
  db2.close();
});

test("E2E sources — UI et API publication dédiée", async () => {
  const [panel, route, agendaPost, agendaApi] = await Promise.all([
    readFile(new URL("../web/app/components/teacher-course-timeline-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/api/teacher/course-publications/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/app/api/agenda/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/lib/server/api.ts", import.meta.url), "utf8"),
  ]);
  assert.match(panel, /Publier dans l’Agenda/);
  assert.match(panel, /Publié dans l’Agenda/);
  assert.match(panel, /publishTeacherCoursePublicationApi/);
  assert.match(panel, /Aucun contenu de référence prévu pour cette séance/);
  assert.match(panel, /itemId: string;\s*message: string/);
  assert.match(panel, /publishError\?\.itemId === item\.id/);
  assert.match(panel, /setPublishError\(\{ itemId: referenceItemId, message \}\)/);
  assert.doesNotMatch(panel, /publishError && publishingItemId === item\.id/);
  assert.match(route, /requireTeacherSession/);
  assert.match(route, /publishReferenceItemToAgenda/);
  assert.match(route, /auth\.session!\.teacherId/);
  assert.doesNotMatch(route, /body\.teacherId/);
  assert.match(agendaPost, /provenance structurée ne peut être écrite/);
  assert.match(agendaPost, /assertStructuredAgendaSubjectLinked/);
  assert.match(agendaPost, /schoolWeekNumber, dayIndex: day/);
  assert.match(agendaApi, /isoDateForSchoolWeekDay/);
  assert.match(agendaApi, /loadClassroomAgendaBinding/);
  assert.match(agendaApi, /structured-incomplete/);
  assert.doesNotMatch(agendaApi, /at: new Date\(\)\.toISOString\(\)/);
});

function yearsWithStatus(status: "draft" | "active" | "archived", exceptions: SchoolDayException[] = []): SchoolYearStore {
  const inner = yearsStub(exceptions);
  return {
    ...inner,
    getSchoolYearById: async (id: string) => {
      const year = await inner.getSchoolYearById(id);
      return year ? { ...year, status } : null;
    },
    getActiveSchoolYear: async () => {
      const year = await inner.getActiveSchoolYear();
      return year ? { ...year, status } : null;
    },
  } as SchoolYearStore;
}

async function preparePublishableCourse(world: World) {
  const seeded = await seedStructuredCourse(world);
  const admin = await world.teachers.createAccount({
    displayName: "Admin cycle",
    initials: `Ac${Math.random().toString(36).slice(2, 4)}`,
    teachingType: "TECHNICAL",
    isAdmin: true,
  });
  assert.equal(admin.ok, true);
  if (!admin.ok) throw new Error(admin.reason);
  await assignTeacherToCourse(world.courseDeps, {
    annualCourseId: seeded.course.id,
    teacherId: seeded.teacher.id,
    role: "PRIMARY",
    createdByAdminId: admin.account.id,
    validFrom: "2027-08-01",
  });
  await seedPathAndSlots(world, seeded.course.id, seeded.context.id, [
    { id: `ref-life-${seeded.course.id}`, type: "HOMEWORK", title: "Réviser", detail: "ok" },
  ]);
  const sessions = await listComputedCourseSessions(world.publishDeps, {
    schoolYearId: "year-2027",
    annualCourseId: seeded.course.id,
  });
  assert.equal(sessions.ok, true);
  if (!sessions.ok) throw new Error(sessions.reason);
  const session = sessions.value[0];
  assert.ok(session);
  return { seeded, admin: admin.account, session };
}

for (const factory of [
  { name: "Memory", build: memoryWorld },
  { name: "SQLite", build: sqliteWorld },
]) {
  test(`${factory.name} — MMA1A multi-années : classroom legacy jamais adopté`, async () => {
    const world = await factory.build();
    try {
      await world.adapters.upsertClassroom({
        id: "legacy-mma1a",
        name: "MMA1A",
        programLabel: "historique",
        accessCodeHint: "",
        schoolClassId: null,
      });
      const year2027 = await seedStructuredCourse(world, { classCode: "MMA1A", schoolYearId: "year-2027" });
      const year2026 = await seedStructuredCourse(world, { classCode: "MMA1A", schoolYearId: "year-2026" });
      await reconcileStructuredClassrooms(world.adapters, await world.catalog.listClasses());
      await ensureClassroom(world, year2026.schoolClass);
      await ensureClassroom(world, year2027.schoolClass);

      const legacy = await world.adapters.findClassroomById("legacy-mma1a");
      assert.equal(legacy?.schoolClassId, null);
      const adapter2027 = await world.adapters.findClassroomBySchoolClassId(year2027.schoolClass.id);
      const adapter2026 = await world.adapters.findClassroomBySchoolClassId(year2026.schoolClass.id);
      assert.ok(adapter2027 && adapter2026);
      assert.notEqual(adapter2027.id, "legacy-mma1a");
      assert.notEqual(adapter2026.id, "legacy-mma1a");
      assert.equal(adapter2027.id, runtimeClassroomIdForSchoolClass(year2027.schoolClass.id));
      assert.equal(adapter2026.id, runtimeClassroomIdForSchoolClass(year2026.schoolClass.id));
      assert.notEqual(adapter2027.id, adapter2026.id);
    } finally {
      world.close?.();
    }
  });

  test(`${factory.name} — classroom structuré sans subject lié : pas de membership / noms`, async () => {
    const world = await factory.build();
    try {
      const seeded = await seedStructuredCourse(world);
      const classroom = await ensureClassroom(world, seeded.schoolClass);
      assert.equal(classroom.ok, true);
      if (!classroom.ok) return;
      await world.adapters.upsertSubject({
        id: "legacy-unlinked-subject",
        classroomId: classroom.value.id,
        name: "Con. Prof I",
        annualCourseId: null,
      });
      const binding = inspectClassroomAgendaBinding({
        classroom: classroom.value,
        subject: await world.adapters.findSubjectById("legacy-unlinked-subject"),
        classes: await world.catalog.listClasses(),
        courses: await world.courses.listCourses(),
      });
      assert.equal(binding.kind, "structured-incomplete");
      if (binding.kind !== "structured-incomplete") return;
      assert.equal(binding.reason, STRUCTURED_SUBJECT_UNLINKED_REASON);
      assert.equal(
        evaluateTeacherAgendaPublishAccess({
          binding,
          teacherId: seeded.teacher.id,
          assignments: [],
          targetAt: assignmentInstantForSessionDate("2027-08-16"),
          teacher: seeded.teacher,
          legacyResolved: null,
          legacyMembershipAllows: true,
        }),
        false,
      );

      const tcaBinding = inspectClassroomAgendaBinding({
        classroom: classroom.value,
        subject: await world.adapters.findSubjectById("legacy-unlinked-subject"),
        classes: await world.catalog.listClasses(),
        courses: await world.courses.listCourses(),
      });
      const assignments = [
        {
          id: "tca-ignored",
          annualCourseId: seeded.course.id,
          teacherId: seeded.teacher.id,
          role: "PRIMARY" as const,
          validFrom: "2027-01-01T00:00:00.000Z",
          validTo: null,
          createdByAdminId: "admin",
          createdAt: "2027-01-01T00:00:00.000Z",
          endedAt: null,
          overrideReason: null,
          overrideByAdminId: null,
        },
      ];
      assert.equal(
        evaluateTeacherAgendaPublishAccess({
          binding: tcaBinding,
          teacherId: seeded.teacher.id,
          assignments,
          targetAt: assignmentInstantForSessionDate("2027-08-16"),
          teacher: seeded.teacher,
          legacyResolved: null,
          legacyMembershipAllows: false,
        }),
        false,
      );

      const linked = await ensureRuntimeSubjectForAnnualCourse(
        world.adapters,
        await bridgeSubjectOptions(world, seeded),
      );
      assert.equal(linked.ok, true);
      if (!linked.ok) return;
      const complete = inspectClassroomAgendaBinding({
        classroom: linked.value.classroom,
        subject: linked.value.subject,
        classes: await world.catalog.listClasses(),
        courses: await world.courses.listCourses(),
      });
      assert.equal(complete.kind, "structured");
      assert.equal(
        evaluateTeacherAgendaPublishAccess({
          binding: complete,
          teacherId: seeded.teacher.id,
          assignments,
          targetAt: assignmentInstantForSessionDate("2027-08-16"),
          teacher: seeded.teacher,
          legacyResolved: null,
          legacyMembershipAllows: false,
        }),
        true,
      );

      const legacyClassroom = await world.adapters.upsertClassroom({
        id: "pure-legacy-room",
        name: "OLD1",
        programLabel: "legacy",
        accessCodeHint: "",
        schoolClassId: null,
      });
      const legacyBinding = inspectClassroomAgendaBinding({
        classroom: legacyClassroom,
        subject: { id: "s-legacy", classroomId: legacyClassroom.id, name: "Con. Prof I", annualCourseId: null },
        classes: await world.catalog.listClasses(),
        courses: await world.courses.listCourses(),
      });
      assert.equal(legacyBinding.kind, "legacy");
      assert.equal(
        evaluateTeacherAgendaPublishAccess({
          binding: legacyBinding,
          teacherId: seeded.teacher.id,
          assignments: [],
          targetAt: null,
          teacher: seeded.teacher,
          legacyResolved: null,
          legacyMembershipAllows: true,
        }),
        true,
      );
    } finally {
      world.close?.();
    }
  });
}

test("subject legacy : plusieurs AnnualCourse candidats → pas d’adoption", () => {
  const subjects = [
    { id: "legacy-moteur", classroomId: "c1", name: "Moteur", annualCourseId: null },
  ];
  assert.equal(findUniqueAdoptableSubject(subjects, "c1", "Moteur", ["ac-1", "ac-2"]), null);
  assert.equal(findUniqueAdoptableSubject(subjects, "c1", "Moteur", ["ac-1"])?.id, "legacy-moteur");
});

test("TCA générique : date cible du calendrier, pas l’horloge courante", async () => {
  const weeks = mondayWeeks("2027-08-16", 8);
  const week1Monday = isoDateForSchoolWeekDay(weeks, 1, 0);
  const week5Monday = isoDateForSchoolWeekDay(weeks, 5, 0);
  assert.equal(week1Monday, "2027-08-16");
  assert.equal(week5Monday, "2027-09-13");

  const world = await memoryWorld();
  const seeded = await seedStructuredCourse(world);
  const admin = await world.teachers.createAccount({
    displayName: "Admin TCA date",
    initials: "AdD",
    teachingType: "TECHNICAL",
    isAdmin: true,
  });
  const replacement = await world.teachers.createAccount({
    displayName: "Remplaçant date",
    initials: "ReD",
    teachingType: "TECHNICAL",
  });
  assert.ok(admin.ok && replacement.ok);
  if (!admin.ok || !replacement.ok) return;
  await assignTeacherToCourse(world.courseDeps, {
    annualCourseId: seeded.course.id,
    teacherId: seeded.teacher.id,
    role: "PRIMARY",
    createdByAdminId: admin.account.id,
    validFrom: "2027-08-01",
  });
  const coteacher = await world.teachers.createAccount({
    displayName: "Co date",
    initials: "CoD",
    teachingType: "TECHNICAL",
  });
  assert.equal(coteacher.ok, true);
  if (!coteacher.ok) return;
  await assignTeacherToCourse(world.courseDeps, {
    annualCourseId: seeded.course.id,
    teacherId: coteacher.account.id,
    role: "CO_TEACHER",
    createdByAdminId: admin.account.id,
    validFrom: "2027-08-01",
  });
  await assignTemporaryReplacement(world.courseDeps, {
    annualCourseId: seeded.course.id,
    teacherId: replacement.account.id,
    createdByAdminId: admin.account.id,
    validFrom: week1Monday!,
    validTo: week1Monday!,
  });
  const assignments = await world.courses.listAssignments(seeded.course.id);
  const classroom = await ensureRuntimeSubjectForAnnualCourse(
    world.adapters,
    await bridgeSubjectOptions(world, seeded),
  );
  assert.equal(classroom.ok, true);
  if (!classroom.ok) return;
  const binding = inspectClassroomAgendaBinding({
    classroom: classroom.value.classroom,
    subject: classroom.value.subject,
    classes: await world.catalog.listClasses(),
    courses: await world.courses.listCourses(),
  });
  assert.equal(binding.kind, "structured");

  const atWeek1 = assignmentInstantForSessionDate(week1Monday!);
  const atWeek5 = assignmentInstantForSessionDate(week5Monday!);
  const future = assignmentInstantForSessionDate("2027-06-01");

  assert.equal(
    evaluateTeacherAgendaPublishAccess({
      binding,
      teacherId: replacement.account.id,
      assignments,
      targetAt: atWeek1,
      teacher: replacement.account,
      legacyResolved: null,
      legacyMembershipAllows: false,
    }),
    true,
  );
  assert.equal(
    evaluateTeacherAgendaPublishAccess({
      binding,
      teacherId: replacement.account.id,
      assignments,
      targetAt: atWeek5,
      teacher: replacement.account,
      legacyResolved: null,
      legacyMembershipAllows: false,
    }),
    false,
  );
  assert.equal(
    evaluateTeacherAgendaPublishAccess({
      binding,
      teacherId: replacement.account.id,
      assignments,
      targetAt: future,
      teacher: replacement.account,
      legacyResolved: null,
      legacyMembershipAllows: false,
    }),
    false,
  );
  assert.equal(
    evaluateTeacherAgendaPublishAccess({
      binding,
      teacherId: seeded.teacher.id,
      assignments,
      targetAt: atWeek5,
      teacher: seeded.teacher,
      legacyResolved: null,
      legacyMembershipAllows: false,
    }),
    true,
  );
  assert.equal(
    evaluateTeacherAgendaPublishAccess({
      binding,
      teacherId: coteacher.account.id,
      assignments,
      targetAt: atWeek5,
      teacher: coteacher.account,
      legacyResolved: null,
      legacyMembershipAllows: false,
    }),
    true,
  );
});

test("publication dédiée — année draft / archived + référentiel inactif", async () => {
  async function publishWithYearStatus(status: "draft" | "archived") {
    const world = await memoryWorld();
    const prepared = await preparePublishableCourse(world);
    world.years = yearsWithStatus(status);
    world.publishDeps = { ...world.publishDeps, years: world.years };
    world.courseDeps = { ...world.courseDeps, years: world.years };
    const result = await publishReferenceItemToAgenda(world.publishDeps, {
      teacherId: prepared.seeded.teacher.id,
      annualCourseId: prepared.seeded.course.id,
      courseSessionKey: prepared.session.key,
      referenceItemId: `ref-life-${prepared.seeded.course.id}`,
    });
    return result;
  }

  const draft = await publishWithYearStatus("draft");
  assert.equal(draft.ok, false);
  if (!draft.ok) {
    assert.equal(draft.status, 409);
    assert.equal(draft.reason, STRUCTURED_PUBLISH_YEAR_DRAFT_REASON);
  }

  const archived = await publishWithYearStatus("archived");
  assert.equal(archived.ok, false);
  if (!archived.ok) {
    assert.equal(archived.status, 409);
    assert.equal(archived.reason, STRUCTURED_PUBLISH_YEAR_ARCHIVED_REASON);
  }

  async function refuseAfter(mutate: (world: World, seeded: Awaited<ReturnType<typeof seedStructuredCourse>>) => Promise<void>) {
    const world = await memoryWorld();
    const prepared = await preparePublishableCourse(world);
    await mutate(world, prepared.seeded);
    const result = await publishReferenceItemToAgenda(world.publishDeps, {
      teacherId: prepared.seeded.teacher.id,
      annualCourseId: prepared.seeded.course.id,
      courseSessionKey: prepared.session.key,
      referenceItemId: `ref-life-${prepared.seeded.course.id}`,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 409);
    assert.equal((await world.agenda.listAgendaItemsByAnnualCourse(prepared.seeded.course.id)).length, 0);
    return result;
  }

  const ctxInactive = await refuseAfter(async (world, seeded) => {
    const updated = await world.catalog.updateContext(seeded.context.id, { isActive: false });
    assert.equal(updated.ok, true);
  });
  if (!ctxInactive.ok) assert.match(ctxInactive.reason, /CTX/);

  const ctxArchived = await refuseAfter(async (world, seeded) => {
    const updated = await world.catalog.updateContext(seeded.context.id, { isArchived: true });
    assert.equal(updated.ok, true);
  });
  if (!ctxArchived.ok) assert.match(ctxArchived.reason, /CTX/);

  const branchInactive = await refuseAfter(async (world, seeded) => {
    await world.catalog.updateBranch(seeded.moteur.id, { isActive: false });
  });
  if (!branchInactive.ok) assert.match(branchInactive.reason, /branche/i);

  const branchArchived = await refuseAfter(async (world, seeded) => {
    await world.catalog.updateBranch(seeded.moteur.id, { isArchived: true });
  });
  if (!branchArchived.ok) assert.match(branchArchived.reason, /branche/i);

  const professionInactive = await refuseAfter(async (world, seeded) => {
    const updated = await world.catalog.updateProfession(seeded.profession.id, {
      label: seeded.profession.label,
      durationYears: seeded.profession.durationYears,
      isActive: false,
    });
    assert.equal(updated.ok, true);
  });
  if (!professionInactive.ok) assert.match(professionInactive.reason, /profession/i);

  const professionArchived = await refuseAfter(async (world, seeded) => {
    const updated = await world.catalog.updateProfession(seeded.profession.id, {
      label: seeded.profession.label,
      durationYears: seeded.profession.durationYears,
      isArchived: true,
    });
    assert.equal(updated.ok, true);
  });
  if (!professionArchived.ok) assert.match(professionArchived.reason, /profession/i);

  const classInactive = await refuseAfter(async (world, seeded) => {
    await world.catalog.updateClass(seeded.schoolClass.id, { isActive: false });
  });
  if (!classInactive.ok) assert.match(classInactive.reason, /classe/i);

  const courseArchived = await refuseAfter(async (world, seeded) => {
    await world.courses.archiveCourse(seeded.course.id);
  });
  if (!courseArchived.ok) {
    assert.equal(courseArchived.reason, STRUCTURED_PUBLISH_COURSE_ARCHIVED_REASON);
  }
});

test("SQLite — concurrence UNIQUE annualCourse + referenceItem → 409 métier", async () => {
  const world = await sqliteWorld();
  try {
    const prepared = await preparePublishableCourse(world);
    await world.persistSchoolYearRow?.("year-2027", "2027-2028");
    const adapters = await ensureRuntimeSubjectForAnnualCourse(
      world.adapters,
      await bridgeSubjectOptions(world, prepared.seeded),
    );
    assert.equal(adapters.ok, true);
    const input = {
      teacherId: prepared.seeded.teacher.id,
      annualCourseId: prepared.seeded.course.id,
      courseSessionKey: prepared.session.key,
      referenceItemId: `ref-life-${prepared.seeded.course.id}`,
    };
    const [first, second] = await Promise.all([
      publishReferenceItemToAgenda(world.publishDeps, input),
      publishReferenceItemToAgenda(world.publishDeps, input),
    ]);
    const successes = [first, second].filter((entry) => entry.ok);
    const failures = [first, second].filter((entry) => !entry.ok);
    assert.equal(successes.length, 1);
    assert.equal(failures.length, 1);
    if (!failures[0]!.ok) {
      assert.equal(failures[0].status, 409);
      assert.equal(failures[0].reason, STRUCTURED_PUBLISH_ALREADY_REASON);
    }
    assert.equal((await world.agenda.listAgendaItemsByAnnualCourse(prepared.seeded.course.id)).length, 1);

    const recovered = await recoverStructuredPublishUniqueConflict(
      world.agenda,
      prepared.seeded.course.id,
      `ref-life-${prepared.seeded.course.id}`,
    );
    assert.equal(recovered?.reason, STRUCTURED_PUBLISH_ALREADY_REASON);
    const missing = await recoverStructuredPublishUniqueConflict(world.agenda, prepared.seeded.course.id, "absent");
    assert.equal(missing, null);
  } finally {
    world.close?.();
  }
});
