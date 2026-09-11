import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env.CAMPUS_PBKDF2_ITERATIONS ??= "10000";
process.env.AUTH_SECRET ??= "test-secret-permanent-delete";

import { APP_VERSION } from "../src/lib/app-version.ts";
import {
  buildMembershipSubjectDeletes,
  confirmationMatches,
  deleteCatalogItemPermanently,
  emptyCatalogDeleteCounts,
  hasDestructiveDependencies,
  previewCatalogDelete,
  SQL_ROLLBACK_PROBE,
} from "../src/features/admin-catalog-delete/index.ts";
import { loadCatalogDeleteSnapshot } from "../src/features/admin-catalog-delete/snapshot.ts";
import { buildCatalogDeletePlan } from "../src/features/admin-catalog-delete/plan.ts";
import { buildCatalogDeleteStatements } from "../src/features/admin-catalog-delete/sql-statements.ts";
import type { CatalogDeleteSnapshotDeps } from "../src/features/admin-catalog-delete/snapshot.ts";
import { createEmptyPath } from "../src/features/pedagogical-path/index.ts";
import { createNodeSqliteDatabase } from "../src/lib/persistence/sql/adapters.ts";
import { SQL_MIGRATION_FILES } from "../src/lib/persistence/sql/migrate.ts";
import { SqlAgendaStore } from "../src/lib/persistence/sql/sql-agenda-store.ts";
import { SqlAnnualCourseStore } from "../src/lib/persistence/sql/sql-annual-course-store.ts";
import { SqlCourseScheduleStore } from "../src/lib/persistence/sql/sql-course-schedule-store.ts";
import { SqlMembershipStore } from "../src/lib/persistence/sql/sql-membership-store.ts";
import {
  SqlAnnualCourseNotesStore,
  SqlPedagogicalPathStore,
} from "../src/lib/persistence/sql/sql-pedagogical-path-store.ts";
import { SqlRuntimeAgendaAdapterStore } from "../src/lib/persistence/sql/sql-runtime-adapter-store.ts";
import { SqlSchoolCatalogStore } from "../src/lib/persistence/sql/sql-school-catalog-store.ts";
import { SqlStudentAccessStore } from "../src/lib/persistence/sql/sql-student-access-store.ts";
import { SqlTeacherNotesStore } from "../src/lib/persistence/sql/sql-teacher-notes-store.ts";
import { SqlTeacherSetupStore } from "../src/lib/persistence/sql/sql-teacher-setup-store.ts";
import { SqlTimetableStore } from "../src/lib/persistence/sql/sql-timetable-store.ts";
import { prepareSqlDatabase } from "../src/lib/persistence/store-factory.ts";
import type { SqlDatabase } from "../src/lib/persistence/sql/types.ts";

async function countRows(db: SqlDatabase, table: string): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).bind().first<{ count: number }>();
  return Number(row?.count ?? 0);
}

async function existsId(db: SqlDatabase, table: string, id: string): Promise<boolean> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE id = ?`)
    .bind(id)
    .first<{ count: number }>();
  return Number(row?.count ?? 0) > 0;
}

async function openWorld() {
  const dir = await mkdtemp(path.join(tmpdir(), "campus-del-"));
  const db = createNodeSqliteDatabase(path.join(dir, "campus.sqlite"));
  const previous = process.env.CAMPUS_DEMO_SEED;
  process.env.CAMPUS_DEMO_SEED = "false";
  try {
    await prepareSqlDatabase(db);
    await db.exec("PRAGMA foreign_keys = ON");
  } finally {
    if (previous === undefined) delete process.env.CAMPUS_DEMO_SEED;
    else process.env.CAMPUS_DEMO_SEED = previous;
  }
  const catalog = new SqlSchoolCatalogStore(db);
  const courses = new SqlAnnualCourseStore(db);
  const notes = new SqlAnnualCourseNotesStore(db);
  const paths = new SqlPedagogicalPathStore(db);
  const schedules = new SqlCourseScheduleStore(db);
  const agenda = new SqlAgendaStore(db);
  const adapters = new SqlRuntimeAgendaAdapterStore(db);
  const memberships = new SqlMembershipStore(db);
  const studentAccesses = new SqlStudentAccessStore(db);
  const teacherSetups = new SqlTeacherSetupStore(db);
  const teacherNotes = new SqlTeacherNotesStore(db);
  const timetable = new SqlTimetableStore(db);
  const deps: CatalogDeleteSnapshotDeps = {
    catalog,
    courses,
    notes,
    paths,
    schedules,
    agenda,
    adapters,
    memberships,
    studentAccesses,
    teacherSetups,
    teacherNotes,
    timetable,
    sqlDb: db,
  };
  return { dir, db, deps, catalog, courses, notes, paths, schedules, agenda, adapters };
}

async function seedTwoBranchClass(world: Awaited<ReturnType<typeof openWorld>>) {
  const yearId = await seedYear(world.db);
  const teacherId = await seedTeacher(world.db);
  const profession = await world.catalog.createProfession({
    label: "Mécanicien FK",
    durationYears: 3,
    classCodePrefix: "ZFK",
  });
  const transmission = await world.catalog.createBranch({
    code: "DELTRN",
    label: "Transmission-FK",
    teachingType: "TECHNICAL",
  });
  const chassis = await world.catalog.createBranch({
    code: "DELCHS",
    label: "Châssis-FK",
    teachingType: "TECHNICAL",
  });
  const ctxTrans = await world.catalog.createContext({
    professionId: profession.id,
    trainingYear: 2,
    branchId: transmission.id,
  });
  const ctxChas = await world.catalog.createContext({
    professionId: profession.id,
    trainingYear: 2,
    branchId: chassis.id,
  });
  assert.equal(ctxTrans.ok, true);
  assert.equal(ctxChas.ok, true);
  const schoolClass = await world.catalog.createClass({
    code: "ZFK2A",
    label: "ZFK 2A",
    schoolYearId: yearId,
    schoolYearLabel: "2026-2027",
    professionId: profession.id,
    trainingYear: 2,
  });
  const courseTrans = await world.courses.createCourse({
    id: "course-fk-trans",
    schoolYearId: yearId,
    classId: schoolClass.id,
    contextId: ctxTrans.value!.id,
    isArchived: false,
    archivedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  const courseChas = await world.courses.createCourse({
    id: "course-fk-chas",
    schoolYearId: yearId,
    classId: schoolClass.id,
    contextId: ctxChas.value!.id,
    isArchived: false,
    archivedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  await world.adapters.upsertClassroom({
    id: "rt-zfk2a",
    name: "ZFK2A",
    programLabel: "",
    accessCodeHint: "",
    schoolClassId: schoolClass.id,
  });
  await world.adapters.upsertSubject({
    id: "sub-fk-trans",
    classroomId: "rt-zfk2a",
    name: "Transmission",
    annualCourseId: courseTrans.id,
  });
  await world.adapters.upsertSubject({
    id: "sub-fk-chas",
    classroomId: "rt-zfk2a",
    name: "Châssis",
    annualCourseId: courseChas.id,
  });
  await world.db
    .prepare("INSERT INTO memberships (id, teacher_id, classroom_id, valid_from) VALUES (?, ?, ?, ?)")
    .bind("mem-fk", teacherId, "rt-zfk2a", "2026-08-17")
    .run();
  await world.db
    .prepare("INSERT INTO membership_subjects (membership_id, subject_id) VALUES (?, ?)")
    .bind("mem-fk", "sub-fk-trans")
    .run();
  await world.db
    .prepare("INSERT INTO membership_subjects (membership_id, subject_id) VALUES (?, ?)")
    .bind("mem-fk", "sub-fk-chas")
    .run();
  return {
    yearId,
    teacherId,
    profession,
    transmission,
    chassis,
    ctxTrans: ctxTrans.value!,
    ctxChas: ctxChas.value!,
    schoolClass,
    courseTrans,
    courseChas,
  };
}

async function membershipSubjectExists(
  db: SqlDatabase,
  membershipId: string,
  subjectId: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      "SELECT COUNT(*) AS count FROM membership_subjects WHERE membership_id = ? AND subject_id = ?",
    )
    .bind(membershipId, subjectId)
    .first<{ count: number }>();
  return Number(row?.count ?? 0) > 0;
}

async function seedYear(db: SqlDatabase, id = "year-2026") {
  await db
    .prepare(
      `INSERT INTO school_years (id, label, status, starts_on, ends_on)
       VALUES (?, '2026-2027', 'active', '2026-08-17', '2027-07-02')`,
    )
    .bind(id)
    .run();
  return id;
}

async function seedTeacher(db: SqlDatabase, id = "teacher-admin") {
  await db
    .prepare(
      `INSERT INTO teachers (id, display_name, initials, password_hash, is_admin, is_active)
       VALUES (?, 'Admin', 'AD', 'x', 1, 1)`,
    )
    .bind(id)
    .run();
  return id;
}

test("version 2.48.0 — aucune migration destructive catalogue", () => {
  assert.equal(APP_VERSION, "2.52.0");
  assert.equal(SQL_MIGRATION_FILES.at(-1), "0028_school_week_kind_nullable.sql");
  assert.equal(confirmationMatches("MA2", "MA2"), true);
  assert.equal(confirmationMatches("MA2", "ma2"), false);
});

test("A — classe vide : suppression OK", async () => {
  const world = await openWorld();
  try {
    await seedYear(world.db);
    const created = await world.catalog.createClass({
      code: "VIDE1",
      label: "Classe vide",
      schoolYearId: "year-2026",
      schoolYearLabel: "2026-2027",
    });
    const preview = await previewCatalogDelete(world.deps, "class", created.id);
    assert.equal(preview.ok, true);
    assert.equal(preview.preview?.confirmationText, "VIDE1");
    const deleted = await deleteCatalogItemPermanently(world.deps, {
      kind: "class",
      id: created.id,
      confirmationText: "VIDE1",
    });
    assert.equal(deleted.ok, true);
    assert.equal(await existsId(world.db, "school_classes", created.id), false);
  } finally {
    world.db.close();
    await rm(world.dir, { recursive: true, force: true });
  }
});

test("A1 — classe vide sans confirmation : refus, classe conservée", async () => {
  const world = await openWorld();
  try {
    await seedYear(world.db);
    const created = await world.catalog.createClass({
      code: "VIDE0",
      label: "Vide sans confirm",
      schoolYearId: "year-2026",
      schoolYearLabel: "2026-2027",
    });
    const refused = await deleteCatalogItemPermanently(world.deps, {
      kind: "class",
      id: created.id,
    });
    assert.equal(refused.ok, false);
    assert.equal(refused.status, 409);
    assert.equal(await existsId(world.db, "school_classes", created.id), true);
  } finally {
    world.db.close();
    await rm(world.dir, { recursive: true, force: true });
  }
});

test("A2 — classe vide mauvaise confirmation : refus", async () => {
  const world = await openWorld();
  try {
    await seedYear(world.db);
    const created = await world.catalog.createClass({
      code: "VIDE2",
      label: "Vide mauvaise saisie",
      schoolYearId: "year-2026",
      schoolYearLabel: "2026-2027",
    });
    const refused = await deleteCatalogItemPermanently(world.deps, {
      kind: "class",
      id: created.id,
      confirmationText: "vide2",
    });
    assert.equal(refused.ok, false);
    assert.equal(refused.status, 400);
    assert.equal(await existsId(world.db, "school_classes", created.id), true);
  } finally {
    world.db.close();
    await rm(world.dir, { recursive: true, force: true });
  }
});

test("A3 — branche / profession / CTX vides sans confirmation : refus", async () => {
  const world = await openWorld();
  try {
    await seedYear(world.db);
    const profession = await world.catalog.createProfession({
      label: "Profession vide",
      durationYears: 3,
      classCodePrefix: "ZEM",
    });
    const branch = await world.catalog.createBranch({
      code: "ZEMBR",
      label: "Branche-vide",
      teachingType: "TECHNICAL",
    });

    const refusedBranch = await deleteCatalogItemPermanently(world.deps, {
      kind: "branch",
      id: branch.id,
    });
    assert.equal(refusedBranch.ok, false);
    assert.equal(refusedBranch.status, 409);
    assert.equal(await existsId(world.db, "school_branches", branch.id), true);

    const refusedProfession = await deleteCatalogItemPermanently(world.deps, {
      kind: "profession",
      id: profession.id,
    });
    assert.equal(refusedProfession.ok, false);
    assert.equal(refusedProfession.status, 409);
    assert.equal(await existsId(world.db, "school_professions", profession.id), true);

    const ctx = await world.catalog.createContext({
      professionId: profession.id,
      trainingYear: 1,
      branchId: branch.id,
    });
    assert.equal(ctx.ok, true);
    const refusedCtx = await deleteCatalogItemPermanently(world.deps, {
      kind: "context",
      id: ctx.value!.id,
    });
    assert.equal(refusedCtx.ok, false);
    assert.equal(refusedCtx.status, 409);
    assert.equal(await existsId(world.db, "pedagogical_contexts", ctx.value!.id), true);
  } finally {
    world.db.close();
    await rm(world.dir, { recursive: true, force: true });
  }
});

test("B — classe configurée : preview + cascade", async () => {
  const world = await openWorld();
  try {
    const yearId = await seedYear(world.db);
    const teacherId = await seedTeacher(world.db);
    const profession = await world.catalog.createProfession({
      label: "Mécanicien",
      durationYears: 3,
      classCodePrefix: "MECA",
    });
    const branch = await world.catalog.createBranch({
      code: "DELMOT",
      label: "Moteur-del",
      teachingType: "TECHNICAL",
    });
    const ctx = await world.catalog.createContext({
      professionId: profession.id,
      trainingYear: 2,
      branchId: branch.id,
    });
    assert.equal(ctx.ok, true);
    const schoolClass = await world.catalog.createClass({
      code: "MECA2A",
      label: "MECA 2A",
      schoolYearId: yearId,
      schoolYearLabel: "2026-2027",
      professionId: profession.id,
      trainingYear: 2,
    });
    const course = await world.courses.createCourse({
      id: "course-meca2a",
      schoolYearId: yearId,
      classId: schoolClass.id,
      contextId: ctx.value!.id,
      isArchived: false,
      archivedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await world.courses.createAssignment({
      id: "asg-1",
      annualCourseId: course.id,
      teacherId,
      role: "PRIMARY",
      validFrom: "2026-08-17",
      validTo: null,
      createdByAdminId: teacherId,
      createdAt: "2026-01-01T00:00:00.000Z",
      endedAt: null,
      overrideReason: null,
      overrideByAdminId: null,
    });
    await world.schedules.createSlot({
      id: "slot-1",
      annualCourseId: course.id,
      dayOfWeek: 1,
      periodStart: 1,
      periodEnd: 2,
      weekKind: "all",
      validFrom: null,
      validTo: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await world.adapters.upsertClassroom({
      id: "rt-meca2a",
      name: "MECA2A",
      programLabel: "Meca",
      accessCodeHint: "",
      schoolClassId: schoolClass.id,
    });
    await world.db
      .prepare(
        `INSERT INTO student_accesses (id, classroom_id, school_class_id, label, access_code_hash)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind("acc-meca2a", "rt-meca2a", schoolClass.id, "MECA2A-XX", "hash")
      .run();

    const preview = await previewCatalogDelete(world.deps, "class", schoolClass.id);
    assert.equal(preview.ok, true);
    assert.ok((preview.preview?.counts.annualCourses ?? 0) >= 1);
    assert.ok((preview.preview?.counts.assignments ?? 0) >= 1);
    assert.ok((preview.preview?.counts.studentAccesses ?? 0) >= 1);
    assert.equal(hasDestructiveDependencies(preview.plan!), true);

    const deleted = await deleteCatalogItemPermanently(world.deps, {
      kind: "class",
      id: schoolClass.id,
      confirmationText: "MECA2A",
    });
    assert.equal(deleted.ok, true);
    assert.equal(await existsId(world.db, "school_classes", schoolClass.id), false);
    assert.equal(await existsId(world.db, "annual_courses", course.id), false);
    assert.equal(await existsId(world.db, "teacher_course_assignments", "asg-1"), false);
    assert.equal(await existsId(world.db, "course_schedule_slots", "slot-1"), false);
    assert.equal(await existsId(world.db, "student_accesses", "acc-meca2a"), false);
    assert.equal(await existsId(world.db, "classrooms", "rt-meca2a"), false);
    assert.equal(await existsId(world.db, "school_professions", profession.id), true);
    assert.equal(await existsId(world.db, "school_branches", branch.id), true);
  } finally {
    world.db.close();
    await rm(world.dir, { recursive: true, force: true });
  }
});

test("C — HOMEWORK + TEST + INFORMATION", async () => {
  const world = await openWorld();
  try {
    await seedYear(world.db);
    await seedTeacher(world.db);
    const schoolClass = await world.catalog.createClass({
      code: "PUB3",
      label: "Publications",
      schoolYearId: "year-2026",
      schoolYearLabel: "2026-2027",
    });
    await world.adapters.upsertClassroom({
      id: "rt-pub3",
      name: "PUB3",
      programLabel: "",
      accessCodeHint: "",
      schoolClassId: schoolClass.id,
    });
    await world.adapters.upsertSubject({
      id: "sub-pub3",
      classroomId: "rt-pub3",
      name: "Moteur",
    });
    for (const [index, type] of (["HOMEWORK", "TEST", "INFORMATION"] as const).entries()) {
      await world.agenda.createAgendaItem({
        classroomId: "rt-pub3",
        subjectId: "sub-pub3",
        authorTeacherId: "teacher-admin",
        day: 1,
        hour: 8 + index,
        schoolWeekNumber: 1,
        type,
        title: type,
        detail: type,
        schoolYearId: "year-2026",
      });
    }
    const preview = await previewCatalogDelete(world.deps, "class", schoolClass.id);
    assert.equal(preview.preview?.counts.publications, 3);
    const deleted = await deleteCatalogItemPermanently(world.deps, {
      kind: "class",
      id: schoolClass.id,
      confirmationText: "PUB3",
    });
    assert.equal(deleted.ok, true);
    const leftoverPubs = await world.db
      .prepare("SELECT COUNT(*) AS count FROM agenda_items WHERE classroom_id = ?")
      .bind("rt-pub3")
      .first<{ count: number }>();
    assert.equal(Number(leftoverPubs?.count ?? 0), 0);
    assert.equal(await existsId(world.db, "school_classes", schoolClass.id), false);
  } finally {
    world.db.close();
    await rm(world.dir, { recursive: true, force: true });
  }
});

test("D — MA2 legacy : 16 publications + membership + accès", async () => {
  const world = await openWorld();
  try {
    await seedYear(world.db);
    await seedTeacher(world.db);
    const schoolClass = await world.catalog.createClass({
      code: "MA2",
      label: "MA2",
      schoolYearId: "year-2026",
      schoolYearLabel: "2026-2027",
    });
    await world.adapters.upsertClassroom({
      id: "classe-legacy-ma2",
      name: "MA2",
      programLabel: "Test",
      accessCodeHint: "MA2",
      schoolClassId: schoolClass.id,
    });
    await world.adapters.upsertSubject({
      id: "sub-ma2",
      classroomId: "classe-legacy-ma2",
      name: "Atelier",
    });
    for (let index = 0; index < 16; index += 1) {
      await world.agenda.createAgendaItem({
        classroomId: "classe-legacy-ma2",
        subjectId: "sub-ma2",
        authorTeacherId: "teacher-admin",
        day: 1,
        hour: 8,
        schoolWeekNumber: index + 1,
        type: index % 2 === 0 ? "HOMEWORK" : "INFORMATION",
        title: `Pub ${index + 1}`,
        detail: "legacy",
        schoolYearId: "year-2026",
      });
    }
    await world.db
      .prepare("INSERT INTO memberships (id, teacher_id, classroom_id, valid_from) VALUES (?, ?, ?, ?)")
      .bind("mem-ma2", "teacher-admin", "classe-legacy-ma2", "2026-08-17")
      .run();
    await world.db
      .prepare(
        `INSERT INTO student_accesses (id, classroom_id, school_class_id, label, access_code_hash)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind("stu-ma2", "classe-legacy-ma2", schoolClass.id, "MA2-XX", "hash")
      .run();

    const source = await readFile(new URL("../src/features/admin-catalog-delete/plan.ts", import.meta.url), "utf8");
    assert.doesNotMatch(source, /class\.code === ["']MA2["']/);

    const preview = await previewCatalogDelete(world.deps, "class", schoolClass.id);
    assert.equal(preview.preview?.counts.publications, 16);
    assert.equal(preview.preview?.counts.memberships, 1);
    assert.equal(preview.preview?.counts.studentAccesses, 1);

    const deleted = await deleteCatalogItemPermanently(world.deps, {
      kind: "class",
      id: schoolClass.id,
      confirmationText: "MA2",
    });
    assert.equal(deleted.ok, true);
    assert.equal(await existsId(world.db, "school_classes", schoolClass.id), false);
    const leftoverMa2 = await world.db
      .prepare("SELECT COUNT(*) AS count FROM agenda_items WHERE classroom_id = ?")
      .bind("classe-legacy-ma2")
      .first<{ count: number }>();
    assert.equal(Number(leftoverMa2?.count ?? 0), 0);
    assert.equal(await existsId(world.db, "memberships", "mem-ma2"), false);
    assert.equal(await existsId(world.db, "student_accesses", "stu-ma2"), false);
    assert.equal(await existsId(world.db, "classrooms", "classe-legacy-ma2"), false);
    assert.equal(await existsId(world.db, "subjects", "sub-ma2"), false);
  } finally {
    world.db.close();
    await rm(world.dir, { recursive: true, force: true });
  }
});

test("E — aperçu puis annulation : aucune donnée modifiée", async () => {
  const world = await openWorld();
  try {
    await seedYear(world.db);
    await seedTeacher(world.db);
    const schoolClass = await world.catalog.createClass({
      code: "KEEP1",
      label: "Conservée",
      schoolYearId: "year-2026",
      schoolYearLabel: "2026-2027",
    });
    await world.adapters.upsertClassroom({
      id: "rt-keep",
      name: "KEEP1",
      programLabel: "",
      accessCodeHint: "",
      schoolClassId: schoolClass.id,
    });
    const before = await countRows(world.db, "school_classes");
    const preview = await previewCatalogDelete(world.deps, "class", schoolClass.id);
    assert.equal(preview.ok, true);
    assert.equal(await countRows(world.db, "school_classes"), before);
    assert.equal(await countRows(world.db, "classrooms"), 1);
  } finally {
    world.db.close();
    await rm(world.dir, { recursive: true, force: true });
  }
});

test("F — mauvaise confirmation refusée", async () => {
  const world = await openWorld();
  try {
    await seedYear(world.db);
    await seedTeacher(world.db);
    const schoolClass = await world.catalog.createClass({
      code: "MA2",
      label: "MA2",
      schoolYearId: "year-2026",
      schoolYearLabel: "2026-2027",
    });
    await world.adapters.upsertClassroom({
      id: "rt-wrong",
      name: "MA2",
      programLabel: "",
      accessCodeHint: "",
      schoolClassId: schoolClass.id,
    });
    await world.db
      .prepare("INSERT INTO memberships (id, teacher_id, classroom_id, valid_from) VALUES (?, ?, ?, ?)")
      .bind("mem-wrong", "teacher-admin", "rt-wrong", "2026-08-17")
      .run();
    const refused = await deleteCatalogItemPermanently(world.deps, {
      kind: "class",
      id: schoolClass.id,
      confirmationText: "MA1",
    });
    assert.equal(refused.ok, false);
    assert.equal(refused.status, 400);
    assert.equal(await existsId(world.db, "school_classes", schoolClass.id), true);
    assert.equal(await existsId(world.db, "memberships", "mem-wrong"), true);
  } finally {
    world.db.close();
    await rm(world.dir, { recursive: true, force: true });
  }
});

test("G — échec au milieu : rollback intégral", async () => {
  const world = await openWorld();
  try {
    await seedYear(world.db);
    await seedTeacher(world.db);
    const schoolClass = await world.catalog.createClass({
      code: "ROLL1",
      label: "Rollback",
      schoolYearId: "year-2026",
      schoolYearLabel: "2026-2027",
    });
    await world.adapters.upsertClassroom({
      id: "rt-roll",
      name: "ROLL1",
      programLabel: "",
      accessCodeHint: "",
      schoolClassId: schoolClass.id,
    });
    await world.adapters.upsertSubject({ id: "sub-roll", classroomId: "rt-roll", name: "Moteur" });
    await world.agenda.createAgendaItem({
      classroomId: "rt-roll",
      subjectId: "sub-roll",
      authorTeacherId: "teacher-admin",
      day: 1,
      hour: 8,
      schoolWeekNumber: 1,
      type: "HOMEWORK",
      title: "Rollback",
      detail: "x",
      schoolYearId: "year-2026",
    });
    await assert.rejects(
      () =>
        deleteCatalogItemPermanently(world.deps, {
          kind: "class",
          id: schoolClass.id,
          confirmationText: "ROLL1",
          injectFailure: true,
        }),
      /campus_catalog_delete_rollback|no such table/i,
    );
    assert.equal(await existsId(world.db, "school_classes", schoolClass.id), true);
    const leftoverRoll = await world.db
      .prepare("SELECT COUNT(*) AS count FROM agenda_items WHERE classroom_id = ?")
      .bind("rt-roll")
      .first<{ count: number }>();
    assert.equal(Number(leftoverRoll?.count ?? 0), 1);
    assert.equal(await existsId(world.db, "classrooms", "rt-roll"), true);
    assert.equal(await existsId(world.db, "subjects", "sub-roll"), true);
    assert.match(SQL_ROLLBACK_PROBE.sql, /campus_catalog_delete_rollback/);
  } finally {
    world.db.close();
    await rm(world.dir, { recursive: true, force: true });
  }
});

test("H — classe archivée supprimable", async () => {
  const world = await openWorld();
  try {
    await seedYear(world.db);
    const schoolClass = await world.catalog.createClass({
      code: "ARCH1",
      label: "Archivée",
      schoolYearId: "year-2026",
      schoolYearLabel: "2026-2027",
    });
    await world.catalog.updateClass(schoolClass.id, { isArchived: true });
    const deleted = await deleteCatalogItemPermanently(world.deps, {
      kind: "class",
      id: schoolClass.id,
      confirmationText: "ARCH1",
    });
    assert.equal(deleted.ok, true);
    assert.equal(await existsId(world.db, "school_classes", schoolClass.id), false);
  } finally {
    world.db.close();
    await rm(world.dir, { recursive: true, force: true });
  }
});

test("I — profession avec dépendances", async () => {
  const world = await openWorld();
  try {
    const yearId = await seedYear(world.db);
    const profession = await world.catalog.createProfession({
      label: "Automaticien",
      durationYears: 3,
      classCodePrefix: "AUTO",
    });
    const branch = await world.catalog.createBranch({ code: "ELEC", label: "Électricité", teachingType: "TECHNICAL" });
    const ctx = await world.catalog.createContext({
      professionId: profession.id,
      trainingYear: 1,
      branchId: branch.id,
    });
    assert.equal(ctx.ok, true);
    await world.catalog.createClass({
      code: "AUTO1A",
      label: "AUTO 1A",
      schoolYearId: yearId,
      schoolYearLabel: "2026-2027",
      professionId: profession.id,
      trainingYear: 1,
    });
    const preview = await previewCatalogDelete(world.deps, "profession", profession.id);
    assert.equal(preview.preview?.confirmationText, profession.adminCode);
    assert.ok((preview.preview?.counts.classes ?? 0) >= 1);
    assert.ok((preview.preview?.counts.contexts ?? 0) >= 1);
    const deleted = await deleteCatalogItemPermanently(world.deps, {
      kind: "profession",
      id: profession.id,
      confirmationText: profession.adminCode,
    });
    assert.equal(deleted.ok, true);
    assert.equal(await existsId(world.db, "school_professions", profession.id), false);
    assert.equal(
      (await world.catalog.listClasses()).some((entry) => entry.professionId === profession.id),
      false,
    );
    assert.equal(
      (await world.catalog.listContexts()).some((entry) => entry.professionId === profession.id),
      false,
    );
    assert.equal(await existsId(world.db, "school_branches", branch.id), true);
  } finally {
    world.db.close();
    await rm(world.dir, { recursive: true, force: true });
  }
});

test("J — branche multi-CTX sans supprimer les classes", async () => {
  const world = await openWorld();
  try {
    const yearId = await seedYear(world.db);
    const profession = await world.catalog.createProfession({
      label: "Mécanicien",
      durationYears: 3,
      classCodePrefix: "MECA",
    });
    const transmission = await world.catalog.createBranch({
      code: "TRANS",
      label: "Transmission",
      teachingType: "TECHNICAL",
    });
    const moteur = await world.catalog.createBranch({
      code: "MOT",
      label: "Moteur",
      teachingType: "TECHNICAL",
    });
    const ctxA = await world.catalog.createContext({
      professionId: profession.id,
      trainingYear: 1,
      branchId: transmission.id,
    });
    const ctxB = await world.catalog.createContext({
      professionId: profession.id,
      trainingYear: 2,
      branchId: transmission.id,
    });
    await world.catalog.createContext({
      professionId: profession.id,
      trainingYear: 1,
      branchId: moteur.id,
    });
    const schoolClass = await world.catalog.createClass({
      code: "MECA1A",
      label: "MECA 1A",
      schoolYearId: yearId,
      schoolYearLabel: "2026-2027",
      professionId: profession.id,
      trainingYear: 1,
    });
    await world.courses.createCourse({
      id: "course-trans",
      schoolYearId: yearId,
      classId: schoolClass.id,
      contextId: ctxA.value!.id,
      isArchived: false,
      archivedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const preview = await previewCatalogDelete(world.deps, "branch", transmission.id);
    assert.equal(preview.preview?.confirmationText, "Transmission");
    assert.ok((preview.preview?.counts.contexts ?? 0) >= 2);
    assert.equal(preview.preview?.counts.classes, 0);
    const deleted = await deleteCatalogItemPermanently(world.deps, {
      kind: "branch",
      id: transmission.id,
      confirmationText: "Transmission",
    });
    assert.equal(deleted.ok, true);
    assert.equal((await world.catalog.listClasses()).some((entry) => entry.id === schoolClass.id), true);
    assert.equal((await world.catalog.listBranches()).some((entry) => entry.id === moteur.id), true);
    assert.equal((await world.catalog.listContexts()).some((entry) => entry.id === ctxB.value!.id), false);
    assert.equal(await countRows(world.db, "annual_courses"), 0);
  } finally {
    world.db.close();
    await rm(world.dir, { recursive: true, force: true });
  }
});

test("K — CTX avec parcours + cours annuels", async () => {
  const world = await openWorld();
  try {
    const yearId = await seedYear(world.db);
    const profession = await world.catalog.createProfession({
      label: "Mécanicien",
      durationYears: 3,
      classCodePrefix: "MECA",
    });
    const branch = await world.catalog.createBranch({ code: "MOT", label: "Moteur", teachingType: "TECHNICAL" });
    const ctx = await world.catalog.createContext({
      professionId: profession.id,
      trainingYear: 3,
      branchId: branch.id,
    });
    assert.equal(ctx.ok, true);
    const schoolClass = await world.catalog.createClass({
      code: "MECA3A",
      label: "MECA 3A",
      schoolYearId: yearId,
      schoolYearLabel: "2026-2027",
      professionId: profession.id,
      trainingYear: 3,
    });
    const path = createEmptyPath({ id: "path-ctx", contextId: ctx.value!.id });
    await world.paths.savePath(path);
    const course = await world.courses.createCourse({
      id: "course-ctx",
      schoolYearId: yearId,
      classId: schoolClass.id,
      contextId: ctx.value!.id,
      isArchived: false,
      archivedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await world.adapters.upsertClassroom({
      id: "rt-ctx",
      name: "MECA3A",
      programLabel: "",
      accessCodeHint: "",
      schoolClassId: schoolClass.id,
    });
    await world.adapters.upsertSubject({
      id: "sub-ctx",
      classroomId: "rt-ctx",
      name: "Moteur",
      annualCourseId: course.id,
    });
    await seedTeacher(world.db);
    await world.agenda.createAgendaItem({
      classroomId: "rt-ctx",
      subjectId: "sub-ctx",
      authorTeacherId: "teacher-admin",
      day: 1,
      hour: 8,
      schoolWeekNumber: 1,
      type: "TEST",
      title: "Contrôle CTX",
      detail: "x",
      schoolYearId: yearId,
      annualCourseId: course.id,
    });

    const preview = await previewCatalogDelete(world.deps, "context", ctx.value!.id);
    assert.equal(preview.preview?.confirmationText, ctx.value!.adminCode);
    assert.ok((preview.preview?.counts.annualCourses ?? 0) >= 1);
    assert.ok((preview.preview?.counts.pedagogicalPaths ?? 0) >= 1);
    assert.ok((preview.preview?.counts.publications ?? 0) >= 1);

    const deleted = await deleteCatalogItemPermanently(world.deps, {
      kind: "context",
      id: ctx.value!.id,
      confirmationText: ctx.value!.adminCode,
    });
    assert.equal(deleted.ok, true);
    assert.equal(await existsId(world.db, "pedagogical_contexts", ctx.value!.id), false);
    const leftoverPath = await world.db
      .prepare("SELECT COUNT(*) AS count FROM pedagogical_paths WHERE context_id = ?")
      .bind(ctx.value!.id)
      .first<{ count: number }>();
    assert.equal(Number(leftoverPath?.count ?? 0), 0);
    assert.equal(await existsId(world.db, "annual_courses", course.id), false);
    const leftoverCtxPubs = await world.db
      .prepare("SELECT COUNT(*) AS count FROM agenda_items WHERE annual_course_id = ?")
      .bind(course.id)
      .first<{ count: number }>();
    assert.equal(Number(leftoverCtxPubs?.count ?? 0), 0);
    assert.equal(await existsId(world.db, "school_classes", schoolClass.id), true);
  } finally {
    world.db.close();
    await rm(world.dir, { recursive: true, force: true });
  }
});

test("L — aucun orphelin après suppression de classe", async () => {
  const world = await openWorld();
  try {
    await seedYear(world.db);
    await seedTeacher(world.db);
    const schoolClass = await world.catalog.createClass({
      code: "ORPH1",
      label: "Orphelin",
      schoolYearId: "year-2026",
      schoolYearLabel: "2026-2027",
    });
    await world.adapters.upsertClassroom({
      id: "rt-orph",
      name: "ORPH1",
      programLabel: "",
      accessCodeHint: "",
      schoolClassId: schoolClass.id,
    });
    await deleteCatalogItemPermanently(world.deps, {
      kind: "class",
      id: schoolClass.id,
      confirmationText: "ORPH1",
    });
    const snapshot = await loadCatalogDeleteSnapshot(world.deps);
    assert.equal(snapshot.classes.some((entry) => entry.id === schoolClass.id), false);
    assert.equal(snapshot.classrooms.some((entry) => entry.id === "rt-orph"), false);
    assert.equal(snapshot.agendaItems.some((entry) => entry.classroomId === "rt-orph"), false);
    assert.equal(snapshot.memberships.some((entry) => entry.classroomId === "rt-orph"), false);
    assert.equal(snapshot.studentAccesses.some((entry) => entry.classroomId === "rt-orph"), false);
  } finally {
    world.db.close();
    await rm(world.dir, { recursive: true, force: true });
  }
});

test("C/FK — membership_subjects par subject : CTX Transmission", async () => {
  const world = await openWorld();
  try {
    const seeded = await seedTwoBranchClass(world);
    const preview = await previewCatalogDelete(world.deps, "context", seeded.ctxTrans.id);
    assert.equal(preview.ok, true);
    assert.ok((preview.preview?.counts.subjects ?? 0) >= 1);
    assert.equal(preview.preview?.counts.memberships, 0);

    const deleted = await deleteCatalogItemPermanently(world.deps, {
      kind: "context",
      id: seeded.ctxTrans.id,
      confirmationText: seeded.ctxTrans.adminCode,
    });
    assert.equal(deleted.ok, true);
    assert.equal(await existsId(world.db, "subjects", "sub-fk-trans"), false);
    assert.equal(await existsId(world.db, "subjects", "sub-fk-chas"), true);
    assert.equal(await existsId(world.db, "memberships", "mem-fk"), true);
    assert.equal(await membershipSubjectExists(world.db, "mem-fk", "sub-fk-trans"), false);
    assert.equal(await membershipSubjectExists(world.db, "mem-fk", "sub-fk-chas"), true);
    assert.equal(await existsId(world.db, "school_classes", seeded.schoolClass.id), true);
    assert.equal(await existsId(world.db, "annual_courses", seeded.courseChas.id), true);
  } finally {
    world.db.close();
    await rm(world.dir, { recursive: true, force: true });
  }
});

test("C/FK — membership_subjects par subject : branche Transmission", async () => {
  const world = await openWorld();
  try {
    const seeded = await seedTwoBranchClass(world);
    const deleted = await deleteCatalogItemPermanently(world.deps, {
      kind: "branch",
      id: seeded.transmission.id,
      confirmationText: "Transmission-FK",
    });
    assert.equal(deleted.ok, true);
    assert.equal(await existsId(world.db, "school_branches", seeded.transmission.id), false);
    assert.equal(await existsId(world.db, "school_branches", seeded.chassis.id), true);
    assert.equal(await existsId(world.db, "subjects", "sub-fk-trans"), false);
    assert.equal(await existsId(world.db, "subjects", "sub-fk-chas"), true);
    assert.equal(await existsId(world.db, "memberships", "mem-fk"), true);
    assert.equal(await membershipSubjectExists(world.db, "mem-fk", "sub-fk-trans"), false);
    assert.equal(await membershipSubjectExists(world.db, "mem-fk", "sub-fk-chas"), true);
    assert.equal(await existsId(world.db, "school_classes", seeded.schoolClass.id), true);
  } finally {
    world.db.close();
    await rm(world.dir, { recursive: true, force: true });
  }
});

test("A/FK — AgendaItem supprimé avant son template", async () => {
  const world = await openWorld();
  try {
    const seeded = await seedTwoBranchClass(world);
    await world.db
      .prepare(
        `INSERT INTO publication_templates (id, owner_teacher_id, title, detail, type, subject_id)
         VALUES (?, ?, 'Tpl Trans', 'x', 'INFORMATION', ?)`,
      )
      .bind("tpl-fk-trans", seeded.teacherId, "sub-fk-trans")
      .run();
    const item = await world.agenda.createAgendaItem({
      classroomId: "rt-zfk2a",
      subjectId: "sub-fk-trans",
      authorTeacherId: seeded.teacherId,
      day: 1,
      hour: 8,
      schoolWeekNumber: 1,
      type: "INFORMATION",
      title: "Depuis modèle",
      detail: "x",
      schoolYearId: seeded.yearId,
      annualCourseId: seeded.courseTrans.id,
      templateId: "tpl-fk-trans",
    });
    const statements = buildCatalogDeleteStatements(
      (await previewCatalogDelete(world.deps, "context", seeded.ctxTrans.id)).plan!,
      await loadCatalogDeleteSnapshot(world.deps),
    );
    const agendaIdx = statements.findIndex((entry) => entry.sql.startsWith("DELETE FROM agenda_items"));
    const templateIdx = statements.findIndex((entry) =>
      entry.sql.startsWith("DELETE FROM publication_templates"),
    );
    assert.ok(agendaIdx >= 0 && templateIdx >= 0 && agendaIdx < templateIdx);

    const deleted = await deleteCatalogItemPermanently(world.deps, {
      kind: "context",
      id: seeded.ctxTrans.id,
      confirmationText: seeded.ctxTrans.adminCode,
    });
    assert.equal(deleted.ok, true);
    assert.equal(await existsId(world.db, "publication_templates", "tpl-fk-trans"), false);
    const leftover = await world.db
      .prepare("SELECT COUNT(*) AS count FROM agenda_items WHERE id = ?")
      .bind(item.id)
      .first<{ count: number }>();
    assert.equal(Number(leftover?.count ?? 0), 0);
  } finally {
    world.db.close();
    await rm(world.dir, { recursive: true, force: true });
  }
});

test("B/FK — template.subjectId du subject CTX inclus dans la cascade", async () => {
  const world = await openWorld();
  try {
    const seeded = await seedTwoBranchClass(world);
    await world.db
      .prepare(
        `INSERT INTO publication_templates (id, owner_teacher_id, title, detail, type, subject_id)
         VALUES (?, ?, 'Tpl Trans', 'x', 'HOMEWORK', ?)`,
      )
      .bind("tpl-fk-trans-b", seeded.teacherId, "sub-fk-trans")
      .run();
    await world.db
      .prepare(
        `INSERT INTO publication_templates (id, owner_teacher_id, title, detail, type, subject_id)
         VALUES (?, ?, 'Tpl Châssis', 'x', 'HOMEWORK', ?)`,
      )
      .bind("tpl-fk-chas-b", seeded.teacherId, "sub-fk-chas")
      .run();
    const preview = await previewCatalogDelete(world.deps, "context", seeded.ctxTrans.id);
    assert.ok((preview.preview?.counts.publicationTemplates ?? 0) >= 1);
    assert.ok(preview.plan?.publicationTemplateIds.includes("tpl-fk-trans-b"));
    assert.equal(preview.plan?.publicationTemplateIds.includes("tpl-fk-chas-b"), false);

    const deleted = await deleteCatalogItemPermanently(world.deps, {
      kind: "context",
      id: seeded.ctxTrans.id,
      confirmationText: seeded.ctxTrans.adminCode,
    });
    assert.equal(deleted.ok, true);
    assert.equal(await existsId(world.db, "publication_templates", "tpl-fk-trans-b"), false);
    assert.equal(await existsId(world.db, "publication_templates", "tpl-fk-chas-b"), true);
    const orphan = await world.db
      .prepare(
        `SELECT COUNT(*) AS count FROM publication_templates
         WHERE subject_id IS NOT NULL
           AND subject_id NOT IN (SELECT id FROM subjects)`,
      )
      .bind()
      .first<{ count: number }>();
    assert.equal(Number(orphan?.count ?? 0), 0);
  } finally {
    world.db.close();
    await rm(world.dir, { recursive: true, force: true });
  }
});

test("ordre DELETE — FK membership_subjects / templates / subjects", () => {
  const plan = {
    kind: "context" as const,
    target: { id: "ctx", kind: "context" as const, code: "CTX-0001", label: "CTX-0001" },
    confirmationText: "CTX-0001",
    counts: emptyCatalogDeleteCounts(),
    classIds: [],
    professionIds: [],
    branchIds: [],
    contextIds: ["ctx"],
    annualCourseIds: ["ac"],
    assignmentIds: [],
    assignmentEventIds: [],
    annualCourseNoteIds: [],
    courseScheduleSlotIds: [],
    attendanceDayIds: [],
    agendaItemIds: [9],
    classroomIds: [],
    subjectIds: ["sub"],
    membershipIds: ["mem"],
    studentAccessIds: [],
    publicationTemplateIds: ["tpl"],
    timetableSlotIds: [],
    timetableMappingKeys: [],
  };
  const emptySnapshot = {
    classes: [],
    professions: [],
    branches: [],
    contexts: [],
    courses: [],
    assignments: [],
    events: [],
    notes: [],
    paths: [],
    scheduleSlots: [],
    attendanceDays: [],
    agendaItems: [],
    classrooms: [],
    subjects: [],
    memberships: [],
    studentAccesses: [],
    templates: [],
    teacherSetups: [],
    teacherNotes: [],
    timetableSlots: [],
    timetableMappings: [],
  };
  const statements = buildCatalogDeleteStatements(plan, emptySnapshot);
  const sql = statements.map((entry) => entry.sql);
  const indexOf = (table: string) => sql.findIndex((line) => line.startsWith(`DELETE FROM ${table}`));
  assert.ok(indexOf("membership_subjects") < indexOf("memberships"));
  assert.ok(indexOf("membership_subjects") < indexOf("subjects"));
  assert.ok(indexOf("agenda_items") < indexOf("publication_templates"));
  assert.ok(indexOf("publication_templates") < indexOf("subjects"));
  assert.ok(indexOf("agenda_items") < indexOf("subjects"));
  assert.ok(indexOf("subjects") < indexOf("annual_courses"));
  assert.ok(indexOf("annual_courses") < indexOf("pedagogical_contexts"));
  const ms = buildMembershipSubjectDeletes(plan);
  assert.match(ms[0]!.sql, /membership_id IN/);
  assert.match(ms[0]!.sql, /subject_id IN/);
  assert.match(ms[0]!.sql, / OR /);
});

test("E/UI — modal danger et pas de fallback silencieux", async () => {
  const dialog = await readFile(new URL("../web/app/components/destructive-confirm-dialog.tsx", import.meta.url), "utf8");
  assert.match(dialog, /Suppression définitive/);
  assert.match(dialog, /Tapez .* pour confirmer/);
  assert.match(dialog, /Supprimer définitivement/);
  assert.match(dialog, /disabled=\{!matches/);

  const classes = await readFile(new URL("../web/app/components/classes-admin-panel.tsx", import.meta.url), "utf8");
  assert.match(classes, /DestructiveConfirmDialog/);
  assert.match(classes, /delete-preview\?kind=class/);

  const professions = await readFile(new URL("../web/app/components/professions-admin-panel.tsx", import.meta.url), "utf8");
  assert.match(professions, /delete-preview\?kind=profession/);

  const branches = await readFile(new URL("../web/app/components/administration-panel.tsx", import.meta.url), "utf8");
  assert.match(branches, /delete-preview\?kind=branch/);

  const plans = await readFile(new URL("../web/app/components/training-plans-admin-panel.tsx", import.meta.url), "utf8");
  assert.match(plans, /delete-preview\?kind=context/);

  const statements = buildCatalogDeleteStatements(
    buildCatalogDeletePlan("class", "missing", {
      classes: [],
      professions: [],
      branches: [],
      contexts: [],
      courses: [],
      assignments: [],
      events: [],
      notes: [],
      paths: [],
      scheduleSlots: [],
      attendanceDays: [],
      agendaItems: [],
      classrooms: [],
      subjects: [],
      memberships: [],
      studentAccesses: [],
      templates: [],
      teacherSetups: [],
      teacherNotes: [],
      timetableSlots: [],
      timetableMappings: [],
    }) ?? {
      kind: "class",
      target: { id: "x", kind: "class", code: "X", label: "X" },
      confirmationText: "X",
      counts: {
        classes: 0,
        professions: 0,
        branches: 0,
        contexts: 0,
        pedagogicalPaths: 0,
        annualCourses: 0,
        assignments: 0,
        assignmentEvents: 0,
        annualCourseNotes: 0,
        courseScheduleSlots: 0,
        attendanceDays: 0,
        publications: 0,
        memberships: 0,
        studentAccesses: 0,
        classrooms: 0,
        subjects: 0,
        timetableSlots: 0,
        timetableClassMappings: 0,
        publicationTemplates: 0,
        teacherSetups: 0,
        teacherNotes: 0,
      },
      classIds: [],
      professionIds: [],
      branchIds: [],
      contextIds: [],
      annualCourseIds: [],
      assignmentIds: [],
      assignmentEventIds: [],
      annualCourseNoteIds: [],
      courseScheduleSlotIds: [],
      attendanceDayIds: [],
      agendaItemIds: [],
      classroomIds: [],
      subjectIds: [],
      membershipIds: [],
      studentAccessIds: [],
      publicationTemplateIds: [],
      timetableSlotIds: [],
      timetableMappingKeys: [],
    },
    {
      classes: [],
      professions: [],
      branches: [],
      contexts: [],
      courses: [],
      assignments: [],
      events: [],
      notes: [],
      paths: [],
      scheduleSlots: [],
      attendanceDays: [],
      agendaItems: [],
      classrooms: [],
      subjects: [],
      memberships: [],
      studentAccesses: [],
      templates: [],
      teacherSetups: [],
      teacherNotes: [],
      timetableSlots: [],
      timetableMappings: [],
    },
  );
  assert.ok(Array.isArray(statements));
});

test("API — admin only 401/403", async () => {
  const deleteRoute = await readFile(new URL("../web/app/api/admin/catalog/[id]/route.ts", import.meta.url), "utf8");
  const previewRoute = await readFile(
    new URL("../web/app/api/admin/catalog/[id]/delete-preview/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(deleteRoute, /requireAdminSession/);
  assert.match(previewRoute, /requireAdminSession/);
  assert.match(deleteRoute, /Admin \$\{auth\.session!\.teacherId\} deleted \$\{kind\} \$\{id\}/);
  assert.doesNotMatch(deleteRoute, /access_code|password/i);

  const planSource = await readFile(new URL("../src/features/admin-catalog-delete/plan.ts", import.meta.url), "utf8");
  assert.doesNotMatch(planSource, /=== ["']MA2["']/);
  const serviceSource = await readFile(
    new URL("../src/features/admin-catalog-delete/service.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(serviceSource, /hasDestructiveDependencies/);
  const plans = await readFile(
    new URL("../web/app/components/training-plans-admin-panel.tsx", import.meta.url),
    "utf8",
  );
  assert.match(plans, /JSON\.stringify\(\{ confirmationText \}\)/);
});
