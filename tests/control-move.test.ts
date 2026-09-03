import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assignTeacherToCourse,
  assignTemporaryReplacement,
  createAnnualCourse,
  type AnnualCourseServiceDeps,
} from "../src/features/annual-courses/index.ts";
import {
  isMovableStructuredControlCard,
} from "../src/features/control-planning/index.ts";
import {
  CONTROL_COORDINATION_CONFIRM_CODE,
  TEST_ALERT_THRESHOLD,
} from "../src/features/evaluations/index.ts";
import {
  STRUCTURED_AGENDA_COMPAT_HOUR,
  STRUCTURED_CONTROL_MOVE_FORBIDDEN_REASON,
  STRUCTURED_CONTROL_MOVE_FREE_PLACEMENT_REASON,
  STRUCTURED_CONTROL_MOVE_NOT_STRUCTURED_REASON,
  STRUCTURED_CONTROL_MOVE_NOT_TEST_REASON,
  STRUCTURED_CONTROL_MOVE_YEAR_MISMATCH_REASON,
  STRUCTURED_PUBLISH_FORBIDDEN_REASON,
  STRUCTURED_PUBLISH_SESSION_GONE_REASON,
  STRUCTURED_PUBLISH_YEAR_ARCHIVED_REASON,
  moveStructuredControlToCourseSession,
  publishManualControlToAgenda,
  publishReferenceItemToAgenda,
  structuredControlMoveIdsFromBody,
  type StructuredPublishDeps,
} from "../src/features/course-publications/index.ts";
import { listComputedCourseSessions } from "../src/features/course-sessions/index.ts";
import { addItem, addSession, createEmptyPath } from "../src/features/pedagogical-path/index.ts";
import { structuredAgendaPatchGuard } from "../src/features/agenda/index.ts";
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
import type { SchoolYearStore } from "../src/lib/persistence/school-year-types.ts";
import type { SchoolYearRecord } from "../src/features/school-year/types.ts";
import type { AgendaStore } from "../src/lib/persistence/types.ts";
import type { RuntimeAgendaAdapterStore } from "../src/lib/persistence/runtime-agenda-types.ts";

function randomLetters(length: number) {
  const alphabet = "abcdefghijkmnpqrstuvwxyz";
  let value = "";
  for (let index = 0; index < length; index += 1) {
    value += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return value;
}

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

function yearsStub(status: SchoolYearRecord["status"] = "active"): SchoolYearStore {
  const previous: SchoolYearRecord = {
    id: "year-2026",
    label: "2026-2027",
    status: "archived",
    startsOn: "2026-08-01",
    endsOn: "2027-07-31",
    sourceFilename: null,
    importedAt: null,
    activatedAt: "2026-08-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  const year: SchoolYearRecord = {
    id: "year-2027",
    label: "2027-2028",
    status,
    startsOn: "2027-08-01",
    endsOn: "2028-07-31",
    sourceFilename: null,
    importedAt: null,
    activatedAt: status === "active" ? "2027-08-01T00:00:00.000Z" : null,
    createdAt: "2027-01-01T00:00:00.000Z",
  };
  const weeks2026 = mondayWeeks("2026-08-17", 16);
  const weeks2027 = mondayWeeks("2027-08-16", 16);
  return {
    listSchoolYears: async () => [previous, year],
    getActiveSchoolYear: async () => (status === "active" ? { ...year, weeks: weeks2027 } : null),
    getSchoolYearById: async (id: string) => {
      if (id === "year-2026") return { ...previous, weeks: weeks2026 };
      if (id === "year-2027") return { ...year, weeks: weeks2027 };
      return null;
    },
    listDayExceptions: async () => [],
  } as SchoolYearStore;
}

interface World {
  kind: "memory" | "sqlite";
  adapters: RuntimeAgendaAdapterStore;
  agenda: AgendaStore;
  catalog: ReturnType<typeof getMemorySchoolCatalogStore> | SqlSchoolCatalogStore;
  courses: MemoryAnnualCourseStore | SqlAnnualCourseStore;
  years: SchoolYearStore;
  teachers: ReturnType<typeof getMemoryTeacherAccountStore> | SqlTeacherAccountStore;
  schedules: MemoryCourseScheduleStore | SqlCourseScheduleStore;
  paths: MemoryPedagogicalPathStore | SqlPedagogicalPathStore;
  courseDeps: AnnualCourseServiceDeps;
  publishDeps: StructuredPublishDeps;
  close?: () => void;
}

async function memoryWorld(): Promise<World> {
  resetMemorySchoolCatalogStore();
  resetMemoryAnnualCourseStore();
  resetMemoryPedagogicalPathStore();
  resetMemoryTeacherAccountStore();
  resetMemoryLegacySchool();
  const catalog = getMemorySchoolCatalogStore();
  await catalog.ensureSeeded();
  const adapters = new MemoryRuntimeAgendaAdapterStore();
  const agenda = new MemoryAgendaStore([]);
  const courses = new MemoryAnnualCourseStore();
  const years = yearsStub();
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
    teachers,
    schedules,
    paths,
    courseDeps,
    publishDeps,
  };
}

async function sqliteWorld(): Promise<World> {
  const db = createNodeSqliteDatabase(":memory:");
  await applyMigrations(db);
  await db.exec(
    `INSERT OR IGNORE INTO school_years (id, label, status, starts_on, ends_on, created_at)
     VALUES
       ('year-2026', '2026-2027', 'archived', '2026-08-01', '2027-07-31', datetime('now')),
       ('year-2027', '2027-2028', 'active', '2027-08-01', '2028-07-31', datetime('now'))`,
  );
  const catalog = new SqlSchoolCatalogStore(db);
  await catalog.ensureSeeded();
  const adapters = new SqlRuntimeAgendaAdapterStore(db);
  const agenda = new SqlAgendaStore(db);
  const courses = new SqlAnnualCourseStore(db);
  const years = yearsStub();
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
    teachers,
    schedules,
    paths,
    courseDeps,
    publishDeps,
    close: () => db.close(),
  };
}

async function withWorlds(run: (world: World) => Promise<void>): Promise<void> {
  for (const factory of [memoryWorld, sqliteWorld]) {
    const world = await factory();
    try {
      await run(world);
    } finally {
      world.close?.();
    }
  }
}

async function addMondaySlots(world: World, annualCourseId: string, extraDayOfWeek?: number) {
  await world.schedules.createSlot({
    id: `slot-${annualCourseId}-p4`,
    annualCourseId,
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
    id: `slot-${annualCourseId}-p6`,
    annualCourseId,
    dayOfWeek: 1,
    periodStart: 6,
    periodEnd: 6,
    weekKind: "all",
    validFrom: null,
    validTo: null,
    createdAt: "2027-01-01T00:00:00.000Z",
    updatedAt: "2027-01-01T00:00:00.000Z",
  });
  if (extraDayOfWeek) {
    await world.schedules.createSlot({
      id: `slot-${annualCourseId}-d${extraDayOfWeek}`,
      annualCourseId,
      dayOfWeek: extraDayOfWeek,
      periodStart: 4,
      periodEnd: 4,
      weekKind: "all",
      validFrom: null,
      validTo: null,
      createdAt: "2027-01-01T00:00:00.000Z",
      updatedAt: "2027-01-01T00:00:00.000Z",
    });
  }
}

async function seedCourse(
  world: World,
  options: {
    classCode?: string;
    teacher?: { id: string };
    admin?: { id: string };
    extraDayOfWeek?: number;
  } = {},
) {
  const classCode = options.classCode ?? "MA2A";
  const profession = await world.catalog.createProfession({
    label: `Mécatronique ${Math.random().toString(36).slice(2, 6)}`,
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
  const schoolClass = await world.catalog.createClass({
    code: `${classCode}-${Math.random().toString(36).slice(2, 6)}`,
    label: classCode,
    schoolYearId: "year-2027",
    schoolYearLabel: "2027-2028",
    professionId: profession.id,
    trainingYear: 1,
    parallelCode: "A",
  });
  let teacher = options.teacher;
  if (!teacher) {
    const created = await world.teachers.createAccount({
      displayName: "François Martin",
      initials: `F${randomLetters(3)}`,
      teachingType: "TECHNICAL",
    });
    assert.equal(created.ok, true);
    if (!created.ok) throw new Error(created.reason);
    teacher = created.account;
  }
  let admin = options.admin;
  if (!admin) {
    const created = await world.teachers.createAccount({
      displayName: "Admin",
      initials: `A${randomLetters(3)}`,
      teachingType: "TECHNICAL",
      isAdmin: true,
    });
    assert.equal(created.ok, true);
    if (!created.ok) throw new Error(created.reason);
    admin = created.account;
  }
  const courseResult = await createAnnualCourse(world.courseDeps, {
    schoolYearId: "year-2027",
    classId: schoolClass.id,
    contextId: ctx.value.id,
  });
  assert.equal(courseResult.ok, true);
  if (!courseResult.ok) throw new Error(courseResult.reason);
  await assignTeacherToCourse(world.courseDeps, {
    annualCourseId: courseResult.value.id,
    teacherId: teacher.id,
    role: "PRIMARY",
    createdByAdminId: admin.id,
    validFrom: "2026-08-01",
  });
  await addMondaySlots(world, courseResult.value.id, options.extraDayOfWeek);
  return {
    schoolClass,
    teacher,
    admin,
    course: courseResult.value,
    context: ctx.value,
  };
}

async function sessionsFor(world: World, annualCourseId: string) {
  const sessions = await listComputedCourseSessions(world.publishDeps, {
    schoolYearId: "year-2027",
    annualCourseId,
  });
  assert.equal(sessions.ok, true);
  if (!sessions.ok) throw new Error(sessions.reason);
  assert.ok(sessions.value.length >= 2);
  return sessions.value;
}

async function publishTest(
  world: World,
  teacherId: string,
  annualCourseId: string,
  courseSessionKey: string,
  title: string,
  confirm = false,
) {
  const created = await publishManualControlToAgenda(world.publishDeps, {
    teacherId,
    annualCourseId,
    courseSessionKey,
    title,
    confirmCoordination: confirm,
  });
  assert.equal(created.ok, true, created.ok ? title : created.reason);
  if (!created.ok) throw new Error(created.reason);
  return created.item;
}

test("version 2.38.0 — déplacement structuré, pas de migration 0025", async () => {
  assert.equal(APP_VERSION, "2.39.0");
  assert.equal(TEST_ALERT_THRESHOLD, 3);
  assert.equal(SQL_MIGRATION_FILES.at(-1), "0024_structured_agenda_bridge.sql");
  assert.equal(SQL_MIGRATION_FILES.some((file) => file.startsWith("0025")), false);

  const parsed = structuredControlMoveIdsFromBody({
    annualCourseId: "ac-1",
    courseSessionKey: "key",
    confirmCoordination: true,
    teacherId: "forged",
    date: "2099-01-01",
    day: 4,
    schoolWeekNumber: 99,
    classroomId: "forged",
  });
  assert.equal(parsed.annualCourseId, "ac-1");
  assert.equal(parsed.courseSessionKey, "key");
  assert.equal(parsed.confirmCoordination, true);
  assert.equal(parsed.rejectedFreePlacement, true);
  assert.equal(structuredControlMoveIdsFromBody({ annualCourseId: "ac-1", courseSessionKey: "key" }).rejectedFreePlacement, false);
  assert.equal("teacherId" in parsed, false);
});

test("déplacement structuré — même id, champs dérivés, Memory + SQL", async () => {
  await withWorlds(async (world) => {
    const seeded = await seedCourse(world, { extraDayOfWeek: 2 });
    const [source, dest] = await sessionsFor(world, seeded.course.id);
    assert.notEqual(source!.key, dest!.key);

    const created = await publishTest(world, seeded.teacher.id, seeded.course.id, source!.key, "Contrôle injection");
    const sourceId = created.id;
    const sourceTitle = created.title;
    const sourceDetail = created.detail;
    const sourceAuthor = created.authorTeacherId;

    const moved = await moveStructuredControlToCourseSession(world.publishDeps, {
      teacherId: seeded.teacher.id,
      agendaItemId: created.id,
      annualCourseId: seeded.course.id,
      courseSessionKey: dest!.key,
    });
    assert.equal(moved.ok, true, moved.ok ? world.kind : moved.reason);
    if (!moved.ok) return;
    assert.equal(moved.moved, true);
    assert.equal(moved.item.id, sourceId);
    assert.equal(moved.item.title, sourceTitle);
    assert.equal(moved.item.detail, sourceDetail);
    assert.equal(moved.item.authorTeacherId, sourceAuthor);
    assert.equal(moved.item.type, "TEST");
    assert.equal(moved.item.annualCourseId, seeded.course.id);
    assert.equal(moved.item.courseSessionKey, dest!.key);
    assert.equal(moved.item.courseSessionDate, dest!.date);
    assert.equal(moved.item.schoolWeekNumber, dest!.schoolWeekNumber);
    assert.equal(moved.item.day, dest!.dayOfWeek - 1);
    assert.equal(moved.item.hour, STRUCTURED_AGENDA_COMPAT_HOUR);
    assert.equal(moved.item.schoolYearId, dest!.schoolYearId);
    assert.ok(moved.item.classroomId);
    assert.ok(moved.item.subjectId);

    const persisted = await world.agenda.findAgendaItem(sourceId);
    assert.ok(persisted);
    assert.equal(persisted?.courseSessionKey, dest!.key);
    assert.equal(persisted?.id, sourceId);
  });
});

test("déplacement — autre classe autorisée et séance exacte parmi plusieurs le même jour", async () => {
  await withWorlds(async (world) => {
    const first = await seedCourse(world, { classCode: "MA2A" });
    const second = await seedCourse(world, {
      classCode: "MA2B",
      teacher: first.teacher,
      admin: first.admin,
    });
    const sourceSessions = await sessionsFor(world, first.course.id);
    const destSessions = await sessionsFor(world, second.course.id);
    const source = sourceSessions[0]!;
    const destSameDay = destSessions.find((entry) => entry.date === source.date) ?? destSessions[0]!;
    assert.notEqual(destSameDay.key, source.key);

    const created = await publishTest(world, first.teacher.id, first.course.id, source.key, "Contrôle A");
    const moved = await moveStructuredControlToCourseSession(world.publishDeps, {
      teacherId: first.teacher.id,
      agendaItemId: created.id,
      annualCourseId: second.course.id,
      courseSessionKey: destSameDay.key,
    });
    assert.equal(moved.ok, true, moved.ok ? "" : moved.reason);
    if (!moved.ok) return;
    assert.equal(moved.item.id, created.id);
    assert.equal(moved.item.annualCourseId, second.course.id);
    assert.equal(moved.item.courseSessionKey, destSameDay.key);
    assert.notEqual(moved.item.classroomId, created.classroomId);
    assert.equal(moved.item.courseSessionDate, destSameDay.date);
  });
});

test("rejets — fausse séance, faux cours, date libre, TCA, année, auteur, type, non structuré", async () => {
  await withWorlds(async (world) => {
    const seeded = await seedCourse(world);
    const [source, dest] = await sessionsFor(world, seeded.course.id);
    const created = await publishTest(world, seeded.teacher.id, seeded.course.id, source!.key, "Contrôle");

    const fakeKey = await moveStructuredControlToCourseSession(world.publishDeps, {
      teacherId: seeded.teacher.id,
      agendaItemId: created.id,
      annualCourseId: seeded.course.id,
      courseSessionKey: "year-2027|missing|2099-01-01",
    });
    assert.equal(fakeKey.ok, false);
    if (!fakeKey.ok) {
      assert.equal(fakeKey.status, 409);
      assert.equal(fakeKey.reason, STRUCTURED_PUBLISH_SESSION_GONE_REASON);
    }

    const fakeCourse = await moveStructuredControlToCourseSession(world.publishDeps, {
      teacherId: seeded.teacher.id,
      agendaItemId: created.id,
      annualCourseId: "ac-inexistant",
      courseSessionKey: dest!.key,
    });
    assert.equal(fakeCourse.ok, false);
    if (!fakeCourse.ok) assert.equal(fakeCourse.status, 404);

    const free = structuredControlMoveIdsFromBody({
      date: "2099-01-01",
      day: 3,
      schoolWeekNumber: 12,
    });
    assert.equal(free.rejectedFreePlacement, true);
    assert.equal(free.annualCourseId, "");
    assert.equal(free.courseSessionKey, "");

    const stranger = await world.teachers.createAccount({
      displayName: "Inconnu",
      initials: `X${randomLetters(3)}`,
      teachingType: "TECHNICAL",
    });
    assert.equal(stranger.ok, true);
    if (!stranger.ok) return;
    const stolen = await moveStructuredControlToCourseSession(world.publishDeps, {
      teacherId: stranger.account.id,
      agendaItemId: created.id,
      annualCourseId: seeded.course.id,
      courseSessionKey: dest!.key,
    });
    assert.equal(stolen.ok, false);
    if (!stolen.ok) {
      assert.equal(stolen.status, 403);
      assert.equal(stolen.reason, STRUCTURED_CONTROL_MOVE_FORBIDDEN_REASON);
    }

    const replacement = await world.teachers.createAccount({
      displayName: "Remi",
      initials: `R${randomLetters(3)}`,
      teachingType: "TECHNICAL",
    });
    assert.equal(replacement.ok, true);
    if (!replacement.ok) return;
    await assignTemporaryReplacement(world.courseDeps, {
      annualCourseId: seeded.course.id,
      teacherId: replacement.account.id,
      createdByAdminId: seeded.admin.id,
      validFrom: source!.date,
      validTo: source!.date,
    });
    const replacementControl = await publishTest(
      world,
      replacement.account.id,
      seeded.course.id,
      source!.key,
      "Contrôle remplaçant",
    );
    const invalidTca = await moveStructuredControlToCourseSession(world.publishDeps, {
      teacherId: replacement.account.id,
      agendaItemId: replacementControl.id,
      annualCourseId: seeded.course.id,
      courseSessionKey: dest!.key,
    });
    assert.equal(invalidTca.ok, false);
    if (!invalidTca.ok) {
      assert.equal(invalidTca.status, 403);
      assert.equal(invalidTca.reason, STRUCTURED_PUBLISH_FORBIDDEN_REASON);
    }

    let path = createEmptyPath({
      id: `path-${seeded.context.id}`,
      contextId: seeded.context.id,
      createdAt: "2027-01-01T00:00:00.000Z",
    });
    const sessionAdded = addSession(path, { id: "rs-1", label: "Intro" });
    assert.equal(sessionAdded.ok, true);
    if (!sessionAdded.ok) return;
    path = sessionAdded.value;
    const homeworkAdded = addItem(path, "rs-1", { id: "ref-hw", type: "HOMEWORK", title: "Devoir" });
    assert.equal(homeworkAdded.ok, true);
    if (!homeworkAdded.ok) return;
    path = homeworkAdded.value;
    await world.paths.savePath(path);
    const homework = await publishReferenceItemToAgenda(world.publishDeps, {
      teacherId: seeded.teacher.id,
      annualCourseId: seeded.course.id,
      courseSessionKey: source!.key,
      referenceItemId: "ref-hw",
    });
    assert.equal(homework.ok, true);
    if (!homework.ok) return;
    const notTest = await moveStructuredControlToCourseSession(world.publishDeps, {
      teacherId: seeded.teacher.id,
      agendaItemId: homework.item.id,
      annualCourseId: seeded.course.id,
      courseSessionKey: dest!.key,
    });
    assert.equal(notTest.ok, false);
    if (!notTest.ok) {
      assert.equal(notTest.status, 400);
      assert.equal(notTest.reason, STRUCTURED_CONTROL_MOVE_NOT_TEST_REASON);
    }

    const unstructured = await world.agenda.createAgendaItem({
      classroomId: created.classroomId,
      subjectId: created.subjectId,
      authorTeacherId: seeded.teacher.id,
      day: created.day,
      hour: 8,
      weekOffset: 0,
      schoolWeekNumber: created.schoolWeekNumber,
      type: "TEST",
      title: "Contrôle libre",
      detail: "",
    });
    const invalidStructured = await moveStructuredControlToCourseSession(world.publishDeps, {
      teacherId: seeded.teacher.id,
      agendaItemId: unstructured.id,
      annualCourseId: seeded.course.id,
      courseSessionKey: dest!.key,
    });
    assert.equal(invalidStructured.ok, false);
    if (!invalidStructured.ok) {
      assert.equal(invalidStructured.status, 400);
      assert.equal(invalidStructured.reason, STRUCTURED_CONTROL_MOVE_NOT_STRUCTURED_REASON);
    }
  });
});

test("rejet — année archivée, no-op même séance", async () => {
  await withWorlds(async (world) => {
    const seeded = await seedCourse(world);
    const [source, dest] = await sessionsFor(world, seeded.course.id);
    const created = await publishTest(world, seeded.teacher.id, seeded.course.id, source!.key, "Contrôle");

    const noop = await moveStructuredControlToCourseSession(world.publishDeps, {
      teacherId: seeded.teacher.id,
      agendaItemId: created.id,
      annualCourseId: seeded.course.id,
      courseSessionKey: source!.key,
    });
    assert.equal(noop.ok, true);
    if (noop.ok) {
      assert.equal(noop.moved, false);
      assert.equal(noop.item.id, created.id);
      assert.equal(noop.item.courseSessionKey, source!.key);
    }

    world.publishDeps.years = yearsStub("archived");
    const archived = await moveStructuredControlToCourseSession(world.publishDeps, {
      teacherId: seeded.teacher.id,
      agendaItemId: created.id,
      annualCourseId: seeded.course.id,
      courseSessionKey: dest!.key,
    });
    assert.equal(archived.ok, false);
    if (!archived.ok) {
      assert.equal(archived.status, 409);
      assert.equal(archived.reason, STRUCTURED_PUBLISH_YEAR_ARCHIVED_REASON);
    }
  });
});

test("rejet — aucun déplacement N → N+1, données source inchangées", async () => {
  await withWorlds(async (world) => {
    const seeded = await seedCourse(world);
    const [source, dest] = await sessionsFor(world, seeded.course.id);
    assert.notEqual(source!.key, dest!.key);
    const created = await publishTest(world, seeded.teacher.id, seeded.course.id, source!.key, "Contrôle N");
    const previousYearItem = { ...created, schoolYearId: "year-2026" };
    await world.agenda.replaceAllItems(
      (await world.agenda.exportAllItems()).map((item) => (item.id === created.id ? previousYearItem : item)),
    );
    const before = await world.agenda.findAgendaItem(created.id);
    assert.ok(before);
    assert.equal(before?.schoolYearId, "year-2026");
    assert.equal(before?.annualCourseId, created.annualCourseId);
    assert.equal(before?.courseSessionKey, source!.key);

    const refused = await moveStructuredControlToCourseSession(world.publishDeps, {
      teacherId: seeded.teacher.id,
      agendaItemId: created.id,
      annualCourseId: seeded.course.id,
      courseSessionKey: dest!.key,
    });
    assert.equal(refused.ok, false);
    if (!refused.ok) {
      assert.equal(refused.status, 409);
      assert.equal(refused.reason, STRUCTURED_CONTROL_MOVE_YEAR_MISMATCH_REASON);
    }

    const after = await world.agenda.findAgendaItem(created.id);
    assert.deepEqual(after, before);
    assert.equal(after?.id, created.id);
    assert.equal(after?.annualCourseId, created.annualCourseId);
    assert.equal(after?.courseSessionKey, source!.key);
    assert.equal(after?.courseSessionDate, source!.date);
    assert.equal(after?.schoolYearId, "year-2026");
    assert.equal(after?.title, "Contrôle N");
    assert.equal(after?.detail, created.detail);
    assert.equal(after?.authorTeacherId, seeded.teacher.id);
    assert.equal(after?.type, "TEST");
    assert.equal(after?.classroomId, created.classroomId);
    assert.equal(after?.subjectId, created.subjectId);
    assert.equal(after?.schoolWeekNumber, created.schoolWeekNumber);
    assert.equal(after?.day, created.day);

    const unscoped = { ...previousYearItem, schoolYearId: null };
    await world.agenda.replaceAllItems(
      (await world.agenda.exportAllItems()).map((item) => (item.id === created.id ? unscoped : item)),
    );
    const missingYear = await moveStructuredControlToCourseSession(world.publishDeps, {
      teacherId: seeded.teacher.id,
      agendaItemId: created.id,
      annualCourseId: seeded.course.id,
      courseSessionKey: dest!.key,
    });
    assert.equal(missingYear.ok, false);
    if (!missingYear.ok) {
      assert.equal(missingYear.status, 409);
      assert.equal(missingYear.reason, STRUCTURED_CONTROL_MOVE_YEAR_MISMATCH_REASON);
    }
    const stillUnscoped = await world.agenda.findAgendaItem(created.id);
    assert.equal(stillUnscoped?.schoolYearId, null);
    assert.equal(stillUnscoped?.courseSessionKey, source!.key);
    assert.equal(stillUnscoped?.id, created.id);
  });
});

test("coordination destination — classe cible seule, exclusion source, confirmation puis acceptation", async () => {
  await withWorlds(async (world) => {
    const first = await seedCourse(world, { classCode: "MA2A" });
    const other = await seedCourse(world, { classCode: "MA2B" });
    const firstSessions = await sessionsFor(world, first.course.id);
    const otherSessions = await sessionsFor(world, other.course.id);
    const source = firstSessions[0]!;
    const dest = firstSessions[1]!;
    const otherSameDay = otherSessions.find((entry) => entry.date === dest.date) ?? otherSessions[1]!;

    await publishTest(world, first.teacher.id, first.course.id, dest.key, "Déjà 1");
    await publishTest(world, first.teacher.id, first.course.id, dest.key, "Déjà 2");
    await publishTest(world, other.teacher.id, other.course.id, otherSameDay.key, "Autre classe");

    const moving = await publishTest(world, first.teacher.id, first.course.id, source.key, "À déplacer");
    const blocked = await moveStructuredControlToCourseSession(world.publishDeps, {
      teacherId: first.teacher.id,
      agendaItemId: moving.id,
      annualCourseId: first.course.id,
      courseSessionKey: dest.key,
    });
    assert.equal(blocked.ok, false);
    if (!blocked.ok) {
      assert.equal(blocked.status, 409);
      assert.equal(blocked.code, CONTROL_COORDINATION_CONFIRM_CODE);
      assert.equal(blocked.coordination?.classDayCount, 2);
      assert.ok(!(blocked.coordination?.classDayControls ?? []).some((entry) => entry.agendaItemId === moving.id));
      assert.ok(!(blocked.coordination?.classDayControls ?? []).some((entry) => entry.title === "Autre classe"));
      assert.ok((blocked.coordination?.teacherWeekCount ?? 0) >= 2);
    }
    const stillSource = await world.agenda.findAgendaItem(moving.id);
    assert.equal(stillSource?.courseSessionKey, source.key);

    const confirmed = await moveStructuredControlToCourseSession(world.publishDeps, {
      teacherId: first.teacher.id,
      agendaItemId: moving.id,
      annualCourseId: first.course.id,
      courseSessionKey: dest.key,
      confirmCoordination: true,
    });
    assert.equal(confirmed.ok, true, confirmed.ok ? "" : confirmed.reason);
    if (confirmed.ok) {
      assert.equal(confirmed.item.id, moving.id);
      assert.equal(confirmed.item.courseSessionKey, dest.key);
      assert.equal(confirmed.coordination?.classDayCount, 3);
      assert.ok((confirmed.coordination?.teacherWeekControls ?? []).some((entry) => entry.agendaItemId === moving.id));
    }
  });
});

test("coordination — exclusion si le contrôle est déjà le même jour / même classe", async () => {
  await withWorlds(async (world) => {
    const seeded = await seedCourse(world, { extraDayOfWeek: 2 });
    const branches = await world.catalog.listBranches();
    const otherBranch =
      branches.find((entry) => entry.id !== seeded.context.branchId && entry.label !== "Moteur") ??
      branches.find((entry) => entry.id !== seeded.context.branchId);
    assert.ok(otherBranch);
    await world.catalog.updateBranch(otherBranch!.id, { teachingType: "TECHNICAL" });
    const ctx = await world.catalog.createContext({
      professionId: seeded.schoolClass.professionId ?? "",
      trainingYear: 1,
      branchId: otherBranch!.id,
    });
    assert.equal(ctx.ok, true);
    if (!ctx.ok) return;
    const secondCourse = await createAnnualCourse(world.courseDeps, {
      schoolYearId: "year-2027",
      classId: seeded.schoolClass.id,
      contextId: ctx.value.id,
    });
    assert.equal(secondCourse.ok, true, secondCourse.ok ? "" : secondCourse.reason);
    if (!secondCourse.ok) return;
    await assignTeacherToCourse(world.courseDeps, {
      annualCourseId: secondCourse.value.id,
      teacherId: seeded.teacher.id,
      role: "PRIMARY",
      createdByAdminId: seeded.admin.id,
      validFrom: "2026-08-01",
    });
    await addMondaySlots(world, secondCourse.value.id);

    const sourceSessions = await sessionsFor(world, seeded.course.id);
    const destSessions = await sessionsFor(world, secondCourse.value.id);
    const source = sourceSessions[0]!;
    const destSameDay = destSessions.find((entry) => entry.date === source.date);
    assert.ok(destSameDay);
    assert.notEqual(destSameDay!.key, source.key);

    await publishTest(world, seeded.teacher.id, secondCourse.value.id, destSameDay!.key, "Déjà sur la destination");
    const moving = await publishTest(world, seeded.teacher.id, seeded.course.id, source.key, "Même jour");
    const moved = await moveStructuredControlToCourseSession(world.publishDeps, {
      teacherId: seeded.teacher.id,
      agendaItemId: moving.id,
      annualCourseId: secondCourse.value.id,
      courseSessionKey: destSameDay!.key,
    });
    assert.equal(moved.ok, true, moved.ok ? "" : moved.reason);
    if (moved.ok) {
      assert.equal(moved.item.id, moving.id);
      assert.equal(moved.item.courseSessionKey, destSameDay!.key);
      assert.equal(moved.item.annualCourseId, secondCourse.value.id);
      assert.equal(moved.coordination?.classDayCount, 2);
    }

    const tuesday = sourceSessions.find((entry) => entry.dayOfWeek === 2 && entry.schoolWeekNumber === source.schoolWeekNumber);
    if (tuesday) {
      const later = await moveStructuredControlToCourseSession(world.publishDeps, {
        teacherId: seeded.teacher.id,
        agendaItemId: moving.id,
        annualCourseId: seeded.course.id,
        courseSessionKey: tuesday.key,
      });
      assert.equal(later.ok, true, later.ok ? "" : later.reason);
    }
  });
});

test("cartes déplaçables — seulement tes contrôles structurés", () => {
  assert.equal(
    isMovableStructuredControlCard(
      { isOwn: true, annualCourseId: "ac", courseSessionKey: "key" },
      true,
    ),
    true,
  );
  assert.equal(
    isMovableStructuredControlCard(
      { isOwn: false, annualCourseId: "ac", courseSessionKey: "key" },
      true,
    ),
    false,
  );
  assert.equal(
    isMovableStructuredControlCard(
      { isOwn: true, annualCourseId: null, courseSessionKey: null },
      true,
    ),
    false,
  );
  assert.equal(
    isMovableStructuredControlCard(
      { isOwn: true, annualCourseId: "ac", courseSessionKey: "key" },
      false,
    ),
    false,
  );
});

test("PATCH générique inchangé — déplacement via API dédiée seulement", async () => {
  const [moveRoute, patchRoute, panel, service] = await Promise.all([
    readFile(new URL("../web/app/api/teacher/controls/[agendaItemId]/move/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/app/api/agenda/[id]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/app/components/control-planning-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/course-publications/service.ts", import.meta.url), "utf8"),
  ]);
  assert.match(moveRoute, /moveStructuredControlToCourseSession/);
  assert.match(moveRoute, /structuredControlMoveIdsFromBody/);
  assert.match(moveRoute, /rejectedFreePlacement/);
  assert.match(patchRoute, /structuredAgendaPatchGuard/);
  assert.match(patchRoute, /title: body.title/);
  assert.doesNotMatch(patchRoute, /moveStructuredControlPlacement/);
  assert.match(panel, /moveTeacherControlApi/);
  assert.match(panel, /data-control-move/);
  assert.match(panel, /application\/x-campus-control/);
  assert.match(panel, /Déplacer/);
  assert.match(service, /moveStructuredControlPlacement/);
  assert.match(service, /excludeItemId/);
  assert.match(service, /STRUCTURED_CONTROL_MOVE_YEAR_MISMATCH_REASON/);
  assert.match(service, /item\.schoolYearId/);
  assert.match(service, /context\.courseSession\.schoolYearId/);
  assert.doesNotMatch(service, /CREATE TABLE/);

  const item = {
    id: 1,
    classroomId: "c",
    subjectId: "s",
    authorTeacherId: "t",
    day: 0,
    hour: 8,
    weekOffset: 0,
    schoolWeekNumber: 1,
    type: "TEST" as const,
    title: "Contrôle",
    detail: "x",
    annualCourseId: "ac",
    courseSessionKey: "key",
  };
  assert.equal(structuredAgendaPatchGuard(item, { day: 2 }).ok, false);
  assert.equal(structuredAgendaPatchGuard(item, { courseSessionKey: "other" }).ok, false);
  assert.equal(structuredAgendaPatchGuard(item, { date: "2099-01-01" } as Record<string, unknown>).ok, true);
});
