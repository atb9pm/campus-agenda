import assert from "node:assert/strict";
import test from "node:test";

import {
  contextBranchForCourse,
  ensureRuntimeSubjectForAnnualCourse,
  runtimeClassroomIdForSchoolClass,
  runtimeSubjectIdForAnnualCourse,
} from "../src/features/agenda-bridge/index.ts";
import {
  assignTeacherToCourse,
  createAnnualCourse,
  type AnnualCourseServiceDeps,
} from "../src/features/annual-courses/index.ts";
import {
  publishManualControlToAgenda,
  type StructuredPublishDeps,
} from "../src/features/course-publications/index.ts";
import { listComputedCourseSessions } from "../src/features/course-sessions/index.ts";
import {
  exportTeacherNotebookPdf,
  formatNotebookExportCoverage,
  type NotebookExportServiceDeps,
} from "../src/features/notebook-export/index.ts";
import type { SchoolYearRecord } from "../src/features/school-year/types.ts";
import { openPdfDocument } from "../src/lib/pdf/open-pdf-document.ts";
import { createNodeSqliteDatabase } from "../src/lib/persistence/sql/adapters.ts";
import { applyMigrations } from "../src/lib/persistence/sql/migrate.ts";
import { SqlAgendaStore } from "../src/lib/persistence/sql/sql-agenda-store.ts";
import { SqlAnnualCourseStore } from "../src/lib/persistence/sql/sql-annual-course-store.ts";
import { SqlCourseScheduleStore } from "../src/lib/persistence/sql/sql-course-schedule-store.ts";
import {
  SqlAnnualCourseNotesStore,
  SqlPedagogicalPathStore,
} from "../src/lib/persistence/sql/sql-pedagogical-path-store.ts";
import { SqlRuntimeAgendaAdapterStore } from "../src/lib/persistence/sql/sql-runtime-adapter-store.ts";
import { SqlSchoolCatalogStore } from "../src/lib/persistence/sql/sql-school-catalog-store.ts";
import { SqlTeacherAccountStore } from "../src/lib/persistence/sql/sql-teacher-account-store.ts";
import type { SchoolYearStore } from "../src/lib/persistence/school-year-types.ts";

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

function yearsStub(): SchoolYearStore {
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
  const weeks2027 = mondayWeeks("2027-08-16", 16);
  return {
    listSchoolYears: async () => [year],
    getActiveSchoolYear: async () => ({ ...year, weeks: weeks2027 }),
    getSchoolYearById: async (id: string) => (id === "year-2027" ? { ...year, weeks: weeks2027 } : null),
    listDayExceptions: async () => [],
  } as SchoolYearStore;
}

interface World {
  adapters: SqlRuntimeAgendaAdapterStore;
  agenda: SqlAgendaStore;
  catalog: SqlSchoolCatalogStore;
  courses: SqlAnnualCourseStore;
  years: SchoolYearStore;
  teachers: SqlTeacherAccountStore;
  schedules: SqlCourseScheduleStore;
  paths: SqlPedagogicalPathStore;
  courseDeps: AnnualCourseServiceDeps;
  publishDeps: StructuredPublishDeps;
  exportDeps: NotebookExportServiceDeps;
  close: () => void;
}

async function sqliteWorld(): Promise<World> {
  const db = createNodeSqliteDatabase(":memory:");
  await applyMigrations(db);
  await db.exec(
    `INSERT OR IGNORE INTO school_years (id, label, status, starts_on, ends_on, created_at)
     VALUES ('year-2027', '2027-2028', 'active', '2027-08-01', '2028-07-31', datetime('now'))`,
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
  const exportDeps: NotebookExportServiceDeps = {
    courses,
    catalog,
    years,
    teachers,
    schedules,
    paths,
    agenda,
    notes: { getNotes: async () => null },
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
    exportDeps,
    close: () => db.close(),
  };
}

async function withSqliteWorld(run: (world: World) => Promise<void>): Promise<void> {
  const world = await sqliteWorld();
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
  return {
    schoolClass,
    teacher: teacher.account,
    course: courseResult.value,
  };
}

async function sessionsOf(world: World, annualCourseId: string) {
  const sessions = await listComputedCourseSessions(world.publishDeps, {
    schoolYearId: "year-2027",
    annualCourseId,
  });
  assert.equal(sessions.ok, true);
  if (!sessions.ok) throw new Error(sessions.reason);
  assert.ok(sessions.value.length >= 2);
  return sessions.value;
}

async function pdfText(pdf: Uint8Array): Promise<string> {
  const document = await openPdfDocument(pdf);
  const parts: string[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    for (const entry of content.items) {
      if ("str" in entry && typeof entry.str === "string") parts.push(entry.str);
    }
  }
  return parts.join(" ");
}

test("chemin Carnet — 1 contrôle via publishManualControlToAgenda puis export PDF", async () => {
  await withSqliteWorld(async (world) => {
    const seeded = await seedCourse(world);
    const [session] = await sessionsOf(world, seeded.course.id);
    const created = await publishManualControlToAgenda(world.publishDeps, {
      teacherId: seeded.teacher.id,
      annualCourseId: seeded.course.id,
      courseSessionKey: session!.key,
      title: "ControleCarnetUn",
      detail: "",
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal(created.item.annualCourseId, seeded.course.id);
    assert.equal(created.item.courseSessionKey, session!.key);
    assert.ok(created.item.courseSessionDate);

    const listed = await world.agenda.listAgendaItemsByAnnualCourse(seeded.course.id);
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.title, "ControleCarnetUn");

    const exported = await exportTeacherNotebookPdf(world.exportDeps, {
      teacherId: seeded.teacher.id,
      annualCourseId: seeded.course.id,
    });
    assert.equal(exported.ok, true);
    if (!exported.ok) return;
    const text = await pdfText(exported.pdf);
    assert.match(text, /ControleCarnetUn/);
    assert.match(text, /1 contrôle/);
  });
});

test("chemin Carnet — 2 contrôles, couverture 2 contrôles, titres dans le PDF", async () => {
  await withSqliteWorld(async (world) => {
    const seeded = await seedCourse(world);
    const sessions = await sessionsOf(world, seeded.course.id);
    const first = sessions[0]!;
    const second = sessions[sessions.length - 1]!;
    const one = await publishManualControlToAgenda(world.publishDeps, {
      teacherId: seeded.teacher.id,
      annualCourseId: seeded.course.id,
      courseSessionKey: first.key,
      title: "ControleCarnetA",
    });
    const two = await publishManualControlToAgenda(world.publishDeps, {
      teacherId: seeded.teacher.id,
      annualCourseId: seeded.course.id,
      courseSessionKey: second.key,
      title: "ControleCarnetB",
    });
    assert.equal(one.ok, true);
    assert.equal(two.ok, true);

    const exported = await exportTeacherNotebookPdf(world.exportDeps, {
      teacherId: seeded.teacher.id,
      annualCourseId: seeded.course.id,
    });
    assert.equal(exported.ok, true);
    if (!exported.ok) return;
    const text = await pdfText(exported.pdf);
    assert.match(text, /ControleCarnetA/);
    assert.match(text, /ControleCarnetB/);
    assert.match(text, /2 contrôles/);
    assert.doesNotMatch(text, /0 contrôle/);
    assert.match(formatNotebookExportCoverage({ sessionCount: 2, publicationCount: 0, controlCount: 2 }), /2 contrôles/);
  });
});

test("chemin Carnet — TEST d'un autre AnnualCourse absent de l'export", async () => {
  await withSqliteWorld(async (world) => {
    const primary = await seedCourse(world, "MA2A");
    const other = await seedCourse(world, "MA2B");
    const [sessionA] = await sessionsOf(world, primary.course.id);
    const [sessionB] = await sessionsOf(world, other.course.id);
    const mine = await publishManualControlToAgenda(world.publishDeps, {
      teacherId: primary.teacher.id,
      annualCourseId: primary.course.id,
      courseSessionKey: sessionA!.key,
      title: "ControleCoursA",
    });
    const theirs = await publishManualControlToAgenda(world.publishDeps, {
      teacherId: other.teacher.id,
      annualCourseId: other.course.id,
      courseSessionKey: sessionB!.key,
      title: "ControleCoursB",
    });
    assert.equal(mine.ok, true);
    assert.equal(theirs.ok, true);

    const exported = await exportTeacherNotebookPdf(world.exportDeps, {
      teacherId: primary.teacher.id,
      annualCourseId: primary.course.id,
    });
    assert.equal(exported.ok, true);
    if (!exported.ok) return;
    const text = await pdfText(exported.pdf);
    assert.match(text, /ControleCoursA/);
    assert.doesNotMatch(text, /ControleCoursB/);
  });
});

test("chemin Carnet — TEST legacy annualCourseId NULL récupéré sans ambiguïté", async () => {
  await withSqliteWorld(async (world) => {
    const seeded = await seedCourse(world);
    const [session] = await sessionsOf(world, seeded.course.id);
    const [classes, courses, contexts, branches] = await Promise.all([
      world.catalog.listClasses(),
      world.courses.listCourses(),
      world.catalog.listContexts(),
      world.catalog.listBranches(),
    ]);
    const branchInfo = contextBranchForCourse({
      course: seeded.course,
      contexts,
      branches,
    });
    assert.ok(branchInfo);
    const adapters = await ensureRuntimeSubjectForAnnualCourse(world.adapters, {
      schoolClass: seeded.schoolClass,
      course: seeded.course,
      branch: branchInfo!.branch,
      allSchoolClasses: classes,
      courses,
      contexts,
      branches,
    });
    assert.equal(adapters.ok, true);
    const classroomId = runtimeClassroomIdForSchoolClass(seeded.schoolClass.id);
    const subjectId = runtimeSubjectIdForAnnualCourse(seeded.course.id);
    const legacy = await world.agenda.createAgendaItem({
      classroomId,
      subjectId,
      authorTeacherId: seeded.teacher.id,
      day: session!.dayOfWeek - 1,
      hour: 8,
      weekOffset: 0,
      schoolWeekNumber: session!.schoolWeekNumber,
      type: "TEST",
      title: "ControleLegacyNull",
      detail: "",
      schoolYearId: seeded.course.schoolYearId,
      courseSessionDate: session!.date,
    });
    assert.equal(legacy.annualCourseId ?? null, null);
    assert.equal(legacy.courseSessionKey ?? null, null);
    const byCourse = await world.agenda.listAgendaItemsByAnnualCourse(seeded.course.id);
    assert.equal(byCourse.some((entry) => entry.id === legacy.id), false);

    const exported = await exportTeacherNotebookPdf(world.exportDeps, {
      teacherId: seeded.teacher.id,
      annualCourseId: seeded.course.id,
    });
    assert.equal(exported.ok, true);
    if (!exported.ok) return;
    const text = await pdfText(exported.pdf);
    assert.match(text, /ControleLegacyNull/);
    assert.match(text, /1 contrôle/);
  });
});
