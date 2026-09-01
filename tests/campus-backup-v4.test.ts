import assert from "node:assert/strict";
import test from "node:test";

process.env.CAMPUS_ALLOW_DEMO_PASSWORD ??= "1";

import { hashPassword } from "../src/lib/auth/password.ts";
import { exportCampusSnapshot, restoreCampusSnapshot } from "../src/lib/persistence/campus-backup.ts";
import { restoreAgendaSnapshot } from "../src/lib/persistence/backup.ts";
import {
  canonicalizeCampusDump,
  dumpCampusTables,
  parseBackupFlag,
  validateCampusTables,
} from "../src/lib/persistence/sql/sql-campus-backup.ts";
import { CAMPUS_BACKUP_INSERT_ORDER } from "../src/lib/persistence/campus-backup-tables.ts";
import { getMemoryTemplateStore, resetMemoryTemplateStore } from "../src/lib/persistence/memory-template-store.ts";
import { getMemoryTimetableStore, resetMemoryTimetableStore } from "../src/lib/persistence/memory-timetable-store.ts";
import { SqlTemplateStore } from "../src/lib/persistence/sql/sql-template-store.ts";
import { SqlTimetableStore } from "../src/lib/persistence/sql/sql-timetable-store.ts";
import type { CampusTableDump } from "../src/lib/persistence/sql/sql-campus-backup.ts";
import { createNodeSqliteDatabase } from "../src/lib/persistence/sql/adapters.ts";
import { applyMigrations } from "../src/lib/persistence/sql/migrate.ts";
import { seedDemoDatabase } from "../src/lib/persistence/sql/seed.ts";
import { SqlAgendaStore } from "../src/lib/persistence/sql/sql-agenda-store.ts";
import { SqlTeacherSetupStore } from "../src/lib/persistence/sql/sql-teacher-setup-store.ts";
import { SqlTeacherNotesStore } from "../src/lib/persistence/sql/sql-teacher-notes-store.ts";
import { SqlTeacherAccountStore } from "../src/lib/persistence/sql/sql-teacher-account-store.ts";
import { SqlSchoolCatalogStore } from "../src/lib/persistence/sql/sql-school-catalog-store.ts";
import { SqlSchoolYearStore } from "../src/lib/persistence/sql/sql-school-year-store.ts";
import { SqlAnnualCourseStore } from "../src/lib/persistence/sql/sql-annual-course-store.ts";
import { SqlCourseScheduleStore } from "../src/lib/persistence/sql/sql-course-schedule-store.ts";
import { SqlMembershipStore } from "../src/lib/persistence/sql/sql-membership-store.ts";
import { SqlPedagogicalPathStore, SqlAnnualCourseNotesStore } from "../src/lib/persistence/sql/sql-pedagogical-path-store.ts";
import { getMemoryAgendaStore, resetMemoryAgendaStore } from "../src/lib/persistence/memory-store.ts";
import { getMemoryTeacherAccountStore, resetMemoryTeacherAccountStore } from "../src/lib/persistence/memory-teacher-account-store.ts";
import { getMemoryTeacherSetupStore, resetMemoryTeacherSetupStore } from "../src/lib/persistence/memory-teacher-setup-store.ts";
import { getMemoryTeacherNotesStore, resetMemoryTeacherNotesStore } from "../src/lib/persistence/memory-teacher-notes-store.ts";
import { getMemorySchoolCatalogStore, resetMemorySchoolCatalogStore } from "../src/lib/persistence/memory-school-catalog-store.ts";
import { MemorySchoolYearStore, resetMemorySchoolYearStore } from "../src/lib/persistence/memory-school-year-store.ts";
import { getMemoryAnnualCourseStore, resetMemoryAnnualCourseStore } from "../src/lib/persistence/memory-annual-course-store.ts";
import { getMemoryCourseScheduleStore, resetMemoryCourseScheduleStore } from "../src/lib/persistence/memory-course-schedule-store.ts";
import { MemoryMembershipStore, resetMemoryMembershipStore } from "../src/lib/persistence/memory-membership-store.ts";
import {
  getMemoryAnnualCourseNotesStore,
  getMemoryPedagogicalPathStore,
  resetMemoryPedagogicalPathStore,
} from "../src/lib/persistence/memory-pedagogical-path-store.ts";
import { resetMemoryLegacySchool } from "../src/lib/persistence/memory-legacy-school.ts";
import { DEMO_PROTOTYPE_ITEMS } from "../src/features/agenda/demo-items.ts";
import { DEMO_CURRENT_TEACHER_ID } from "../src/features/classes/index.ts";
import { createAnnualCourse, assignTeacherToCourse } from "../src/features/annual-courses/index.ts";
import { replaceAttendanceDaysForClass, createCourseScheduleSlot } from "../src/features/course-schedule/index.ts";
import type { CampusBackupDeps } from "../src/lib/persistence/campus-backup.ts";
import type { SqlDatabase } from "../src/lib/persistence/sql/types.ts";

function emptyCampusTables(): CampusTableDump {
  const tables: CampusTableDump = {};
  for (const name of CAMPUS_BACKUP_INSERT_ORDER) tables[name] = [];
  return tables;
}

function tablesWithAdmin(overrides: Partial<CampusTableDump> = {}): CampusTableDump {
  return {
    ...emptyCampusTables(),
    teachers: [
      {
        id: "admin-1",
        display_name: "Admin",
        initials: "Ad",
        password_hash: "x",
        is_admin: 1,
        is_active: 1,
      },
    ],
    ...overrides,
  };
}

function memoryDeps(): CampusBackupDeps {
  return {
    agenda: getMemoryAgendaStore(),
    teacherSetups: getMemoryTeacherSetupStore(),
    teacherNotes: getMemoryTeacherNotesStore(),
    teacherAccounts: getMemoryTeacherAccountStore(),
    catalog: getMemorySchoolCatalogStore(),
    years: new MemorySchoolYearStore(),
    courses: getMemoryAnnualCourseStore(),
    schedules: getMemoryCourseScheduleStore(),
    memberships: new MemoryMembershipStore(),
    paths: getMemoryPedagogicalPathStore(),
    courseNotes: getMemoryAnnualCourseNotesStore(),
    templates: getMemoryTemplateStore(),
    timetable: getMemoryTimetableStore(),
    sqlDb: null,
  };
}

function resetMemoryWorld() {
  resetMemoryAgendaStore([...DEMO_PROTOTYPE_ITEMS]);
  resetMemoryTeacherSetupStore();
  resetMemoryTeacherNotesStore();
  resetMemoryTeacherAccountStore();
  resetMemorySchoolCatalogStore();
  resetMemorySchoolYearStore();
  resetMemoryAnnualCourseStore();
  resetMemoryCourseScheduleStore();
  resetMemoryMembershipStore();
  resetMemoryPedagogicalPathStore();
  resetMemoryLegacySchool();
  resetMemoryTemplateStore();
  resetMemoryTimetableStore();
}

function sqlDeps(db: SqlDatabase): CampusBackupDeps {
  const agenda = new SqlAgendaStore(db);
  return {
    agenda,
    teacherSetups: new SqlTeacherSetupStore(db),
    teacherNotes: new SqlTeacherNotesStore(db),
    teacherAccounts: new SqlTeacherAccountStore(db),
    catalog: new SqlSchoolCatalogStore(db),
    years: new SqlSchoolYearStore(db),
    courses: new SqlAnnualCourseStore(db),
    schedules: new SqlCourseScheduleStore(db),
    memberships: new SqlMembershipStore(db),
    paths: new SqlPedagogicalPathStore(db),
    courseNotes: new SqlAnnualCourseNotesStore(db),
    templates: new SqlTemplateStore(db, agenda),
    timetable: new SqlTimetableStore(db),
    sqlDb: db,
  };
}

async function populateLibraryAndTimetable(deps: CampusBackupDeps, yearId: string) {
  const source = await deps.agenda.createAgendaItem({
    classroomId: "classe-demo-tma-2a",
    subjectId: "subject-demo-moteur-2a",
    authorTeacherId: DEMO_CURRENT_TEACHER_ID,
    day: 0,
    hour: 8,
    weekOffset: 0,
    schoolWeekNumber: 12,
    type: "INFORMATION",
    title: "Modèle backup v4",
    detail: "Roundtrip",
    schoolYearId: yearId,
  });
  if (deps.templates) {
    const created = await deps.templates.createTemplateFromItem(source.id, DEMO_CURRENT_TEACHER_ID, yearId);
    assert.equal(created.ok, true, created.ok ? "" : created.reason);
  }
  if (deps.timetable) {
    const imported = await deps.timetable.importTimetable(
      {
        schoolYearLabel: "2025-2026",
        sourceVersion: "test-v4",
        slots: [
          {
            classCode: "2A",
            dayOfWeek: 0,
            period: 1,
            branchLabel: "Moteur",
            teacherCode: "ChF",
            weekKind: "all",
          },
        ],
        classes: [{ classCode: "2A", slotCount: 1, branches: ["Moteur"], teacherCodes: ["ChF"] }],
        warnings: [],
        excludedSpsCount: 0,
      },
      "horaire-test.pdf",
      yearId,
    );
    await deps.timetable.activateImport(imported.importRecord.id);
    await deps.timetable.mapClassToClassroom(imported.importRecord.id, "2A", "classe-demo-tma-2a");
    await deps.timetable.mapTeacherCode(imported.importRecord.id, "ChF", DEMO_CURRENT_TEACHER_ID);
  }
}

async function populateStructured(deps: CampusBackupDeps, teacherId: string) {
  await deps.years.seedDefaultActiveYearIfEmpty();
  const year = await deps.years.getActiveSchoolYear();
  assert.ok(year);
  await deps.years.setDayException(year.id, year.weeks[0]!.monday, { state: "holiday", label: "Fête" });
  await deps.catalog.ensureSeeded();
  const profession = await deps.catalog.createProfession({
    label: "Profession hors démo",
    durationYears: 4,
    classCodePrefix: "PHD",
  });
  const branches = await deps.catalog.listBranches();
  const moteur = branches.find((entry) => entry.label === "Moteur") ?? branches[0]!;
  await deps.catalog.updateBranch(moteur.id, { teachingType: "TECHNICAL" });
  const ctx = await deps.catalog.createContext({
    professionId: profession.id,
    trainingYear: 1,
    branchId: moteur.id,
  });
  assert.equal(ctx.ok, true);
  if (!ctx.ok) throw new Error(ctx.reason);
  const schoolClass = await deps.catalog.createClass({
    code: "PHD1Z",
    label: "PHD1Z",
    schoolYearId: year.id,
    schoolYearLabel: year.label,
    professionId: profession.id,
    trainingYear: 1,
    parallelCode: "Z",
  });
  const createdTeacher = await deps.teacherAccounts.createAccount({
    displayName: "Enseignant structure",
    initials: "StZ",
    teachingType: "TECHNICAL",
  });
  assert.equal(createdTeacher.ok, true);
  if (!createdTeacher.ok) throw new Error(createdTeacher.reason);
  const structuredTeacherId = createdTeacher.account.id;
  const courseDeps = {
    courses: deps.courses,
    catalog: deps.catalog,
    years: deps.years,
    teachers: deps.teacherAccounts,
    notes: deps.courseNotes!,
    schedules: deps.schedules,
  };
  const created = await createAnnualCourse(courseDeps, {
    schoolYearId: year.id,
    classId: schoolClass.id,
    contextId: ctx.value.id,
  });
  assert.equal(created.ok, true);
  if (!created.ok) throw new Error(created.reason);
  const assigned = await assignTeacherToCourse(courseDeps, {
    annualCourseId: created.value.id,
    teacherId: structuredTeacherId,
    role: "PRIMARY",
    createdByAdminId: teacherId,
  });
  assert.equal(assigned.ok, true, assigned.ok ? "" : assigned.reason);
  const scheduleDeps = {
    schedules: deps.schedules,
    courses: deps.courses,
    catalog: deps.catalog,
    years: deps.years,
    teachers: deps.teacherAccounts,
  };
  const attendance = await replaceAttendanceDaysForClass(scheduleDeps, schoolClass.id, [
    { dayOfWeek: 2, weekKind: "all", role: "PRIMARY" },
    { dayOfWeek: 5, weekKind: "A", role: "ADDITIONAL" },
  ]);
  assert.equal(attendance.ok, true);
  const slot = await createCourseScheduleSlot(scheduleDeps, {
    annualCourseId: created.value.id,
    dayOfWeek: 2,
    periodStart: 1,
    periodEnd: 2,
    weekKind: "all",
  });
  assert.equal(slot.ok, true);
  return { yearId: year.id, classId: schoolClass.id, courseId: created.value.id };
}

test("backup v4 — roundtrip mémoire", async () => {
  resetMemoryWorld();
  const deps = memoryDeps();
  await deps.years.seedDefaultActiveYearIfEmpty();
  const passwordHash = await hashPassword("Sauvegarde-V4-Memoire!");
  await deps.teacherAccounts.replaceAllAccounts([
    {
      id: DEMO_CURRENT_TEACHER_ID,
      displayName: "Admin V4",
      initials: "AV",
      isAdmin: true,
      isActive: true,
      mustChangePassword: false,
      passwordHash,
      createdAt: "2026-01-01T00:00:00.000Z",
      passwordUpdatedAt: "2026-01-02T00:00:00.000Z",
    },
  ]);
  await deps.teacherSetups.saveSetup(DEMO_CURRENT_TEACHER_ID, {
    version: 1,
    classes: [{ id: "c1", name: "2A", programLabel: "TMA", dayOfWeek: 1, branchNames: ["Moteur"], icon: "wrench" }],
  });
  const structured = await populateStructured(deps, DEMO_CURRENT_TEACHER_ID);
  await populateLibraryAndTimetable(deps, structured.yearId);

  const snapshot = await exportCampusSnapshot(deps);
  assert.equal(snapshot.version, 4);
  assert.equal(CAMPUS_BACKUP_INSERT_ORDER.length, 29);
  for (const table of CAMPUS_BACKUP_INSERT_ORDER) {
    assert.ok(Array.isArray(snapshot.tables[table]), table);
  }
  assert.ok(snapshot.tables.school_years?.length);
  assert.ok(snapshot.tables.school_weeks?.length);
  assert.ok(snapshot.tables.class_attendance_days?.length);
  assert.ok(snapshot.tables.course_schedule_slots?.length);
  assert.ok(snapshot.tables.annual_courses?.length);
  assert.ok(snapshot.tables.publication_templates?.length);
  assert.ok(snapshot.tables.timetable_imports?.length);
  assert.ok(snapshot.tables.timetable_slots?.length);

  await deps.agenda.createAgendaItem({
    classroomId: "classe-demo-tma-2a",
    subjectId: "subject-demo-moteur-2a",
    authorTeacherId: DEMO_CURRENT_TEACHER_ID,
    day: 0,
    hour: 8,
    weekOffset: 0,
    schoolWeekNumber: 12,
    type: "INFORMATION",
    title: "Temporaire",
    detail: "À écraser",
  });

  const restored = await restoreCampusSnapshot(deps, snapshot);
  assert.equal(restored.ok, true);
  if (!restored.ok) return;
  assert.equal(restored.restoredTables, true);
  const again = await exportCampusSnapshot(deps);
  assert.deepEqual(canonicalizeCampusDump(again.tables), canonicalizeCampusDump(snapshot.tables));
  assert.equal((await deps.agenda.exportAllItems()).length, snapshot.itemCount);
});

test("backup v4 — roundtrip SQLite", async () => {
  const db = createNodeSqliteDatabase(":memory:");
  await applyMigrations(db);
  await seedDemoDatabase(db);
  const deps = sqlDeps(db);
  const structured = await populateStructured(deps, DEMO_CURRENT_TEACHER_ID);
  await populateLibraryAndTimetable(deps, structured.yearId);
  const snapshot = await exportCampusSnapshot(deps);
  assert.equal(snapshot.version, 4);
  assert.equal(CAMPUS_BACKUP_INSERT_ORDER.length, 29);
  for (const table of CAMPUS_BACKUP_INSERT_ORDER) {
    assert.ok(Array.isArray(snapshot.tables[table]), table);
  }
  for (const table of [
    "teachers",
    "school_years",
    "school_weeks",
    "school_classes",
    "annual_courses",
    "teacher_course_assignments",
    "course_schedule_slots",
    "class_attendance_days",
    "agenda_items",
    "publication_templates",
    "timetable_imports",
    "timetable_slots",
    "timetable_class_mappings",
    "timetable_teacher_codes",
  ]) {
    assert.ok((snapshot.tables[table] ?? []).length > 0, table);
  }

  const db2 = createNodeSqliteDatabase(":memory:");
  await applyMigrations(db2);
  const deps2 = sqlDeps(db2);
  const restored = await restoreCampusSnapshot(deps2, snapshot);
  assert.equal(restored.ok, true, restored.ok ? "" : restored.reason);
  const dump = await dumpCampusTables(db2);
  assert.deepEqual(canonicalizeCampusDump(dump), canonicalizeCampusDump(snapshot.tables));
});

test("backup v4 — snapshot sans admin actif refusé", async () => {
  const result = validateCampusTables(
    tablesWithAdmin({
      teachers: [{ id: "t1", display_name: "X", initials: "Xx", password_hash: "x", is_admin: 0, is_active: 1 }],
    }),
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /administrateur/);
});

test("backup v4 — table absente refusée, DB inchangée", async () => {
  const db = createNodeSqliteDatabase(":memory:");
  await applyMigrations(db);
  await seedDemoDatabase(db);
  const deps = sqlDeps(db);
  const snapshot = await exportCampusSnapshot(deps);
  const before = canonicalizeCampusDump(await dumpCampusTables(db));
  delete snapshot.tables.course_schedule_slots;
  const restored = await restoreCampusSnapshot(deps, snapshot);
  assert.equal(restored.ok, false);
  if (!restored.ok) assert.match(restored.reason, /absente/);
  assert.deepEqual(canonicalizeCampusDump(await dumpCampusTables(db)), before);
});

test("backup v4 — colonne inconnue refusée, batch jamais exécuté", async () => {
  const db = createNodeSqliteDatabase(":memory:");
  await applyMigrations(db);
  await seedDemoDatabase(db);
  const deps = sqlDeps(db);
  const snapshot = await exportCampusSnapshot(deps);
  const before = canonicalizeCampusDump(await dumpCampusTables(db));
  let batchCalls = 0;
  const originalBatch = db.batch.bind(db);
  db.batch = async (statements) => {
    batchCalls += 1;
    return originalBatch(statements);
  };
  snapshot.tables.teachers = snapshot.tables.teachers.map((row, index) =>
    index === 0 ? { ...row, evil_drop: "1); DROP TABLE teachers;--" } : row,
  );
  const restored = await restoreCampusSnapshot(deps, snapshot);
  assert.equal(restored.ok, false);
  if (!restored.ok) assert.match(restored.reason, /inconnue/);
  assert.equal(batchCalls, 0);
  assert.deepEqual(canonicalizeCampusDump(await dumpCampusTables(db)), before);
});

test("backup v4 — booléens : 0/1 et boolean JS uniquement", () => {
  assert.deepEqual(parseBackupFlag(0), { ok: true, value: 0 });
  assert.deepEqual(parseBackupFlag(1), { ok: true, value: 1 });
  assert.deepEqual(parseBackupFlag(false), { ok: true, value: 0 });
  assert.deepEqual(parseBackupFlag(true), { ok: true, value: 1 });
  assert.equal(parseBackupFlag("0").ok, false);
  assert.equal(parseBackupFlag("1").ok, false);
  assert.equal(parseBackupFlag("false").ok, false);
  assert.equal(Boolean("0"), true);
  const result = validateCampusTables(
    tablesWithAdmin({
      teachers: [
        {
          id: "admin-1",
          display_name: "Admin",
          initials: "Ad",
          password_hash: "x",
          is_admin: "0",
          is_active: 1,
        },
      ],
    }),
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /booléen invalide/);
});

test("backup v4 — FK orpheline même si table parent vide", () => {
  const result = validateCampusTables(
    tablesWithAdmin({
      school_weeks: [
        { school_year_id: "year-absente", week_number: 1, week_kind: "A", monday: "2026-01-05" },
      ],
    }),
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /Référence school_weeks.school_year_id/);
});

test("backup v4 — FK incohérente refusée, SQL inchangé", async () => {
  const db = createNodeSqliteDatabase(":memory:");
  await applyMigrations(db);
  await seedDemoDatabase(db);
  const deps = sqlDeps(db);
  const snapshot = await exportCampusSnapshot(deps);
  const before = (await dumpCampusTables(db)).agenda_items.length;
  snapshot.tables.agenda_items = [
    ...(snapshot.tables.agenda_items ?? []),
    {
      id: 999999,
      classroom_id: "classe-inexistante",
      subject_id: "subject-demo-moteur-2a",
      author_teacher_id: DEMO_CURRENT_TEACHER_ID,
      day: 0,
      hour: 8,
      week_offset: 0,
      school_week_number: 12,
      type: "INFORMATION",
      title: "Orphelin",
      detail: "FK",
    },
  ];
  const restored = await restoreCampusSnapshot(deps, snapshot);
  assert.equal(restored.ok, false);
  assert.equal((await dumpCampusTables(db)).agenda_items.length, before);
});

test("backup v4 — rollback SQL si l'INSERT échoue", async () => {
  const db = createNodeSqliteDatabase(":memory:");
  await applyMigrations(db);
  await seedDemoDatabase(db);
  const deps = sqlDeps(db);
  await deps.years.seedDefaultActiveYearIfEmpty();
  const snapshot = await exportCampusSnapshot(deps);
  const beforeTeachers = (await dumpCampusTables(db)).teachers.length;
  const week = snapshot.tables.school_weeks?.[0];
  assert.ok(week);
  snapshot.tables.school_weeks = [...(snapshot.tables.school_weeks ?? []), { ...week }];
  const restored = await restoreCampusSnapshot(deps, snapshot);
  assert.equal(restored.ok, false);
  assert.equal((await dumpCampusTables(db)).teachers.length, beforeTeachers);
});

test("backup v1 reste lisible selon son périmètre historique", async () => {
  resetMemoryWorld();
  const deps = memoryDeps();
  const legacy = {
    version: 1 as const,
    exportedAt: new Date().toISOString(),
    itemCount: DEMO_PROTOTYPE_ITEMS.length,
    items: DEMO_PROTOTYPE_ITEMS.map((item) => ({ ...item })),
  };
  const restored = await restoreCampusSnapshot(deps, legacy);
  assert.equal(restored.ok, true);
  if (!restored.ok) return;
  assert.equal(restored.restoredTables, false);
  assert.equal(restored.restoredTeacherAccounts, false);
});

test("backup v3 historique toujours restaurable via restoreAgendaSnapshot", async () => {
  resetMemoryWorld();
  const deps = memoryDeps();
  const snapshot = {
    version: 3 as const,
    exportedAt: new Date().toISOString(),
    itemCount: DEMO_PROTOTYPE_ITEMS.length,
    items: DEMO_PROTOTYPE_ITEMS.map((item) => ({ ...item })),
    teacherSetupCount: 0,
    teacherSetups: [],
    teacherNotesCount: 0,
    teacherNotes: [],
    teacherAccountCount: 0,
    teacherAccounts: [],
  };
  const restored = await restoreAgendaSnapshot(deps, snapshot);
  assert.equal(restored.ok, true);
});
