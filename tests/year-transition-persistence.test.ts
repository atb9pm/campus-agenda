import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import type { PrototypeAgendaItem } from "../src/features/agenda/demo-items.ts";
import type { AnnualCourse } from "../src/features/annual-courses/types.ts";
import type { CourseSession } from "../src/features/course-sessions/types.ts";
import type { ReferencePedagogicalPath, ReferenceSession } from "../src/features/pedagogical-path/types.ts";
import {
  YEAR_TRANSITION_PREVIEW_ENGINE_VERSION,
  buildYearTransitionPreview,
  createPersistedYearTransitionPreview,
  yearTransitionPreviewFingerprint,
  yearTransitionPreviewFingerprintFromSnapshotJson,
  yearTransitionPreviewMaterialSnapshotJson,
  type YearTransitionPreviewInput,
  type YearTransitionPreviewStore,
} from "../src/features/year-transition/index.ts";
import { APP_VERSION } from "../src/lib/app-version.ts";
import {
  exportCampusSnapshot,
  restoreCampusSnapshot,
  type CampusBackupDeps,
} from "../src/lib/persistence/campus-backup.ts";
import { CAMPUS_BACKUP_INSERT_ORDER } from "../src/lib/persistence/campus-backup-tables.ts";
import { MemoryAgendaStore } from "../src/lib/persistence/memory-store.ts";
import { MemoryAnnualCourseStore } from "../src/lib/persistence/memory-annual-course-store.ts";
import { MemoryCourseScheduleStore } from "../src/lib/persistence/memory-course-schedule-store.ts";
import { MemoryMembershipStore } from "../src/lib/persistence/memory-membership-store.ts";
import { MemorySchoolCatalogStore } from "../src/lib/persistence/memory-school-catalog-store.ts";
import { MemorySchoolYearStore } from "../src/lib/persistence/memory-school-year-store.ts";
import { MemoryTeacherAccountStore } from "../src/lib/persistence/memory-teacher-account-store.ts";
import { MemoryTeacherNotesStore } from "../src/lib/persistence/memory-teacher-notes-store.ts";
import { MemoryTeacherSetupStore } from "../src/lib/persistence/memory-teacher-setup-store.ts";
import {
  MemoryYearTransitionPreviewStore,
  getMemoryYearTransitionPreviewStore,
  resetMemoryYearTransitionPreviewStore,
} from "../src/lib/persistence/memory-year-transition-preview-store.ts";
import { createNodeSqliteDatabase, type NodeSqliteDatabase } from "../src/lib/persistence/sql/adapters.ts";
import { applyMigrations, SQL_MIGRATION_FILES } from "../src/lib/persistence/sql/migrate.ts";
import { dumpCampusTables, validateCampusTables } from "../src/lib/persistence/sql/sql-campus-backup.ts";
import { SqlYearTransitionPreviewStore } from "../src/lib/persistence/sql/sql-year-transition-preview-store.ts";
import type { SqlBatchStatement, SqlDatabase } from "../src/lib/persistence/sql/types.ts";

const SOURCE_YEAR = "year-n";
const TARGET_YEAR = "year-n1";
const SOURCE_CLASS = "class-ma1a-n";
const TARGET_CLASS = "class-ma2a-n1";
const SOURCE_COURSE = "ac-source";
const TARGET_COURSE = "ac-target";
const CTX = "ctx-moteur-y1";
const ITEM_X = "item-X";
const SESS_P = "session-p";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function course(id: string, classId: string, schoolYearId: string): AnnualCourse {
  return {
    id,
    schoolYearId,
    classId,
    contextId: CTX,
    isArchived: false,
    archivedAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

function session(
  patch: Partial<CourseSession> & Pick<CourseSession, "sequenceNumber" | "date" | "schoolWeekNumber">,
): CourseSession {
  const annualCourseId = patch.annualCourseId ?? TARGET_COURSE;
  const schoolYearId = patch.schoolYearId ?? TARGET_YEAR;
  const date = patch.date;
  return {
    key: patch.key ?? `${schoolYearId}|${annualCourseId}|${date}`,
    schoolYearId,
    annualCourseId,
    classId: patch.classId ?? TARGET_CLASS,
    contextId: patch.contextId ?? CTX,
    date,
    schoolWeekNumber: patch.schoolWeekNumber,
    weekKind: patch.weekKind ?? "A",
    dayOfWeek: patch.dayOfWeek ?? 1,
    sequenceNumber: patch.sequenceNumber,
    segments: patch.segments ?? [{ scheduleSlotId: "slot-1", periodStart: 2, periodEnd: 3 }],
  };
}

function pathFor(sessions: ReferenceSession[]): ReferencePedagogicalPath {
  return {
    id: "path-1",
    contextId: CTX,
    sessions,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  };
}

function refSession(id: string, position: number, items: Array<{ id: string }>): ReferenceSession {
  return {
    id,
    position,
    label: `Séance ${position}`,
    items: items.map((item, index) => ({
      id: item.id,
      type: "HOMEWORK" as const,
      title: "Travail",
      detail: "Contenu",
      position: index + 1,
    })),
  };
}

function sourceItem(patch: Partial<PrototypeAgendaItem> = {}): PrototypeAgendaItem {
  return {
    id: patch.id ?? 10,
    classroomId: patch.classroomId ?? "classroom-n",
    subjectId: patch.subjectId ?? "subject-n",
    authorTeacherId: patch.authorTeacherId ?? "teacher-1",
    day: patch.day ?? 0,
    hour: patch.hour ?? 9,
    weekOffset: patch.weekOffset ?? 0,
    schoolWeekNumber: patch.schoolWeekNumber ?? 8,
    type: patch.type ?? "HOMEWORK",
    title: patch.title ?? "Travail historique",
    detail: patch.detail ?? "N",
    schoolYearId: patch.schoolYearId ?? SOURCE_YEAR,
    annualCourseId: patch.annualCourseId === undefined ? SOURCE_COURSE : patch.annualCourseId,
    courseSessionKey: patch.courseSessionKey ?? `${SOURCE_YEAR}|${SOURCE_COURSE}|2026-10-12`,
    courseSessionDate: patch.courseSessionDate ?? "2026-10-12",
    referenceSessionId: patch.referenceSessionId === undefined ? SESS_P : patch.referenceSessionId,
    referenceItemId: patch.referenceItemId === undefined ? ITEM_X : patch.referenceItemId,
    studentVisible: patch.studentVisible,
    templateId: patch.templateId ?? null,
  };
}

function baseInput(patch: Partial<YearTransitionPreviewInput> = {}): YearTransitionPreviewInput {
  return {
    sourceSchoolYearId: SOURCE_YEAR,
    targetSchoolYearId: TARGET_YEAR,
    classMappings: patch.classMappings ?? [{ sourceClassId: SOURCE_CLASS, targetClassId: TARGET_CLASS }],
    sourceCourses: patch.sourceCourses ?? [course(SOURCE_COURSE, SOURCE_CLASS, SOURCE_YEAR)],
    targetCourses: patch.targetCourses ?? [course(TARGET_COURSE, TARGET_CLASS, TARGET_YEAR)],
    sourceItems: patch.sourceItems ?? [sourceItem()],
    targetItems: patch.targetItems ?? [],
    pathSnapshots: patch.pathSnapshots ?? [
      pathFor([
        refSession("session-other", 1, [{ id: "item-other" }]),
        refSession(SESS_P, 2, [{ id: ITEM_X }]),
      ]),
    ],
    targetCourseSessions: patch.targetCourseSessions ?? [
      session({ sequenceNumber: 1, date: "2027-08-23", schoolWeekNumber: 1 }),
      session({ sequenceNumber: 2, date: "2027-09-27", schoolWeekNumber: 6 }),
    ],
    ...patch,
  };
}

function reversedInput(input: YearTransitionPreviewInput): YearTransitionPreviewInput {
  return {
    ...input,
    classMappings: [...input.classMappings].reverse(),
    sourceCourses: [...input.sourceCourses].reverse(),
    targetCourses: [...input.targetCourses].reverse(),
    sourceItems: [...input.sourceItems].reverse(),
    targetItems: [...input.targetItems].reverse(),
    pathSnapshots: [...input.pathSnapshots].reverse(),
    targetCourseSessions: [...input.targetCourseSessions].reverse(),
  };
}

function emptyTables() {
  const tables: Record<string, Array<Record<string, unknown>>> = {};
  for (const name of CAMPUS_BACKUP_INSERT_ORDER) tables[name] = [];
  return tables;
}

function tablesWithAdmin(overrides: Record<string, Array<Record<string, unknown>>> = {}) {
  return {
    ...emptyTables(),
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

function memoryBackupDeps(): CampusBackupDeps {
  return {
    agenda: new MemoryAgendaStore([]),
    teacherSetups: new MemoryTeacherSetupStore(),
    teacherNotes: new MemoryTeacherNotesStore(),
    teacherAccounts: new MemoryTeacherAccountStore(),
    catalog: new MemorySchoolCatalogStore(),
    years: new MemorySchoolYearStore(),
    courses: new MemoryAnnualCourseStore(),
    schedules: new MemoryCourseScheduleStore(),
    memberships: new MemoryMembershipStore(),
    sqlDb: null,
  };
}

async function persist(
  store: YearTransitionPreviewStore,
  input: YearTransitionPreviewInput = baseInput(),
  ids: { id?: string; now?: string } = {},
) {
  let n = 0;
  return createPersistedYearTransitionPreview(input, {
    store,
    idGenerator: ids.id ? () => ids.id! : () => `transition-${++n}-${Math.random().toString(16).slice(2)}`,
    now: ids.now ? () => ids.now! : undefined,
  });
}

function assertNoMutationApi(store: YearTransitionPreviewStore) {
  const record = store as unknown as Record<string, unknown>;
  for (const name of ["update", "replace", "mutate", "delete"]) {
    assert.equal(typeof record[name], "undefined", name);
  }
}

async function sqliteWorld(): Promise<{ db: NodeSqliteDatabase; store: SqlYearTransitionPreviewStore }> {
  const db = createNodeSqliteDatabase(":memory:");
  await applyMigrations(db);
  return { db, store: new SqlYearTransitionPreviewStore(db) };
}

test("1 — APP_VERSION toujours 2.62.0", () => {
  assert.equal(APP_VERSION, "2.62.0");
});

test("2 — dernière migration listée après 0031 (PR3 ajoute 0032)", () => {
  assert.ok(SQL_MIGRATION_FILES.includes("0031_year_transition_preview.sql"));
  assert.equal(SQL_MIGRATION_FILES.at(-1), "0033_annual_private_notes_storage.sql");
});

test("3 — migration crée les deux tables", async () => {
  const { db } = await sqliteWorld();
  try {
    const { results } = await db
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table'
           AND name IN ('year_transition_previews', 'year_transition_preview_entries')
         ORDER BY name`,
      )
      .bind()
      .all<{ name: string }>();
    assert.deepEqual(
      results.map((row) => row.name),
      ["year_transition_preview_entries", "year_transition_previews"],
    );
  } finally {
    db.close();
  }
});

test("4 — aucune table CourseSession persistée", async () => {
  const { db } = await sqliteWorld();
  try {
    const { results } = await db
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND lower(name) LIKE '%course_session%'`,
      )
      .bind()
      .all<{ name: string }>();
    assert.deepEqual(results, []);
  } finally {
    db.close();
  }
});

test("5 — engineVersion = 3", () => {
  assert.equal(YEAR_TRANSITION_PREVIEW_ENGINE_VERSION, 3);
  const snapshot = JSON.parse(yearTransitionPreviewMaterialSnapshotJson(baseInput())) as {
    engineVersion: number;
  };
  assert.equal(snapshot.engineVersion, 3);
});

test("6 — snapshot canonique déterministe", () => {
  assert.equal(
    yearTransitionPreviewMaterialSnapshotJson(baseInput()),
    yearTransitionPreviewMaterialSnapshotJson(baseInput()),
  );
});

test("7 — fingerprint = SHA256 exact de snapshot_json", () => {
  const snapshotJson = yearTransitionPreviewMaterialSnapshotJson(baseInput());
  const expected = createHash("sha256").update(snapshotJson).digest("hex");
  assert.equal(yearTransitionPreviewFingerprintFromSnapshotJson(snapshotJson), expected);
  assert.equal(yearTransitionPreviewFingerprint(baseInput()), expected);
  assert.equal(buildYearTransitionPreview(baseInput()).fingerprint, expected);
});

test("8 — ordre différent des inputs → même snapshot/fingerprint", () => {
  const input = baseInput();
  assert.equal(
    yearTransitionPreviewMaterialSnapshotJson(input),
    yearTransitionPreviewMaterialSnapshotJson(reversedInput(input)),
  );
  assert.equal(yearTransitionPreviewFingerprint(input), yearTransitionPreviewFingerprint(reversedInput(input)));
});

test("9 — temporels SOURCE N différents → même fingerprint", () => {
  const mutated = baseInput({
    sourceItems: [
      sourceItem({
        schoolWeekNumber: 38,
        day: 4,
        hour: 16,
        weekOffset: 9,
        courseSessionDate: "2026-12-01",
      }),
    ],
  });
  assert.equal(yearTransitionPreviewFingerprint(mutated), yearTransitionPreviewFingerprint(baseInput()));
});

test("9b — courseSessionKey source est matériel", () => {
  const mutated = baseInput({
    sourceItems: [sourceItem({ courseSessionKey: "other-key" })],
  });
  assert.notEqual(yearTransitionPreviewFingerprint(mutated), yearTransitionPreviewFingerprint(baseInput()));
});

test("10 — changement matériel TARGET → fingerprint différent", () => {
  const moved = baseInput({
    targetCourseSessions: [
      session({ sequenceNumber: 1, date: "2027-08-23", schoolWeekNumber: 1 }),
      session({
        sequenceNumber: 2,
        date: "2027-10-04",
        schoolWeekNumber: 7,
        key: `${TARGET_YEAR}|${TARGET_COURSE}|2027-10-04`,
      }),
    ],
  });
  assert.notEqual(yearTransitionPreviewFingerprint(moved), yearTransitionPreviewFingerprint(baseInput()));
});

test("11 — création memory", async () => {
  const store = new MemoryYearTransitionPreviewStore();
  const created = await persist(store, baseInput(), { id: "mem-1", now: "2027-01-01T00:00:00.000Z" });
  assert.equal(created.id, "mem-1");
  assert.equal(created.engineVersion, 3);
  assert.equal(created.appVersion, "2.62.0");
  assert.equal(created.entries.length, 1);
});

test("12 — création SQLite", async () => {
  const { db, store } = await sqliteWorld();
  try {
    const created = await persist(store, baseInput(), { id: "sql-1", now: "2027-01-01T00:00:00.000Z" });
    assert.equal(created.id, "sql-1");
    const loaded = await store.getById("sql-1");
    assert.equal(loaded?.fingerprint, created.fingerprint);
  } finally {
    db.close();
  }
});

test("13 — get par transitionId", async () => {
  const store = new MemoryYearTransitionPreviewStore();
  await persist(store, baseInput(), { id: "get-1" });
  const loaded = await store.getById("get-1");
  assert.equal(loaded?.id, "get-1");
  assert.equal(await store.getById("missing"), null);
});

test("14 — ledger complet", async () => {
  const store = new MemoryYearTransitionPreviewStore();
  const input = baseInput({
    sourceItems: [sourceItem({ id: 10 }), sourceItem({ id: 11, referenceItemId: "item-other" })],
  });
  const created = await persist(store, input, { id: "ledger-1" });
  const entries = await store.listEntries("ledger-1");
  assert.equal(entries.length, created.preview.entries.length);
  assert.equal(entries.length, 2);
  assert.deepEqual(
    entries.map((entry) => entry.sourceAgendaItemId).sort((a, b) => a - b),
    created.preview.entries.map((entry) => entry.sourceAgendaItemId).sort((a, b) => a - b),
  );
});

test("15 — entry_json roundtrip", async () => {
  const store = new MemoryYearTransitionPreviewStore();
  const created = await persist(store, baseInput(), { id: "entry-json" });
  const [entry] = await store.listEntries("entry-json");
  assert.deepEqual(JSON.parse(entry!.entryJson), created.preview.entries[0]);
});

test("16 — preview_json roundtrip", async () => {
  const store = new MemoryYearTransitionPreviewStore();
  const created = await persist(store, baseInput(), { id: "preview-json" });
  const loaded = await store.getById("preview-json");
  assert.deepEqual(JSON.parse(loaded!.previewJson), created.preview);
});

test("17 — snapshot_json roundtrip", async () => {
  const store = new MemoryYearTransitionPreviewStore();
  const input = baseInput();
  const created = await persist(store, input, { id: "snapshot-json" });
  const loaded = await store.getById("snapshot-json");
  assert.equal(loaded!.snapshotJson, yearTransitionPreviewMaterialSnapshotJson(input));
  assert.equal(loaded!.snapshotJson, created.snapshotJson);
  assert.deepEqual(JSON.parse(loaded!.snapshotJson), JSON.parse(created.snapshotJson));
});

test("18-19 — deux PREVIEW identiques → IDs différents, même fingerprint", async () => {
  const store = new MemoryYearTransitionPreviewStore();
  const input = baseInput();
  const first = await persist(store, input, { id: "A", now: "2027-01-01T00:00:00.000Z" });
  const second = await persist(store, input, { id: "B", now: "2027-01-02T00:00:00.000Z" });
  assert.notEqual(first.id, second.id);
  assert.equal(first.fingerprint, second.fingerprint);
  assert.equal((await store.list()).length, 2);
});

test("20 — aucune méthode métier update/delete", () => {
  assertNoMutationApi(new MemoryYearTransitionPreviewStore());
  assertNoMutationApi(new SqlYearTransitionPreviewStore({} as SqlDatabase));
});

test("21-22 — transaction SQLite atomique : erreur entry → aucun parent partiel", async () => {
  const db = createNodeSqliteDatabase(":memory:");
  await applyMigrations(db);
  const wrapped: SqlDatabase = {
    prepare: (query) => db.prepare(query),
    exec: (query) => db.exec(query),
    async batch(statements: SqlBatchStatement[]) {
      const mutated = statements.map((statement, index) =>
        index === statements.length - 1
          ? {
              sql: "INSERT INTO year_transition_preview_entries (transition_id) VALUES (?)",
              values: ["broken"],
            }
          : statement,
      );
      await db.batch(mutated);
    },
  };
  const store = new SqlYearTransitionPreviewStore(wrapped);
  await assert.rejects(() => persist(store, baseInput(), { id: "tx-fail" }));
  const parent = await db
    .prepare("SELECT COUNT(*) AS count FROM year_transition_previews")
    .bind()
    .first<{ count: number }>();
  const children = await db
    .prepare("SELECT COUNT(*) AS count FROM year_transition_preview_entries")
    .bind()
    .first<{ count: number }>();
  assert.equal(Number(parent?.count ?? -1), 0);
  assert.equal(Number(children?.count ?? -1), 0);
  db.close();
});

test("23 — backup courant contient les deux tables", () => {
  assert.ok(CAMPUS_BACKUP_INSERT_ORDER.includes("year_transition_previews"));
  assert.ok(CAMPUS_BACKUP_INSERT_ORDER.includes("year_transition_preview_entries"));
  assert.ok(
    CAMPUS_BACKUP_INSERT_ORDER.indexOf("year_transition_previews") <
      CAMPUS_BACKUP_INSERT_ORDER.indexOf("year_transition_preview_entries"),
  );
});

test("24 — backup/restore conserve PREVIEW + entries", async () => {
  resetMemoryYearTransitionPreviewStore();
  const store = getMemoryYearTransitionPreviewStore();
  const created = await persist(store, baseInput(), { id: "backup-1", now: "2027-03-01T00:00:00.000Z" });
  const deps = memoryBackupDeps();
  await deps.teacherAccounts.replaceAllAccounts([
    {
      id: "admin-1",
      displayName: "Admin",
      initials: "Ad",
      isAdmin: true,
      isActive: true,
      mustChangePassword: false,
      passwordHash: "x",
      createdAt: "2026-01-01T00:00:00.000Z",
      passwordUpdatedAt: null,
    },
  ]);
  const snapshot = await exportCampusSnapshot(deps);
  assert.equal(snapshot.tables.year_transition_previews?.length, 1);
  assert.equal(snapshot.tables.year_transition_preview_entries?.length, 1);

  resetMemoryYearTransitionPreviewStore();
  assert.equal(await getMemoryYearTransitionPreviewStore().getById("backup-1"), null);
  const restored = await restoreCampusSnapshot(deps, snapshot);
  assert.equal(restored.ok, true);
  const loaded = await getMemoryYearTransitionPreviewStore().getById("backup-1");
  assert.equal(loaded?.fingerprint, created.fingerprint);
  const entries = await getMemoryYearTransitionPreviewStore().listEntries("backup-1");
  assert.equal(entries.length, 1);
  resetMemoryYearTransitionPreviewStore();

  const { db, store: sqlStore } = await sqliteWorld();
  try {
    await db
      .prepare(
        `INSERT INTO teachers (id, display_name, initials, password_hash, is_admin, is_active)
         VALUES (?, ?, ?, ?, 1, 1)`,
      )
      .bind("admin-1", "Admin", "Ad", "x")
      .run();
    await persist(sqlStore, baseInput(), { id: "backup-sql", now: "2027-03-01T00:00:00.000Z" });
    const sqlDump = await dumpCampusTables(db);
    assert.equal(sqlDump.year_transition_previews.length, 1);
    const target = createNodeSqliteDatabase(":memory:");
    await applyMigrations(target);
    const sqlRestored = await restoreCampusSnapshot(
      {
        ...memoryBackupDeps(),
        sqlDb: target,
        teacherAccounts: new MemoryTeacherAccountStore(),
      },
      { version: 4, tables: sqlDump, exportedAt: "2027-03-01T00:00:00.000Z", itemCount: 0, items: [] },
    );
    assert.equal(sqlRestored.ok, true);
    const copied = await new SqlYearTransitionPreviewStore(target).getById("backup-sql");
    assert.equal(copied?.id, "backup-sql");
    target.close();
  } finally {
    db.close();
  }
});

test("25 — transition_id orphelin dans backup refusé", () => {
  const validated = validateCampusTables(
    tablesWithAdmin({
      year_transition_preview_entries: [
        {
          transition_id: "missing-parent",
          source_agenda_item_id: 10,
          reason: "PROJECTABLE",
          entry_json: "{}",
        },
      ],
    }),
  );
  assert.equal(validated.ok, false);
  if (!validated.ok) {
    assert.match(validated.reason, /year_transition_preview_entries\.transition_id/);
  }
});

function samplePreview(id: string, json: { snapshotJson?: string; previewJson?: string } = {}): Parameters<
  YearTransitionPreviewStore["create"]
>[0] {
  return {
    id,
    sourceSchoolYearId: SOURCE_YEAR,
    targetSchoolYearId: TARGET_YEAR,
    fingerprint: "x",
    engineVersion: 1,
    appVersion: APP_VERSION,
    snapshotJson: json.snapshotJson ?? "{}",
    previewJson: json.previewJson ?? "{}",
    createdAt: "2027-01-01T00:00:00.000Z",
  };
}

function sampleEntry(
  transitionId: string,
  sourceAgendaItemId: number,
): Parameters<YearTransitionPreviewStore["create"]>[1][number] {
  return {
    transitionId,
    sourceAgendaItemId,
    reason: "PROJECTABLE",
    referenceItemId: null,
    targetAnnualCourseId: null,
    entryJson: "{}",
  };
}

async function assertStoreEmpty(store: YearTransitionPreviewStore, id: string): Promise<void> {
  assert.equal(await store.getById(id), null);
  assert.equal((await store.list()).length, 0);
  assert.equal((await store.listEntries(id)).length, 0);
}

async function assertSqliteTablesEmpty(db: NodeSqliteDatabase): Promise<void> {
  const parent = await db.prepare("SELECT COUNT(*) AS count FROM year_transition_previews").bind().first<{ count: number }>();
  const children = await db
    .prepare("SELECT COUNT(*) AS count FROM year_transition_preview_entries")
    .bind()
    .first<{ count: number }>();
  assert.equal(Number(parent?.count ?? -1), 0);
  assert.equal(Number(children?.count ?? -1), 0);
}

test("26 — JSON invalide détecté à la lecture métier", async () => {
  const memory = new MemoryYearTransitionPreviewStore();
  await memory.create(
    {
      id: "bad-json",
      sourceSchoolYearId: SOURCE_YEAR,
      targetSchoolYearId: TARGET_YEAR,
      fingerprint: "x",
      engineVersion: 1,
      appVersion: APP_VERSION,
      snapshotJson: "{not-json",
      previewJson: "{}",
      createdAt: "2027-01-01T00:00:00.000Z",
    },
    [],
  );
  await assert.rejects(() => memory.getById("bad-json"), /snapshot_json JSON invalide/);

  const { db, store } = await sqliteWorld();
  try {
    await db
      .prepare(
        `INSERT INTO year_transition_previews (
          id, source_school_year_id, target_school_year_id, fingerprint, engine_version,
          app_version, snapshot_json, preview_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind("sql-bad", SOURCE_YEAR, TARGET_YEAR, "x", 1, APP_VERSION, "{}", "not-json", "2027-01-01T00:00:00.000Z")
      .run();
    await assert.rejects(() => store.getById("sql-bad"), /preview_json JSON invalide/);

    await db
      .prepare(
        `INSERT INTO year_transition_preview_entries (
          transition_id, source_agenda_item_id, reason, entry_json
        ) VALUES (?, ?, ?, ?)`,
      )
      .bind("sql-bad", 10, "PROJECTABLE", "null")
      .run();
    await assert.rejects(() => store.listEntries("sql-bad"), /entry_json JSON invalide/);
  } finally {
    db.close();
  }
});

test("Memory — transitionId incohérent → rejet, rien persisté", async () => {
  const store = new MemoryYearTransitionPreviewStore();
  await assert.rejects(
    () => store.create(samplePreview("transition-A"), [sampleEntry("transition-B", 10)]),
    /transition_id d’entrée incohérent/,
  );
  await assertStoreEmpty(store, "transition-A");
});

test("SQLite — transitionId incohérent → rejet, aucun parent/entry", async () => {
  const { db, store } = await sqliteWorld();
  try {
    await assert.rejects(
      () => store.create(samplePreview("transition-A"), [sampleEntry("transition-B", 10)]),
      /transition_id d’entrée incohérent/,
    );
    await assertStoreEmpty(store, "transition-A");
    await assertSqliteTablesEmpty(db);
  } finally {
    db.close();
  }
});

test("Memory — doublon sourceAgendaItemId → rejet, rien persisté", async () => {
  const store = new MemoryYearTransitionPreviewStore();
  await assert.rejects(
    () =>
      store.create(samplePreview("transition-A"), [
        sampleEntry("transition-A", 10),
        sampleEntry("transition-A", 10),
      ]),
    /source_agenda_item_id en double/,
  );
  await assertStoreEmpty(store, "transition-A");
});

test("SQLite — doublon sourceAgendaItemId → rejet, aucun parent/entry", async () => {
  const { db, store } = await sqliteWorld();
  try {
    await assert.rejects(
      () =>
        store.create(samplePreview("transition-A"), [
          sampleEntry("transition-A", 10),
          sampleEntry("transition-A", 10),
        ]),
      /source_agenda_item_id en double/,
    );
    await assertStoreEmpty(store, "transition-A");
    await assertSqliteTablesEmpty(db);
  } finally {
    db.close();
  }
});

test("Memory — list() refuse snapshot/preview JSON invalide", async () => {
  const store = new MemoryYearTransitionPreviewStore();
  await store.create(samplePreview("list-bad", { snapshotJson: "{not-json" }), []);
  await assert.rejects(() => store.list(), /snapshot_json JSON invalide/);
});

test("SQLite — list() refuse snapshot/preview JSON invalide", async () => {
  const { db, store } = await sqliteWorld();
  try {
    await db
      .prepare(
        `INSERT INTO year_transition_previews (
          id, source_school_year_id, target_school_year_id, fingerprint, engine_version,
          app_version, snapshot_json, preview_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind("list-sql-bad", SOURCE_YEAR, TARGET_YEAR, "x", 1, APP_VERSION, "{}", "not-json", "2027-01-01T00:00:00.000Z")
      .run();
    await assert.rejects(() => store.list(), /preview_json JSON invalide/);
  } finally {
    db.close();
  }
});

test("27 — aucun AgendaItem créé", async () => {
  const agenda = new MemoryAgendaStore([]);
  const before = await agenda.exportAllItems();
  await persist(new MemoryYearTransitionPreviewStore());
  const after = await agenda.exportAllItems();
  assert.deepEqual(after, before);
  assert.equal(after.length, 0);
});

test("28 — duplicateItemsFromArchivedYear non utilisé", async () => {
  const files = [
    "src/features/year-transition/persist.ts",
    "src/features/year-transition/persist-json.ts",
    "src/features/year-transition/store.ts",
    "src/lib/persistence/memory-year-transition-preview-store.ts",
    "src/lib/persistence/sql/sql-year-transition-preview-store.ts",
  ];
  for (const file of files) {
    const source = await readFile(join(ROOT, file), "utf8");
    assert.equal(source.includes("duplicateItemsFromArchivedYear"), false, file);
    assert.equal(source.includes("library/templates"), false, file);
  }
});

test("29 — les tests PR1 restent dans year-transition-preview.test.ts", async () => {
  const source = await readFile(join(ROOT, "tests/year-transition-preview.test.ts"), "utf8");
  const count = [...source.matchAll(/^test\(/gm)].length;
  assert.ok(count >= 46, `expected at least 46 preview tests, got ${count}`);
});

test("30 — APP_VERSION inchangée dans app-version.ts", async () => {
  const source = await readFile(join(ROOT, "src/lib/app-version.ts"), "utf8");
  assert.match(source, /export const APP_VERSION = "2\.62\.0"/);
});
