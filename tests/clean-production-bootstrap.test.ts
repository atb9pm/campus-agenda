import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env.CAMPUS_PBKDF2_ITERATIONS ??= "10000";

import { APP_VERSION } from "../src/lib/app-version.ts";
import { resetActiveSchoolWeekEntries } from "../src/features/calendar/active-calendar.ts";
import {
  CONTROL_COURSES_UNAVAILABLE_MESSAGE,
  SCHOOL_YEAR_UNCONFIGURED_MESSAGE,
  TEACHER_COURSES_EMPTY_MESSAGE,
  TEACHER_WEEK_EMPTY_CLASSES_MESSAGE,
} from "../src/features/teacher-workspace/index.ts";
import { CAMPUS_BACKUP_INSERT_ORDER } from "../src/lib/persistence/campus-backup-tables.ts";
import { exportCampusSnapshot } from "../src/lib/persistence/campus-backup.ts";
import {
  isProductionEnv,
  MISSING_PRODUCTION_ADMIN_PASSWORD,
  shouldSeedDemoData,
} from "../src/lib/persistence/demo-seed-policy.ts";
import { createNodeSqliteDatabase } from "../src/lib/persistence/sql/adapters.ts";
import { SQL_MIGRATION_FILES } from "../src/lib/persistence/sql/migrate.ts";
import { dumpCampusTables } from "../src/lib/persistence/sql/sql-campus-backup.ts";
import { SqlAgendaStore } from "../src/lib/persistence/sql/sql-agenda-store.ts";
import { SqlMembershipStore } from "../src/lib/persistence/sql/sql-membership-store.ts";
import {
  SqlAnnualCourseNotesStore,
  SqlPedagogicalPathStore,
} from "../src/lib/persistence/sql/sql-pedagogical-path-store.ts";
import { SqlTeacherAccountStore } from "../src/lib/persistence/sql/sql-teacher-account-store.ts";
import { SqlTeacherNotesStore } from "../src/lib/persistence/sql/sql-teacher-notes-store.ts";
import { SqlTeacherSetupStore } from "../src/lib/persistence/sql/sql-teacher-setup-store.ts";
import { SqlTemplateStore } from "../src/lib/persistence/sql/sql-template-store.ts";
import { SqlTimetableStore } from "../src/lib/persistence/sql/sql-timetable-store.ts";
import { prepareSqlDatabase } from "../src/lib/persistence/store-factory.ts";
import { describeBootstrapOutcome, ensureTeacherAccountBootstrap } from "../src/lib/persistence/teacher-account-bootstrap.ts";
import type { SqlDatabase } from "../src/lib/persistence/sql/types.ts";
import { getControlPlanning } from "../src/features/control-planning/service.ts";

const ADMIN_PASSWORD = "Bootstrap-2027-ok";
const BUSINESS_ZERO_TABLES = [
  "school_years",
  "school_weeks",
  "school_classes",
  "school_branches",
  "school_professions",
  "pedagogical_contexts",
  "annual_courses",
  "teacher_course_assignments",
  "teacher_course_assignment_events",
  "course_schedule_slots",
  "class_attendance_days",
  "classrooms",
  "subjects",
  "memberships",
  "membership_subjects",
  "student_accesses",
  "agenda_items",
  "publication_templates",
  "pedagogical_paths",
  "annual_course_notes",
  "teacher_notes",
  "teacher_setups",
  "school_day_exceptions",
  "timetable_imports",
  "timetable_slots",
  "timetable_class_mappings",
  "timetable_teacher_codes",
] as const;

async function countRows(db: SqlDatabase, table: string): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).bind().first<{ count: number }>();
  return Number(row?.count ?? 0);
}

async function withEnv<T>(
  patch: Record<string, string | undefined>,
  run: () => Promise<T>,
): Promise<T> {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(patch)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetActiveSchoolWeekEntries();
  }
}

async function bootstrapEmptyProduction(db: SqlDatabase) {
  return withEnv(
    {
      NODE_ENV: "production",
      CAMPUS_ADMIN_PASSWORD: ADMIN_PASSWORD,
      CAMPUS_ADMIN_INITIALS: "ChF",
      CAMPUS_ADMIN_DISPLAY_NAME: "Administrateur",
      CAMPUS_DEMO_SEED: "true",
      CAMPUS_ALLOW_DEMO_PASSWORD: "0",
    },
    async () => prepareSqlDatabase(db),
  );
}

test("version 2.47.0 — bootstrap production sans migration destructive", async () => {
  assert.equal(APP_VERSION, "2.47.0");
  assert.equal(SQL_MIGRATION_FILES.at(-1), "0027_teacher_author_nullable.sql");
  assert.equal(SQL_MIGRATION_FILES.includes("0027_delete_demo_data.sql" as (typeof SQL_MIGRATION_FILES)[number]), false);

  const storeFactory = await readFile(new URL("../src/lib/persistence/store-factory.ts", import.meta.url), "utf8");
  assert.match(storeFactory, /shouldSeedDemoData\(\)/);
  assert.match(storeFactory, /seedDemoDatabase\(db\)/);
  assert.match(storeFactory, /if \(shouldSeedDemoData\(\) && !\(await isDatabaseSeeded\(db\)\)\)/);
  assert.doesNotMatch(storeFactory, /DELETE FROM/);

  const migrate = await readFile(new URL("../src/lib/persistence/sql/migrate.ts", import.meta.url), "utf8");
  assert.doesNotMatch(migrate, /0027_delete_demo_data/);
});

test("shouldSeedDemoData — production jamais, même si CAMPUS_DEMO_SEED=true", () => {
  assert.equal(shouldSeedDemoData({ NODE_ENV: "production" }), false);
  assert.equal(shouldSeedDemoData({ NODE_ENV: "production", CAMPUS_DEMO_SEED: "true" }), false);
  assert.equal(shouldSeedDemoData({ NODE_ENV: "production", CAMPUS_DEMO_SEED: "1" }), false);
  assert.equal(isProductionEnv({ NODE_ENV: "production" }), true);

  assert.equal(shouldSeedDemoData({ NODE_ENV: "test" }), true);
  assert.equal(shouldSeedDemoData({ NODE_ENV: "development" }), true);
  assert.equal(shouldSeedDemoData({ NODE_ENV: "test", CAMPUS_DEMO_SEED: "true" }), true);
  assert.equal(shouldSeedDemoData({ NODE_ENV: "test", CAMPUS_DEMO_SEED: "false" }), false);
  assert.equal(shouldSeedDemoData({ NODE_ENV: "development", CAMPUS_DEMO_SEED: "0" }), false);
});

test("A/C — SQLite neuf en production : 1 admin bootstrap, zéro métier, pas de démo", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "campus-clean-"));
  const sqlitePath = path.join(dir, "campus.sqlite");
  const db = createNodeSqliteDatabase(sqlitePath);
  try {
    await withEnv(
      {
        NODE_ENV: "production",
        CAMPUS_ADMIN_PASSWORD: ADMIN_PASSWORD,
        CAMPUS_ADMIN_INITIALS: "ChF",
        CAMPUS_ADMIN_DISPLAY_NAME: "Administrateur",
        CAMPUS_DEMO_SEED: "true",
        CAMPUS_ALLOW_DEMO_PASSWORD: "0",
      },
      async () => {
        const prepared = await prepareSqlDatabase(db);
        const teachers = await prepared.teacherAccountStore.listAccounts();
        assert.equal(teachers.length, 1);
        assert.equal(teachers[0]?.isAdmin, true);
        assert.equal(teachers[0]?.isActive, true);
        assert.equal(teachers[0]?.initials, "ChF");
        assert.equal(teachers[0]?.id, "teacher-chf");

        assert.equal(await countRows(db, "teachers"), 1);
        for (const table of BUSINESS_ZERO_TABLES) {
          assert.equal(await countRows(db, table), 0, table);
        }
        assert.ok((await countRows(db, "schema_migrations")) > 0);

        assert.deepEqual(await prepared.schoolCatalogStore.listClasses(), []);
        assert.deepEqual(await prepared.schoolCatalogStore.listBranches(), []);
        assert.deepEqual(await prepared.schoolCatalogStore.listProfessions(), []);
        assert.deepEqual(await prepared.schoolCatalogStore.listContexts(), []);
        assert.equal(await prepared.schoolYearStore.getActiveSchoolYear(), null);
        assert.deepEqual(await prepared.schoolYearStore.listSchoolYears(), []);

        const auth = await prepared.teacherAccountStore.authenticate("ChF", ADMIN_PASSWORD);
        assert.equal(auth.ok, true);

        const demoIds = await db
          .prepare("SELECT id FROM teachers WHERE id LIKE ? OR id LIKE ?")
          .bind("%demo%", "teacher-demo%")
          .all<{ id: string }>();
        assert.equal((demoIds.results ?? []).length, 0);

        const seededYears = await db
          .prepare("SELECT COUNT(*) AS count FROM school_years WHERE source_filename = ?")
          .bind("seed")
          .first<{ count: number }>();
        assert.equal(Number(seededYears?.count ?? 0), 0);

        const maClasses = await db
          .prepare("SELECT COUNT(*) AS count FROM school_classes WHERE code IN (?, ?)")
          .bind("MA1", "MA2")
          .first<{ count: number }>();
        assert.equal(Number(maClasses?.count ?? 0), 0);
      },
    );
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("B — second démarrage : toujours 1 admin, mot de passe non écrasé", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "campus-clean-"));
  const sqlitePath = path.join(dir, "campus.sqlite");
  const db = createNodeSqliteDatabase(sqlitePath);
  try {
    await bootstrapEmptyProduction(db);
    const firstHash = await db
      .prepare("SELECT password_hash AS hash FROM teachers")
      .bind()
      .first<{ hash: string }>();
    assert.ok(firstHash?.hash.startsWith("pbkdf2-sha256$"));

    const second = await bootstrapEmptyProduction(db);
    const teachers = await second.teacherAccountStore.listAccounts();
    assert.equal(teachers.length, 1);
    const secondHash = await db
      .prepare("SELECT password_hash AS hash FROM teachers")
      .bind()
      .first<{ hash: string }>();
    assert.equal(secondHash?.hash, firstHash?.hash);
    assert.equal(await countRows(db, "school_classes"), 0);
    assert.equal(await countRows(db, "school_years"), 0);
    assert.equal(await countRows(db, "agenda_items"), 0);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("C — production sans CAMPUS_ADMIN_PASSWORD : erreur claire, aucune démo", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "campus-clean-"));
  const sqlitePath = path.join(dir, "campus.sqlite");
  const db = createNodeSqliteDatabase(sqlitePath);
  try {
    await assert.rejects(
      () =>
        withEnv(
          {
            NODE_ENV: "production",
            CAMPUS_ADMIN_PASSWORD: undefined,
            CAMPUS_DEMO_SEED: "true",
          },
          async () => prepareSqlDatabase(db),
        ),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, MISSING_PRODUCTION_ADMIN_PASSWORD);
        assert.equal(error.message.includes(ADMIN_PASSWORD), false);
        return true;
      },
    );
    assert.equal(await countRows(db, "teachers"), 0);
    assert.equal(await countRows(db, "school_classes"), 0);
    assert.equal(await countRows(db, "school_years"), 0);
    assert.equal(await countRows(db, "agenda_items"), 0);
    assert.equal(await countRows(db, "classrooms"), 0);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("D — enseignants existants : aucun faux admin injecté", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "campus-clean-"));
  const sqlitePath = path.join(dir, "campus.sqlite");
  const db = createNodeSqliteDatabase(sqlitePath);
  try {
    await withEnv(
      {
        NODE_ENV: "production",
        CAMPUS_ADMIN_PASSWORD: ADMIN_PASSWORD,
        CAMPUS_ADMIN_INITIALS: "ChF",
      },
      async () => {
        const { applyMigrations } = await import("../src/lib/persistence/sql/migrate.ts");
        await applyMigrations(db);
        const store = new SqlTeacherAccountStore(db);
        const created = await store.createAccount({
          displayName: "Marie Dupont",
          initials: "MD",
          isAdmin: false,
        });
        assert.equal(created.ok, true);
        const outcome = await ensureTeacherAccountBootstrap(store);
        assert.equal(outcome.action, "no-admin");
        const accounts = await store.listAccounts();
        assert.equal(accounts.length, 1);
        assert.equal(accounts[0]?.initials, "MD");
        assert.equal(accounts[0]?.isAdmin, false);
      },
    );
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("E — le mot de passe admin n'apparaît jamais dans les journaux d'amorçage", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "campus-clean-"));
  const sqlitePath = path.join(dir, "campus.sqlite");
  const db = createNodeSqliteDatabase(sqlitePath);
  const lines: string[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    await bootstrapEmptyProduction(db);
    const described = describeBootstrapOutcome({
      action: "created-bootstrap",
      teacherId: "teacher-chf",
      initials: "ChF",
    });
    assert.ok(described);
    assert.equal(described.includes(ADMIN_PASSWORD), false);
    assert.equal(lines.join("\n").includes(ADMIN_PASSWORD), false);
    assert.match(lines.join("\n"), /Administrateur initial créé/);
  } finally {
    console.warn = warn;
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("backup v4 reste utilisable après bootstrap d'une base vierge", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "campus-clean-"));
  const sqlitePath = path.join(dir, "campus.sqlite");
  const db = createNodeSqliteDatabase(sqlitePath);
  try {
    const prepared = await bootstrapEmptyProduction(db);
    const agenda = new SqlAgendaStore(db);
    const snapshot = await exportCampusSnapshot({
      agenda,
      teacherSetups: new SqlTeacherSetupStore(db),
      teacherNotes: new SqlTeacherNotesStore(db),
      teacherAccounts: prepared.teacherAccountStore,
      catalog: prepared.schoolCatalogStore,
      years: prepared.schoolYearStore,
      courses: prepared.annualCourseStore,
      schedules: prepared.courseScheduleStore,
      memberships: new SqlMembershipStore(db),
      paths: new SqlPedagogicalPathStore(db),
      courseNotes: new SqlAnnualCourseNotesStore(db),
      templates: new SqlTemplateStore(db, agenda),
      timetable: new SqlTimetableStore(db),
      sqlDb: db,
    });
    assert.equal(snapshot.version, 4);
    assert.equal(snapshot.tables.teachers.length, 1);
    for (const table of BUSINESS_ZERO_TABLES) {
      assert.equal((snapshot.tables[table] ?? []).length, 0, table);
    }
    const dump = await dumpCampusTables(db);
    assert.equal(dump.teachers.length, 1);
    for (const name of CAMPUS_BACKUP_INSERT_ORDER) {
      assert.ok(name in dump, name);
    }
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("planning contrôles sans année : Aucun cours disponible", async () => {
  const result = await getControlPlanning(
    {
      agenda: {
        listAgendaItems: async () => [],
        teacherCanAccessClassroom: async () => false,
      },
      adapters: { listClassrooms: async () => [], listSubjects: async () => [] },
      catalog: {
        ensureSeeded: async () => undefined,
        seedDefaultCatalogIfEmpty: async () => undefined,
        listClasses: async () => [],
        listContexts: async () => [],
        listBranches: async () => [],
      },
      courses: { listCourses: async () => [], listAssignments: async () => [] },
      years: {
        listSchoolYears: async () => [],
        getActiveSchoolYear: async () => null,
        getSchoolYearById: async () => null,
        listDayExceptions: async () => [],
      },
      teachers: { listAccounts: async () => [] },
    } as never,
    { teacherId: "teacher-chf" },
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, CONTROL_COURSES_UNAVAILABLE_MESSAGE);
    assert.equal(result.status, 404);
  }
});

test("états vides UI — messages et pas de fallback DEMO_CATALOG enseignant", async () => {
  assert.equal(TEACHER_COURSES_EMPTY_MESSAGE, "Aucun cours ne vous est encore attribué.");
  assert.equal(TEACHER_WEEK_EMPTY_CLASSES_MESSAGE, "Aucune classe configurée.");
  assert.equal(SCHOOL_YEAR_UNCONFIGURED_MESSAGE, "Aucune année scolaire configurée.");
  assert.equal(CONTROL_COURSES_UNAVAILABLE_MESSAGE, "Aucun cours disponible.");

  const page = await readFile(new URL("../web/app/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /getClassroomsForTeacher\(DEMO_CATALOG/);
  assert.doesNotMatch(page, /buildDefaultTeacherSetup\(DEMO_CATALOG/);
  assert.doesNotMatch(page, /DEMO_CATALOG\.classrooms\[0\]/);
  assert.doesNotMatch(page, /DEMO_PROTOTYPE_ITEMS/);
  assert.match(page, /emptyTeacherSetup\(\)/);
  assert.match(page, /EMPTY_CLASSROOM_CATALOG/);

  const admin = await readFile(new URL("../web/app/components/school-year-admin-panel.tsx", import.meta.url), "utf8");
  assert.match(admin, /SCHOOL_YEAR_UNCONFIGURED_MESSAGE/);

  const semaine = await readFile(new URL("../web/app/components/ma-semaine-panel.tsx", import.meta.url), "utf8");
  assert.match(semaine, /TEACHER_WEEK_EMPTY_CLASSES_MESSAGE/);

  const cours = await readFile(new URL("../web/app/components/mes-cours-panel.tsx", import.meta.url), "utf8");
  assert.match(cours, /TEACHER_COURSES_EMPTY_MESSAGE/);
  assert.match(cours, /error \?/);

  const calendarRoute = await readFile(
    new URL("../web/app/api/school-year/calendar/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(calendarRoute, /configured: false/);
  assert.match(calendarRoute, /label: null/);
});
