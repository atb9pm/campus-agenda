import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env.CAMPUS_PBKDF2_ITERATIONS ??= "10000";
process.env.AUTH_SECRET ??= "test-secret-teacher-delete";

import { APP_VERSION } from "../src/lib/app-version.ts";
import {
  confirmationMatches,
  deleteTeacherPermanently,
  LAST_ADMIN_DELETE_REASON,
  previewTeacherDelete,
  SQL_TEACHER_DELETE_ROLLBACK_PROBE,
} from "../src/features/admin-teacher-delete/index.ts";
import { applyMigrations, SQL_MIGRATION_FILES } from "../src/lib/persistence/sql/migrate.ts";
import { createNodeSqliteDatabase } from "../src/lib/persistence/sql/adapters.ts";
import { SqlAgendaStore } from "../src/lib/persistence/sql/sql-agenda-store.ts";
import { SqlAnnualCourseStore } from "../src/lib/persistence/sql/sql-annual-course-store.ts";
import { SqlMembershipStore } from "../src/lib/persistence/sql/sql-membership-store.ts";
import { SqlAnnualCourseNotesStore } from "../src/lib/persistence/sql/sql-pedagogical-path-store.ts";
import { SqlRuntimeAgendaAdapterStore } from "../src/lib/persistence/sql/sql-runtime-adapter-store.ts";
import { SqlSchoolCatalogStore } from "../src/lib/persistence/sql/sql-school-catalog-store.ts";
import { SqlTeacherAccountStore } from "../src/lib/persistence/sql/sql-teacher-account-store.ts";
import { SqlTeacherNotesStore } from "../src/lib/persistence/sql/sql-teacher-notes-store.ts";
import { SqlTeacherSetupStore } from "../src/lib/persistence/sql/sql-teacher-setup-store.ts";
import { SqlTemplateStore } from "../src/lib/persistence/sql/sql-template-store.ts";
import {
  dumpCampusTables,
  restoreCampusTables,
  validateCampusTables,
} from "../src/lib/persistence/sql/sql-campus-backup.ts";
import { prepareSqlDatabase } from "../src/lib/persistence/store-factory.ts";
import type { SqlDatabase } from "../src/lib/persistence/sql/types.ts";
import type { TeacherDeleteSnapshotDeps } from "../src/features/admin-teacher-delete/snapshot.ts";
import type { AgendaItemType } from "../src/types/agenda.ts";

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

async function foreignKeyViolations(db: SqlDatabase): Promise<number> {
  const { results } = await db.prepare("PRAGMA foreign_key_check").bind().all();
  return results.length;
}

async function openWorld() {
  const dir = await mkdtemp(path.join(tmpdir(), "campus-tdel-"));
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
  const agenda = new SqlAgendaStore(db);
  const deps: TeacherDeleteSnapshotDeps = {
    accounts: new SqlTeacherAccountStore(db),
    courses: new SqlAnnualCourseStore(db),
    agenda,
    templates: new SqlTemplateStore(db, agenda),
    memberships: new SqlMembershipStore(db),
    teacherSetups: new SqlTeacherSetupStore(db),
    teacherNotes: new SqlTeacherNotesStore(db),
    notes: new SqlAnnualCourseNotesStore(db),
    sqlDb: db,
  };
  return {
    dir,
    db,
    deps,
    catalog: new SqlSchoolCatalogStore(db),
    courses: deps.courses,
    agenda,
    adapters: new SqlRuntimeAgendaAdapterStore(db),
    notes: deps.notes!,
  };
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

async function seedTeacher(
  db: SqlDatabase,
  options: { id: string; initials: string; name: string; admin?: boolean },
) {
  await db
    .prepare(
      `INSERT INTO teachers (id, display_name, initials, password_hash, is_admin, is_active)
       VALUES (?, ?, ?, 'x', ?, 1)`,
    )
    .bind(options.id, options.name, options.initials, options.admin ? 1 : 0)
    .run();
  return options.id;
}

async function seedCourseWorld(world: Awaited<ReturnType<typeof openWorld>>, classCode = "MA3") {
  const yearId = await seedYear(world.db);
  const profession = await world.catalog.createProfession({
    label: "Mécanicien",
    durationYears: 3,
    classCodePrefix: "MA",
  });
  const branch = await world.catalog.createBranch({
    code: "MOT",
    label: "Moteur",
    teachingType: "TECHNICAL",
  });
  const ctx = await world.catalog.createContext({
    professionId: profession.id,
    trainingYear: 3,
    branchId: branch.id,
  });
  assert.equal(ctx.ok, true);
  const schoolClass = await world.catalog.createClass({
    code: classCode,
    label: classCode,
    schoolYearId: yearId,
    schoolYearLabel: "2026-2027",
    professionId: profession.id,
    trainingYear: 3,
  });
  const course = await world.courses.createCourse({
    id: `course-${classCode.toLowerCase()}`,
    schoolYearId: yearId,
    classId: schoolClass.id,
    contextId: ctx.value!.id,
    isArchived: false,
    archivedAt: null,
    createdAt: "2026-08-17T00:00:00.000Z",
    updatedAt: "2026-08-17T00:00:00.000Z",
  });
  const classroomId = `rt-${classCode.toLowerCase()}`;
  const subjectId = `sub-${classCode.toLowerCase()}`;
  await world.adapters.upsertClassroom({
    id: classroomId,
    name: classCode,
    programLabel: "Mécanique",
    accessCodeHint: "MA3",
    schoolClassId: schoolClass.id,
  });
  await world.adapters.upsertSubject({
    id: subjectId,
    classroomId,
    name: "Moteur",
    annualCourseId: course.id,
  });
  return {
    yearId,
    profession,
    branch,
    ctx: ctx.value!,
    schoolClass,
    course,
    classroomId,
    subjectId,
  };
}

async function assignTeacher(
  world: Awaited<ReturnType<typeof openWorld>>,
  courseId: string,
  teacherId: string,
  assignmentId: string,
  role: "PRIMARY" | "CO_TEACHER" = "PRIMARY",
) {
  await world.courses.createAssignment({
    id: assignmentId,
    annualCourseId: courseId,
    teacherId,
    role,
    validFrom: "2026-08-17",
    validTo: null,
    createdByAdminId: "teacher-admin",
    createdAt: "2026-08-17T00:00:00.000Z",
    endedAt: null,
    overrideReason: null,
    overrideByAdminId: null,
  });
}

async function publish(
  world: Awaited<ReturnType<typeof openWorld>>,
  options: {
    classroomId: string;
    subjectId: string;
    authorTeacherId: string;
    type: AgendaItemType;
    title: string;
    hour?: number;
    schoolYearId?: string;
    annualCourseId?: string;
  },
) {
  return world.agenda.createAgendaItem({
    classroomId: options.classroomId,
    subjectId: options.subjectId,
    authorTeacherId: options.authorTeacherId,
    day: 1,
    hour: options.hour ?? 8,
    schoolWeekNumber: 1,
    type: options.type,
    title: options.title,
    detail: options.title,
    schoolYearId: options.schoolYearId ?? "year-2026",
    annualCourseId: options.annualCourseId,
  });
}

test("version 2.48.0 — auteur nullable, confirmation exacte", () => {
  assert.equal(APP_VERSION, "2.51.1");
  assert.equal(SQL_MIGRATION_FILES.at(-1), "0028_school_week_kind_nullable.sql");
  assert.equal(confirmationMatches("ChF", "ChF"), true);
  assert.equal(confirmationMatches("ChF", "chf"), false);
});

test("A — professeur vide : suppression avec confirmation exacte", async () => {
  const world = await openWorld();
  try {
    await seedTeacher(world.db, { id: "teacher-admin", initials: "AD", name: "Admin", admin: true });
    await seedTeacher(world.db, { id: "teacher-test", initials: "TEST", name: "Prof TEST" });
    const preview = await previewTeacherDelete(world.deps, "teacher-test");
    assert.equal(preview.ok, true);
    assert.equal(preview.preview?.confirmationText, "TEST");
    assert.match(preview.preview!.lines.join("\n"), /Publications conservées : 0/);
    const deleted = await deleteTeacherPermanently(world.deps, {
      teacherId: "teacher-test",
      confirmationText: "TEST",
    });
    assert.equal(deleted.ok, true);
    assert.equal(await existsId(world.db, "teachers", "teacher-test"), false);
    assert.equal(await existsId(world.db, "teachers", "teacher-admin"), true);
    assert.equal(await foreignKeyViolations(world.db), 0);
  } finally {
    world.db.close();
    await rm(world.dir, { recursive: true, force: true });
  }
});

test("B — mauvaise confirmation : refus, aucune donnée modifiée", async () => {
  const world = await openWorld();
  try {
    await seedTeacher(world.db, { id: "teacher-admin", initials: "AD", name: "Admin", admin: true });
    await seedTeacher(world.db, { id: "teacher-test", initials: "TSTB", name: "Prof B" });
    const missing = await deleteTeacherPermanently(world.deps, { teacherId: "teacher-test" });
    assert.equal(missing.ok, false);
    assert.equal(missing.status, 409);
    const wrong = await deleteTeacherPermanently(world.deps, {
      teacherId: "teacher-test",
      confirmationText: "tstb",
    });
    assert.equal(wrong.ok, false);
    assert.equal(wrong.status, 400);
    assert.equal(await existsId(world.db, "teachers", "teacher-test"), true);
    assert.equal(await countRows(world.db, "teachers"), 2);
  } finally {
    world.db.close();
    await rm(world.dir, { recursive: true, force: true });
  }
});

test("C — affecté sans publication : cours / classe / CTX / branche conservés", async () => {
  const world = await openWorld();
  try {
    await seedTeacher(world.db, { id: "teacher-admin", initials: "AD", name: "Admin", admin: true });
    await seedTeacher(world.db, { id: "teacher-chf", initials: "ChF", name: "François X." });
    const seeded = await seedCourseWorld(world, "MA3");
    await assignTeacher(world, seeded.course.id, "teacher-chf", "asg-chf");
    await world.db
      .prepare("INSERT INTO memberships (id, teacher_id, classroom_id, valid_from) VALUES (?, ?, ?, ?)")
      .bind("mem-chf", "teacher-chf", seeded.classroomId, "2026-08-17")
      .run();
    const deleted = await deleteTeacherPermanently(world.deps, {
      teacherId: "teacher-chf",
      confirmationText: "ChF",
    });
    assert.equal(deleted.ok, true);
    assert.equal(await existsId(world.db, "teachers", "teacher-chf"), false);
    assert.equal(await existsId(world.db, "teacher_course_assignments", "asg-chf"), false);
    assert.equal(await existsId(world.db, "annual_courses", seeded.course.id), true);
    assert.equal(await existsId(world.db, "school_classes", seeded.schoolClass.id), true);
    assert.equal(await existsId(world.db, "pedagogical_contexts", seeded.ctx.id), true);
    assert.equal(await existsId(world.db, "school_branches", seeded.branch.id), true);
    assert.equal(await existsId(world.db, "memberships", "mem-chf"), false);
    assert.equal(await foreignKeyViolations(world.db), 0);
  } finally {
    world.db.close();
    await rm(world.dir, { recursive: true, force: true });
  }
});

test("D — HOMEWORK conservé", async () => {
  const world = await openWorld();
  try {
    await seedTeacher(world.db, { id: "teacher-admin", initials: "AD", name: "Admin", admin: true });
    await seedTeacher(world.db, { id: "teacher-chf", initials: "ChF", name: "François X." });
    const seeded = await seedCourseWorld(world);
    const item = await publish(world, {
      classroomId: seeded.classroomId,
      subjectId: seeded.subjectId,
      authorTeacherId: "teacher-chf",
      type: "HOMEWORK",
      title: "Devoir moteur",
      annualCourseId: seeded.course.id,
    });
    const deleted = await deleteTeacherPermanently(world.deps, {
      teacherId: "teacher-chf",
      confirmationText: "ChF",
    });
    assert.equal(deleted.ok, true);
    const row = await world.db
      .prepare("SELECT title, detail, type, classroom_id, author_teacher_id FROM agenda_items WHERE id = ?")
      .bind(item.id)
      .first<{
        title: string;
        detail: string;
        type: string;
        classroom_id: string;
        author_teacher_id: string | null;
      }>();
    assert.equal(row?.title, "Devoir moteur");
    assert.equal(row?.detail, "Devoir moteur");
    assert.equal(row?.type, "HOMEWORK");
    assert.equal(row?.classroom_id, seeded.classroomId);
    assert.equal(row?.author_teacher_id, null);
    const listed = await world.agenda.listAgendaItems(seeded.classroomId);
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.title, "Devoir moteur");
  } finally {
    world.db.close();
    await rm(world.dir, { recursive: true, force: true });
  }
});

test("E — TEST conservé", async () => {
  const world = await openWorld();
  try {
    await seedTeacher(world.db, { id: "teacher-admin", initials: "AD", name: "Admin", admin: true });
    await seedTeacher(world.db, { id: "teacher-chf", initials: "ChF", name: "François X." });
    const seeded = await seedCourseWorld(world);
    await publish(world, {
      classroomId: seeded.classroomId,
      subjectId: seeded.subjectId,
      authorTeacherId: "teacher-chf",
      type: "TEST",
      title: "Contrôle 1",
    });
    const deleted = await deleteTeacherPermanently(world.deps, {
      teacherId: "teacher-chf",
      confirmationText: "ChF",
    });
    assert.equal(deleted.ok, true);
    assert.equal(await countRows(world.db, "agenda_items"), 1);
    const row = await world.db
      .prepare("SELECT type, title, author_teacher_id FROM agenda_items")
      .bind()
      .first<{ type: string; title: string; author_teacher_id: string | null }>();
    assert.equal(row?.type, "TEST");
    assert.equal(row?.title, "Contrôle 1");
    assert.equal(row?.author_teacher_id, null);
  } finally {
    world.db.close();
    await rm(world.dir, { recursive: true, force: true });
  }
});

test("F — INFORMATION conservée", async () => {
  const world = await openWorld();
  try {
    await seedTeacher(world.db, { id: "teacher-admin", initials: "AD", name: "Admin", admin: true });
    await seedTeacher(world.db, { id: "teacher-chf", initials: "ChF", name: "François X." });
    const seeded = await seedCourseWorld(world);
    await publish(world, {
      classroomId: seeded.classroomId,
      subjectId: seeded.subjectId,
      authorTeacherId: "teacher-chf",
      type: "INFORMATION",
      title: "Info atelier",
    });
    const deleted = await deleteTeacherPermanently(world.deps, {
      teacherId: "teacher-chf",
      confirmationText: "ChF",
    });
    assert.equal(deleted.ok, true);
    const row = await world.db
      .prepare("SELECT type, title FROM agenda_items")
      .bind()
      .first<{ type: string; title: string }>();
    assert.equal(row?.type, "INFORMATION");
    assert.equal(row?.title, "Info atelier");
  } finally {
    world.db.close();
    await rm(world.dir, { recursive: true, force: true });
  }
});

test("G — 20 HOMEWORK + 3 TEST + 5 INFORMATION conservés", async () => {
  const world = await openWorld();
  try {
    await seedTeacher(world.db, { id: "teacher-admin", initials: "AD", name: "Admin", admin: true });
    await seedTeacher(world.db, { id: "teacher-chf", initials: "ChF", name: "François X." });
    const seeded = await seedCourseWorld(world);
    for (let index = 0; index < 20; index += 1) {
      await publish(world, {
        classroomId: seeded.classroomId,
        subjectId: seeded.subjectId,
        authorTeacherId: "teacher-chf",
        type: "HOMEWORK",
        title: `Devoir ${index + 1}`,
        hour: 8,
      });
    }
    for (let index = 0; index < 3; index += 1) {
      await publish(world, {
        classroomId: seeded.classroomId,
        subjectId: seeded.subjectId,
        authorTeacherId: "teacher-chf",
        type: "TEST",
        title: `Contrôle ${index + 1}`,
        hour: 9,
      });
    }
    for (let index = 0; index < 5; index += 1) {
      await publish(world, {
        classroomId: seeded.classroomId,
        subjectId: seeded.subjectId,
        authorTeacherId: "teacher-chf",
        type: "INFORMATION",
        title: `Info ${index + 1}`,
        hour: 10,
      });
    }
    assert.equal(await countRows(world.db, "agenda_items"), 28);
    const preview = await previewTeacherDelete(world.deps, "teacher-chf");
    assert.equal(preview.preview?.counts.publications, 28);
    assert.match(preview.preview!.lines.join("\n"), /Publications conservées : 28/);
    const deleted = await deleteTeacherPermanently(world.deps, {
      teacherId: "teacher-chf",
      confirmationText: "ChF",
    });
    assert.equal(deleted.ok, true);
    assert.equal(await existsId(world.db, "teachers", "teacher-chf"), false);
    assert.equal(await countRows(world.db, "agenda_items"), 28);
    const listed = await world.agenda.listAgendaItems(seeded.classroomId);
    assert.equal(listed.length, 28);
    assert.equal(listed.filter((item) => item.type === "HOMEWORK").length, 20);
    assert.equal(listed.filter((item) => item.type === "TEST").length, 3);
    assert.equal(listed.filter((item) => item.type === "INFORMATION").length, 5);
    assert.equal(await foreignKeyViolations(world.db), 0);
  } finally {
    world.db.close();
    await rm(world.dir, { recursive: true, force: true });
  }
});

test("H — deux professeurs sur un AnnualCourse : l'autre reste affecté", async () => {
  const world = await openWorld();
  try {
    await seedTeacher(world.db, { id: "teacher-admin", initials: "AD", name: "Admin", admin: true });
    await seedTeacher(world.db, { id: "teacher-chf", initials: "ChF", name: "François X." });
    await seedTeacher(world.db, { id: "teacher-abc", initials: "ABC", name: "Alex B." });
    const seeded = await seedCourseWorld(world);
    await assignTeacher(world, seeded.course.id, "teacher-chf", "asg-chf");
    await assignTeacher(world, seeded.course.id, "teacher-abc", "asg-abc", "CO_TEACHER");
    await publish(world, {
      classroomId: seeded.classroomId,
      subjectId: seeded.subjectId,
      authorTeacherId: "teacher-chf",
      type: "HOMEWORK",
      title: "Devoir ChF",
    });
    const deleted = await deleteTeacherPermanently(world.deps, {
      teacherId: "teacher-chf",
      confirmationText: "ChF",
    });
    assert.equal(deleted.ok, true);
    assert.equal(await existsId(world.db, "teacher_course_assignments", "asg-chf"), false);
    assert.equal(await existsId(world.db, "teacher_course_assignments", "asg-abc"), true);
    assert.equal(await existsId(world.db, "annual_courses", seeded.course.id), true);
    assert.equal(await existsId(world.db, "teachers", "teacher-abc"), true);
    assert.equal(await countRows(world.db, "agenda_items"), 1);
  } finally {
    world.db.close();
    await rm(world.dir, { recursive: true, force: true });
  }
});

test("I — seul professeur : AnnualCourse sans affectation, ré-affectable", async () => {
  const world = await openWorld();
  try {
    await seedTeacher(world.db, { id: "teacher-admin", initials: "AD", name: "Admin", admin: true });
    await seedTeacher(world.db, { id: "teacher-chf", initials: "ChF", name: "François X." });
    await seedTeacher(world.db, { id: "teacher-abc", initials: "ABC", name: "Alex B." });
    const seeded = await seedCourseWorld(world);
    await assignTeacher(world, seeded.course.id, "teacher-chf", "asg-chf");
    const deleted = await deleteTeacherPermanently(world.deps, {
      teacherId: "teacher-chf",
      confirmationText: "ChF",
    });
    assert.equal(deleted.ok, true);
    const leftover = await world.courses.listAssignments(seeded.course.id);
    assert.equal(leftover.length, 0);
    assert.equal(await existsId(world.db, "annual_courses", seeded.course.id), true);
    await assignTeacher(world, seeded.course.id, "teacher-abc", "asg-abc");
    const again = await world.courses.listAssignments(seeded.course.id);
    assert.equal(again.length, 1);
    assert.equal(again[0]?.teacherId, "teacher-abc");
  } finally {
    world.db.close();
    await rm(world.dir, { recursive: true, force: true });
  }
});

test("J — publications d'une classe archivée conservées et consultables", async () => {
  const world = await openWorld();
  try {
    await seedTeacher(world.db, { id: "teacher-admin", initials: "AD", name: "Admin", admin: true });
    await seedTeacher(world.db, { id: "teacher-chf", initials: "ChF", name: "François X." });
    const seeded = await seedCourseWorld(world, "MA1");
    await publish(world, {
      classroomId: seeded.classroomId,
      subjectId: seeded.subjectId,
      authorTeacherId: "teacher-chf",
      type: "HOMEWORK",
      title: "Ancien devoir",
    });
    await publish(world, {
      classroomId: seeded.classroomId,
      subjectId: seeded.subjectId,
      authorTeacherId: "teacher-chf",
      type: "TEST",
      title: "Ancien contrôle",
      hour: 9,
    });
    await world.catalog.updateClass(seeded.schoolClass.id, { isArchived: true });
    const deleted = await deleteTeacherPermanently(world.deps, {
      teacherId: "teacher-chf",
      confirmationText: "ChF",
    });
    assert.equal(deleted.ok, true);
    const archived = (await world.catalog.listClasses()).find((entry) => entry.id === seeded.schoolClass.id);
    assert.equal(archived?.isArchived, true);
    const listed = await world.agenda.listAgendaItems(seeded.classroomId);
    assert.equal(listed.length, 2);
    assert.deepEqual(
      listed.map((item) => item.title).sort(),
      ["Ancien contrôle", "Ancien devoir"],
    );
    assert.equal(await foreignKeyViolations(world.db), 0);
  } finally {
    world.db.close();
    await rm(world.dir, { recursive: true, force: true });
  }
});

test("K — dernier administrateur : suppression refusée", async () => {
  const world = await openWorld();
  try {
    await seedTeacher(world.db, { id: "teacher-admin", initials: "AD", name: "Admin", admin: true });
    await seedTeacher(world.db, { id: "teacher-chf", initials: "ChF", name: "François X." });
    const preview = await previewTeacherDelete(world.deps, "teacher-admin");
    assert.equal(preview.preview?.lastAdminBlocked, true);
    const deleted = await deleteTeacherPermanently(world.deps, {
      teacherId: "teacher-admin",
      confirmationText: "AD",
    });
    assert.equal(deleted.ok, false);
    assert.equal(deleted.status, 409);
    assert.equal(deleted.reason, LAST_ADMIN_DELETE_REASON);
    assert.equal(await existsId(world.db, "teachers", "teacher-admin"), true);

    await seedTeacher(world.db, { id: "teacher-ad2", initials: "AE", name: "Autre Admin", admin: true });
    const allowed = await deleteTeacherPermanently(world.deps, {
      teacherId: "teacher-admin",
      confirmationText: "AD",
    });
    assert.equal(allowed.ok, true);
    assert.equal(await existsId(world.db, "teachers", "teacher-ad2"), true);
  } finally {
    world.db.close();
    await rm(world.dir, { recursive: true, force: true });
  }
});

test("L — rollback si erreur pendant la suppression", async () => {
  const world = await openWorld();
  try {
    await seedTeacher(world.db, { id: "teacher-admin", initials: "AD", name: "Admin", admin: true });
    await seedTeacher(world.db, { id: "teacher-chf", initials: "ChF", name: "François X." });
    const seeded = await seedCourseWorld(world);
    await assignTeacher(world, seeded.course.id, "teacher-chf", "asg-chf");
    await publish(world, {
      classroomId: seeded.classroomId,
      subjectId: seeded.subjectId,
      authorTeacherId: "teacher-chf",
      type: "HOMEWORK",
      title: "Rollback",
    });
    await assert.rejects(
      () =>
        deleteTeacherPermanently(world.deps, {
          teacherId: "teacher-chf",
          confirmationText: "ChF",
          injectFailure: true,
        }),
      /campus_teacher_delete_rollback|no such table/i,
    );
    assert.equal(await existsId(world.db, "teachers", "teacher-chf"), true);
    assert.equal(await existsId(world.db, "teacher_course_assignments", "asg-chf"), true);
    assert.equal(await countRows(world.db, "agenda_items"), 1);
    assert.match(SQL_TEACHER_DELETE_ROLLBACK_PROBE.sql, /campus_teacher_delete_rollback/);
  } finally {
    world.db.close();
    await rm(world.dir, { recursive: true, force: true });
  }
});

test("M — foreign_keys=ON : aucune violation après suppression", async () => {
  const world = await openWorld();
  try {
    const fk = await world.db.prepare("PRAGMA foreign_keys").bind().first<{ foreign_keys: number }>();
    assert.equal(Number(fk?.foreign_keys ?? 0), 1);
    await seedTeacher(world.db, { id: "teacher-admin", initials: "AD", name: "Admin", admin: true });
    await seedTeacher(world.db, { id: "teacher-chf", initials: "ChF", name: "François X." });
    const seeded = await seedCourseWorld(world);
    await assignTeacher(world, seeded.course.id, "teacher-chf", "asg-chf");
    await world.db
      .prepare("INSERT INTO memberships (id, teacher_id, classroom_id, valid_from) VALUES (?, ?, ?, ?)")
      .bind("mem-chf", "teacher-chf", seeded.classroomId, "2026-08-17")
      .run();
    await world.db
      .prepare("INSERT INTO membership_subjects (membership_id, subject_id) VALUES (?, ?)")
      .bind("mem-chf", seeded.subjectId)
      .run();
    await world.db
      .prepare(
        `INSERT INTO publication_templates (id, owner_teacher_id, title, detail, type)
         VALUES ('tpl-chf', 'teacher-chf', 'Modèle', 'x', 'HOMEWORK')`,
      )
      .bind()
      .run();
    const item = await publish(world, {
      classroomId: seeded.classroomId,
      subjectId: seeded.subjectId,
      authorTeacherId: "teacher-chf",
      type: "HOMEWORK",
      title: "Devoir lié",
    });
    await world.db
      .prepare("UPDATE agenda_items SET template_id = ? WHERE id = ?")
      .bind("tpl-chf", item.id)
      .run();
    await world.db
      .prepare("INSERT INTO teacher_setups (teacher_id, config_json) VALUES (?, '{}')")
      .bind("teacher-chf")
      .run();
    await world.db
      .prepare("INSERT INTO teacher_notes (teacher_id, notes_json) VALUES (?, '{}')")
      .bind("teacher-chf")
      .run();
    await world.notes.createNote("note-chf", {
      schoolYearId: seeded.yearId,
      classId: seeded.schoolClass.id,
      contextId: seeded.ctx.id,
      authorTeacherId: "teacher-chf",
      text: "Note annuelle pédagogique",
    });
    const deleted = await deleteTeacherPermanently(world.deps, {
      teacherId: "teacher-chf",
      confirmationText: "ChF",
    });
    assert.equal(deleted.ok, true, deleted.reason);
    assert.equal(await existsId(world.db, "teachers", "teacher-chf"), false);
    assert.equal(await existsId(world.db, "publication_templates", "tpl-chf"), false);
    assert.equal(await existsId(world.db, "memberships", "mem-chf"), false);
    assert.equal(await countRows(world.db, "teacher_setups"), 0);
    assert.equal(await countRows(world.db, "teacher_notes"), 0);
    assert.equal(await countRows(world.db, "agenda_items"), 1);
    const note = await world.notes.getNote("note-chf");
    assert.equal(note?.text, "Note annuelle pédagogique");
    assert.equal(note?.authorTeacherId, "");
    assert.equal(await foreignKeyViolations(world.db), 0);

    const dump = await dumpCampusTables(world.db);
    const validated = validateCampusTables(dump);
    assert.equal(validated.ok, true, validated.ok ? "" : validated.reason);
    const db2 = createNodeSqliteDatabase(":memory:");
    await applyMigrations(db2);
    await db2.exec("PRAGMA foreign_keys = ON");
    await restoreCampusTables(db2, dump);
    assert.equal(await countRows(db2, "agenda_items"), 1);
    assert.equal(await existsId(db2, "teachers", "teacher-chf"), false);
    assert.equal((await db2.prepare("PRAGMA foreign_key_check").bind().all()).results.length, 0);
    db2.close();
  } finally {
    world.db.close();
    await rm(world.dir, { recursive: true, force: true });
  }
});

test("migration 0027 — replay non destructif, auteur ensuite nullable", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "campus-tdel-mig-"));
  const db = createNodeSqliteDatabase(path.join(dir, "campus.sqlite"));
  try {
    await applyMigrations(db, { until: "0026_student_access_ciphertext.sql" });
    await db.exec("PRAGMA foreign_keys = ON");
    await db
      .prepare(
        `INSERT INTO teachers (id, display_name, initials, password_hash, is_admin, is_active)
         VALUES ('teacher-admin', 'Admin', 'AD', 'x', 1, 1)`,
      )
      .bind()
      .run();
    await db
      .prepare("INSERT INTO classrooms (id, name, program_label, access_code_hint) VALUES ('c1', 'MA3', '', '')")
      .bind()
      .run();
    await db.prepare("INSERT INTO subjects (id, classroom_id, name) VALUES ('s1', 'c1', 'Moteur')").bind().run();
    await db
      .prepare(
        `INSERT INTO agenda_items
          (id, classroom_id, subject_id, author_teacher_id, day, hour, week_offset, type, title, detail)
         VALUES (1, 'c1', 's1', 'teacher-admin', 1, 8, 0, 'HOMEWORK', 'Avant', 'x')`,
      )
      .bind()
      .run();
    await applyMigrations(db);
    const before = await db
      .prepare("SELECT title, author_teacher_id FROM agenda_items WHERE id = 1")
      .bind()
      .first<{ title: string; author_teacher_id: string }>();
    assert.equal(before?.title, "Avant");
    assert.equal(before?.author_teacher_id, "teacher-admin");
    await db.prepare("UPDATE agenda_items SET author_teacher_id = NULL WHERE id = 1").bind().run();
    const after = await db
      .prepare("SELECT title, author_teacher_id FROM agenda_items WHERE id = 1")
      .bind()
      .first<{ title: string; author_teacher_id: string | null }>();
    assert.equal(after?.title, "Avant");
    assert.equal(after?.author_teacher_id, null);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("UI — modal danger, publications conservées, confirmation serveur", async () => {
  const panel = await readFile(
    new URL("../web/app/components/teacher-accounts-panel.tsx", import.meta.url),
    "utf8",
  );
  assert.match(panel, /TeacherDeleteDialog/);
  assert.match(panel, /className="is-danger"/);
  assert.match(panel, /Supprimer/);
  assert.match(panel, /fetchTeacherDeletePreview/);
  const client = await readFile(new URL("../web/lib/api-client.ts", import.meta.url), "utf8");
  assert.match(client, /delete-preview/);
  assert.match(client, /JSON\.stringify\(\{ confirmationText \}\)/);

  const dialog = await readFile(
    new URL("../web/app/components/teacher-delete-dialog.tsx", import.meta.url),
    "utf8",
  );
  assert.match(dialog, /Supprimer définitivement ce professeur/);
  assert.match(dialog, /publications sont conservées/);
  const types = await readFile(
    new URL("../src/features/admin-teacher-delete/types.ts", import.meta.url),
    "utf8",
  );
  assert.match(types, /devoirs, contrôles, informations/);
  assert.match(dialog, /disabled=\{blocked \|\| !matches/);

  const route = await readFile(
    new URL("../web/app/api/admin/teachers/[id]/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /deleteTeacherPermanently/);
  assert.match(route, /confirmationText/);
});
