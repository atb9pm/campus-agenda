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
  CONTROL_COORDINATION_CONFIRM_CODE,
  TEST_ALERT_THRESHOLD,
} from "../src/features/evaluations/index.ts";
import {
  STRUCTURED_AGENDA_COMPAT_HOUR,
  STRUCTURED_PUBLISH_FORBIDDEN_REASON,
  STRUCTURED_PUBLISH_SESSION_GONE_REASON,
  STRUCTURED_PUBLISH_YEAR_ARCHIVED_REASON,
  STRUCTURED_PUBLISH_YEAR_DRAFT_REASON,
  manualControlIdsFromBody,
  publishManualControlToAgenda,
  publishReferenceItemToAgenda,
  type StructuredPublishDeps,
} from "../src/features/course-publications/index.ts";
import { listComputedCourseSessions } from "../src/features/course-sessions/index.ts";
import { addItem, addSession, createEmptyPath } from "../src/features/pedagogical-path/index.ts";
import { APP_VERSION } from "../src/lib/app-version.ts";
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
import type { SchoolDayException } from "../src/features/school-days/types.ts";
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

function yearsStub(exceptions: SchoolDayException[] = [], status: SchoolYearRecord["status"] = "active"): SchoolYearStore {
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
  const weeks2027 = mondayWeeks("2027-08-16", 16);
  return {
    listSchoolYears: async () => [year],
    getActiveSchoolYear: async () => (status === "active" ? { ...year, weeks: weeks2027 } : null),
    getSchoolYearById: async (id: string) => (id === "year-2027" ? { ...year, weeks: weeks2027 } : null),
    listDayExceptions: async () => exceptions,
  } as SchoolYearStore;
}

interface World {
  adapters: RuntimeAgendaAdapterStore;
  agenda: AgendaStore;
  catalog: SqlSchoolCatalogStore;
  courses: SqlAnnualCourseStore;
  years: SchoolYearStore;
  teachers: SqlTeacherAccountStore;
  schedules: SqlCourseScheduleStore;
  paths: SqlPedagogicalPathStore;
  courseDeps: AnnualCourseServiceDeps;
  publishDeps: StructuredPublishDeps;
  close: () => void;
}

async function sqliteWorld(status: SchoolYearRecord["status"] = "active"): Promise<World> {
  const db = createNodeSqliteDatabase(":memory:");
  await applyMigrations(db);
  await db.exec(
    `INSERT OR IGNORE INTO school_years (id, label, status, starts_on, ends_on, created_at)
     VALUES ('year-2027', '2027-2028', '${status}', '2027-08-01', '2028-07-31', datetime('now'))`,
  );
  const catalog = new SqlSchoolCatalogStore(db);
  await catalog.ensureSeeded();
  const adapters = new SqlRuntimeAgendaAdapterStore(db);
  const agenda = new SqlAgendaStore(db);
  const courses = new SqlAnnualCourseStore(db);
  const years = yearsStub([], status);
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

async function withSqliteWorld(
  run: (world: World) => Promise<void>,
  status: SchoolYearRecord["status"] = "active",
): Promise<void> {
  const world = await sqliteWorld(status);
  try {
    await run(world);
  } finally {
    world.close();
  }
}

async function seedCourse(world: World, classCode = "MA2A") {
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
  const teacher = await world.teachers.createAccount({
    displayName: "François Martin",
    initials: `F${randomLetters(3)}`,
    teachingType: "TECHNICAL",
  });
  assert.equal(teacher.ok, true);
  if (!teacher.ok) throw new Error(teacher.reason);
  const courseResult = await createAnnualCourse(world.courseDeps, {
    schoolYearId: "year-2027",
    classId: schoolClass.id,
    contextId: ctx.value.id,
  });
  assert.equal(courseResult.ok, true);
  if (!courseResult.ok) throw new Error(courseResult.reason);
  const admin = await world.teachers.createAccount({
    displayName: "Admin",
    initials: `A${randomLetters(3)}`,
    teachingType: "TECHNICAL",
    isAdmin: true,
  });
  assert.equal(admin.ok, true);
  if (!admin.ok) throw new Error(admin.reason);
  await assignTeacherToCourse(world.courseDeps, {
    annualCourseId: courseResult.value.id,
    teacherId: teacher.account.id,
    role: "PRIMARY",
    createdByAdminId: admin.account.id,
    validFrom: "2026-08-01",
  });
  await world.schedules.createSlot({
    id: `slot-${courseResult.value.id}-p4`,
    annualCourseId: courseResult.value.id,
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
    id: `slot-${courseResult.value.id}-p6`,
    annualCourseId: courseResult.value.id,
    dayOfWeek: 1,
    periodStart: 6,
    periodEnd: 6,
    weekKind: "all",
    validFrom: null,
    validTo: null,
    createdAt: "2027-01-01T00:00:00.000Z",
    updatedAt: "2027-01-01T00:00:00.000Z",
  });
  return {
    profession,
    moteur,
    context: ctx.value,
    schoolClass,
    teacher: teacher.account,
    admin: admin.account,
    course: courseResult.value,
  };
}

async function firstSession(world: World, annualCourseId: string) {
  const sessions = await listComputedCourseSessions(world.publishDeps, {
    schoolYearId: "year-2027",
    annualCourseId,
  });
  assert.equal(sessions.ok, true);
  if (!sessions.ok) throw new Error(sessions.reason);
  const first = sessions.value[0];
  assert.ok(first);
  return first;
}

test("version 2.32.0 — publication manuelle TEST, migration 0024", async () => {
  assert.equal(APP_VERSION, "2.36.0");
  assert.equal(TEST_ALERT_THRESHOLD, 3);
  assert.equal(SQL_MIGRATION_FILES.at(-1), "0024_structured_agenda_bridge.sql");
  assert.equal(SQL_MIGRATION_FILES.some((file) => file.startsWith("0025")), false);
  const parsed = manualControlIdsFromBody({
    annualCourseId: "ac-1",
    courseSessionKey: "key",
    title: "Contrôle injection",
    detail: "Chapitres 3 à 5",
    teacherId: "forged",
    classroomId: "forged",
    subjectId: "forged",
    date: "2099-01-01",
    day: 4,
    week: 99,
    type: "HOMEWORK",
    authorTeacherId: "forged",
    confirmCoordination: true,
  });
  assert.equal(parsed.title, "Contrôle injection");
  assert.equal(parsed.confirmCoordination, true);
  assert.equal("teacherId" in parsed, false);
  assert.equal("type" in parsed, false);
});

test("publication manuelle — TEST structuré, TCA à la date, P4+P6 une séance", async () => {
  await withSqliteWorld(async (world) => {
  const seeded = await seedCourse(world);
  const session = await firstSession(world, seeded.course.id);
  assert.equal(session.segments.length, 2);
  assert.equal(session.key, `year-2027|${seeded.course.id}|${session.date}`);

  const emptyTitle = await publishManualControlToAgenda(world.publishDeps, {
    teacherId: seeded.teacher.id,
    annualCourseId: seeded.course.id,
    courseSessionKey: session.key,
    title: "   ",
  });
  assert.equal(emptyTitle.ok, false);
  if (!emptyTitle.ok) assert.equal(emptyTitle.status, 400);

  const created = await publishManualControlToAgenda(world.publishDeps, {
    teacherId: seeded.teacher.id,
    annualCourseId: seeded.course.id,
    courseSessionKey: session.key,
    title: "Contrôle injection",
    detail: "Chapitres 3 à 5",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.equal(created.item.type, "TEST");
  assert.equal(created.item.title, "Contrôle injection");
  assert.equal(created.item.detail, "Chapitres 3 à 5");
  assert.equal(created.item.authorTeacherId, seeded.teacher.id);
  assert.equal(created.item.hour, STRUCTURED_AGENDA_COMPAT_HOUR);
  assert.equal(created.item.annualCourseId, seeded.course.id);
  assert.equal(created.item.courseSessionKey, session.key);
  assert.equal(created.item.courseSessionDate, session.date);
  assert.equal(created.item.referenceSessionId, null);
  assert.equal(created.item.referenceItemId, null);
  assert.equal(created.item.day, session.dayOfWeek - 1);
  assert.equal(created.item.schoolWeekNumber, session.schoolWeekNumber);
  assert.ok(created.item.classroomId);
  assert.ok(created.item.subjectId);

  const secondSameSession = await publishManualControlToAgenda(world.publishDeps, {
    teacherId: seeded.teacher.id,
    annualCourseId: seeded.course.id,
    courseSessionKey: session.key,
    title: "Contrôle rattrapage",
  });
  assert.equal(secondSameSession.ok, true);

  const missing = await publishManualControlToAgenda(world.publishDeps, {
    teacherId: seeded.teacher.id,
    annualCourseId: seeded.course.id,
    courseSessionKey: "year-2027|missing|2099-01-01",
    title: "Hors séance",
  });
  assert.equal(missing.ok, false);
  if (!missing.ok) {
    assert.equal(missing.status, 409);
    assert.equal(missing.reason, STRUCTURED_PUBLISH_SESSION_GONE_REASON);
  }

  const stranger = await world.teachers.createAccount({
    displayName: "Inconnu",
    initials: `X${randomLetters(3)}`,
    teachingType: "TECHNICAL",
  });
  assert.equal(stranger.ok, true);
  if (!stranger.ok) return;
  const forbidden = await publishManualControlToAgenda(world.publishDeps, {
    teacherId: stranger.account.id,
    annualCourseId: seeded.course.id,
    courseSessionKey: session.key,
    title: "Usurpation",
  });
  assert.equal(forbidden.ok, false);
  if (!forbidden.ok) {
    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.reason, STRUCTURED_PUBLISH_FORBIDDEN_REASON);
  }
  });
});

test("publication manuelle — année draft/archivée refusée", async () => {
  for (const status of ["draft", "archived"] as const) {
    await withSqliteWorld(async (world) => {
      const seeded = await seedCourse(world);
      const session = await firstSession(world, seeded.course.id);
      world.publishDeps.years = yearsStub([], status);
      const result = await publishManualControlToAgenda(world.publishDeps, {
        teacherId: seeded.teacher.id,
        annualCourseId: seeded.course.id,
        courseSessionKey: session.key,
        title: "Contrôle",
      });
      assert.equal(result.ok, false, status);
      if (!result.ok) {
        assert.equal(result.status, 409);
        assert.equal(
          result.reason,
          status === "draft" ? STRUCTURED_PUBLISH_YEAR_DRAFT_REASON : STRUCTURED_PUBLISH_YEAR_ARCHIVED_REASON,
        );
      }
    });
  }
});

test("publication manuelle — classe inactive refusée", async () => {
  await withSqliteWorld(async (world) => {
    const seeded = await seedCourse(world);
    const session = await firstSession(world, seeded.course.id);
    await world.catalog.updateClass(seeded.schoolClass.id, { isActive: false });
    const result = await publishManualControlToAgenda(world.publishDeps, {
      teacherId: seeded.teacher.id,
      annualCourseId: seeded.course.id,
      courseSessionKey: session.key,
      title: "Contrôle",
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 409);
      assert.match(result.reason, /inactive/i);
    }
  });
});

test("coordination — 3e contrôle 409 puis confirmation 201, autres types et classes exclus", async () => {
  await withSqliteWorld(async (world) => {
  const seeded = await seedCourse(world, "MA2A");
  const other = await seedCourse(world, "MA2B");
  const session = await firstSession(world, seeded.course.id);
  const otherSession = await firstSession(world, other.course.id);

  const first = await publishManualControlToAgenda(world.publishDeps, {
    teacherId: seeded.teacher.id,
    annualCourseId: seeded.course.id,
    courseSessionKey: session.key,
    title: "Contrôle 1",
  });
  assert.equal(first.ok, true);
  const second = await publishManualControlToAgenda(world.publishDeps, {
    teacherId: seeded.teacher.id,
    annualCourseId: seeded.course.id,
    courseSessionKey: session.key,
    title: "Contrôle 2",
  });
  assert.equal(second.ok, true);

  const otherClass = await publishManualControlToAgenda(world.publishDeps, {
    teacherId: other.teacher.id,
    annualCourseId: other.course.id,
    courseSessionKey: otherSession.key,
    title: "Contrôle autre classe",
  });
  assert.equal(otherClass.ok, true);

  const blocked = await publishManualControlToAgenda(world.publishDeps, {
    teacherId: seeded.teacher.id,
    annualCourseId: seeded.course.id,
    courseSessionKey: session.key,
    title: "Contrôle 3",
    confirmCoordination: false,
  });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) {
    assert.equal(blocked.status, 409);
    assert.equal(blocked.code, CONTROL_COORDINATION_CONFIRM_CODE);
    assert.equal(blocked.coordination?.classDayCount, 2);
    assert.ok((blocked.coordination?.teacherWeekCount ?? 0) >= 2);
  }
  const afterBlock = await world.agenda.listAgendaItems(
    first.ok ? first.item.classroomId : "",
  );
  assert.equal(afterBlock.filter((item) => item.title === "Contrôle 3").length, 0);

  const confirmed = await publishManualControlToAgenda(world.publishDeps, {
    teacherId: seeded.teacher.id,
    annualCourseId: seeded.course.id,
    courseSessionKey: session.key,
    title: "Contrôle 3",
    confirmCoordination: true,
  });
  assert.equal(confirmed.ok, true);
  if (confirmed.ok) {
    assert.equal(confirmed.item.title, "Contrôle 3");
    assert.equal(confirmed.coordination?.classDayCount, 3);
  }
  });
});

test("CourseTimeline TEST — même coordination, HOMEWORK non concerné", async () => {
  await withSqliteWorld(async (world) => {
  const seeded = await seedCourse(world);
  const session = await firstSession(world, seeded.course.id);
  let path = createEmptyPath({
    id: `path-${seeded.context.id}`,
    contextId: seeded.context.id,
    createdAt: "2027-01-01T00:00:00.000Z",
  });
  const sessionAdded = addSession(path, { id: "rs-1", label: "Intro" });
  assert.equal(sessionAdded.ok, true);
  if (!sessionAdded.ok) return;
  path = sessionAdded.value;
  for (const item of [
    { id: "ref-hw", type: "HOMEWORK" as const, title: "Devoir" },
    { id: "ref-t1", type: "TEST" as const, title: "Contrôle A" },
    { id: "ref-t2", type: "TEST" as const, title: "Contrôle B" },
    { id: "ref-t3", type: "TEST" as const, title: "Contrôle C" },
    { id: "ref-info", type: "INFORMATION" as const, title: "Info" },
  ]) {
    const added = addItem(path, "rs-1", item);
    assert.equal(added.ok, true);
    if (!added.ok) return;
    path = added.value;
  }
  await world.paths.savePath(path);

  const homework = await publishReferenceItemToAgenda(world.publishDeps, {
    teacherId: seeded.teacher.id,
    annualCourseId: seeded.course.id,
    courseSessionKey: session.key,
    referenceItemId: "ref-hw",
  });
  assert.equal(homework.ok, true);

  const testA = await publishReferenceItemToAgenda(world.publishDeps, {
    teacherId: seeded.teacher.id,
    annualCourseId: seeded.course.id,
    courseSessionKey: session.key,
    referenceItemId: "ref-t1",
  });
  assert.equal(testA.ok, true);
  const testB = await publishReferenceItemToAgenda(world.publishDeps, {
    teacherId: seeded.teacher.id,
    annualCourseId: seeded.course.id,
    courseSessionKey: session.key,
    referenceItemId: "ref-t2",
  });
  assert.equal(testB.ok, true);

  const blocked = await publishReferenceItemToAgenda(world.publishDeps, {
    teacherId: seeded.teacher.id,
    annualCourseId: seeded.course.id,
    courseSessionKey: session.key,
    referenceItemId: "ref-t3",
  });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) {
    assert.equal(blocked.status, 409);
    assert.equal(blocked.code, CONTROL_COORDINATION_CONFIRM_CODE);
  }

  const confirmed = await publishReferenceItemToAgenda(world.publishDeps, {
    teacherId: seeded.teacher.id,
    annualCourseId: seeded.course.id,
    courseSessionKey: session.key,
    referenceItemId: "ref-t3",
    confirmCoordination: true,
  });
  assert.equal(confirmed.ok, true);

  const info = await publishReferenceItemToAgenda(world.publishDeps, {
    teacherId: seeded.teacher.id,
    annualCourseId: seeded.course.id,
    courseSessionKey: session.key,
    referenceItemId: "ref-info",
  });
  assert.equal(info.ok, true);
  });
});

test("sources — POST contrôles, coordination agenda et timeline, TCA à la date", async () => {
  const [createRoute, agenda, publications, access, service] = await Promise.all([
    readFile(new URL("../web/app/api/teacher/controls/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/app/api/agenda/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/app/api/teacher/course-publications/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/agenda-bridge/access.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/course-publications/service.ts", import.meta.url), "utf8"),
  ]);
  assert.match(createRoute, /publishManualControlToAgenda/);
  assert.match(createRoute, /auth\.session!.teacherId/);
  assert.match(agenda, /CONTROL_COORDINATION_CONFIRM_CODE/);
  assert.match(agenda, /type === "TEST"/);
  assert.match(publications, /parseConfirmCoordination/);
  assert.match(access, /assignmentInstantForSessionDate/);
  assert.match(service, /assignmentInstantForSessionDate\(courseSession\.date\)/);
  assert.match(service, /type: "TEST"/);
  assert.match(service, /referenceSessionId: null/);
  assert.match(service, /referenceItemId: null/);
  assert.doesNotMatch(service, /CREATE TABLE/);
});

test("remplacement hors période — aucune publication", async () => {
  await withSqliteWorld(async (world) => {
  const seeded = await seedCourse(world);
  const session = await firstSession(world, seeded.course.id);
  const sessions = await listComputedCourseSessions(world.publishDeps, {
    schoolYearId: "year-2027",
    annualCourseId: seeded.course.id,
  });
  assert.equal(sessions.ok, true);
  if (!sessions.ok) return;
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
    validFrom: session.date,
    validTo: session.date,
  });
  const ok = await publishManualControlToAgenda(world.publishDeps, {
    teacherId: replacement.account.id,
    annualCourseId: seeded.course.id,
    courseSessionKey: session.key,
    title: "Contrôle remplaçant",
  });
  assert.equal(ok.ok, true);
  const later = sessions.value[1];
  if (later) {
    const denied = await publishManualControlToAgenda(world.publishDeps, {
      teacherId: replacement.account.id,
      annualCourseId: seeded.course.id,
      courseSessionKey: later.key,
      title: "Hors période",
    });
    assert.equal(denied.ok, false);
    if (!denied.ok) assert.equal(denied.status, 403);
  }
  });
});
