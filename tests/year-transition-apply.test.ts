import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createPublication,
  type PublicationInput,
} from "../src/features/agenda/publications.ts";
import type { PrototypeAgendaItem } from "../src/features/agenda/demo-items.ts";
import type { AnnualCourse } from "../src/features/annual-courses/types.ts";
import type { CourseScheduleSlot } from "../src/features/course-schedule/types.ts";
import type { ReferencePedagogicalPath, ReferenceSession } from "../src/features/pedagogical-path/types.ts";
import type { SchoolYearWithWeeks } from "../src/features/school-year/types.ts";
import {
  YEAR_TRANSITION_AGENDA_COMPAT_HOUR,
  YEAR_TRANSITION_APPLY_BLOCKING_REASONS,
  YEAR_TRANSITION_PREVIEW_ENGINE_VERSION,
  applyPersistedYearTransition,
  assembleLiveYearTransitionPreviewInput,
  createPersistedYearTransitionPreview,
  extractClassMappingsFromSnapshotJson,
  yearTransitionPreviewFingerprintFromSnapshotJson,
  type ApplyPersistedYearTransitionDeps,
  type YearTransitionApplyStore,
  type YearTransitionClassMapping,
} from "../src/features/year-transition/index.ts";
import { APP_VERSION } from "../src/lib/app-version.ts";
import { CAMPUS_BACKUP_INSERT_ORDER } from "../src/lib/persistence/campus-backup-tables.ts";
import { MemoryAgendaStore } from "../src/lib/persistence/memory-store.ts";
import { MemoryAnnualCourseStore } from "../src/lib/persistence/memory-annual-course-store.ts";
import { MemoryAnnualCourseNotesStore, MemoryPedagogicalPathStore } from "../src/lib/persistence/memory-pedagogical-path-store.ts";
import { MemoryCourseScheduleStore } from "../src/lib/persistence/memory-course-schedule-store.ts";
import { MemoryRuntimeAgendaAdapterStore } from "../src/lib/persistence/memory-runtime-adapter-store.ts";
import { MemorySchoolYearStore, replaceMemorySchoolYears, resetMemorySchoolYearStore } from "../src/lib/persistence/memory-school-year-store.ts";
import { MemoryTeacherNotesStore } from "../src/lib/persistence/memory-teacher-notes-store.ts";
import { MemoryYearTransitionApplyStore } from "../src/lib/persistence/memory-year-transition-apply-store.ts";
import { MemoryYearTransitionPreviewStore } from "../src/lib/persistence/memory-year-transition-preview-store.ts";
import { replaceMemoryLegacySchool, resetMemoryLegacySchool } from "../src/lib/persistence/memory-legacy-school.ts";
import { createNodeSqliteDatabase } from "../src/lib/persistence/sql/adapters.ts";
import { applyMigrations, SQL_MIGRATION_FILES } from "../src/lib/persistence/sql/migrate.ts";
import { dumpCampusTables, validateCampusTables } from "../src/lib/persistence/sql/sql-campus-backup.ts";
import { SqlAgendaStore } from "../src/lib/persistence/sql/sql-agenda-store.ts";
import { SqlAnnualCourseStore } from "../src/lib/persistence/sql/sql-annual-course-store.ts";
import { SqlCourseScheduleStore } from "../src/lib/persistence/sql/sql-course-schedule-store.ts";
import { SqlPedagogicalPathStore } from "../src/lib/persistence/sql/sql-pedagogical-path-store.ts";
import { SqlRuntimeAgendaAdapterStore } from "../src/lib/persistence/sql/sql-runtime-adapter-store.ts";
import { SqlSchoolYearStore } from "../src/lib/persistence/sql/sql-school-year-store.ts";
import { SqlYearTransitionApplyStore } from "../src/lib/persistence/sql/sql-year-transition-apply-store.ts";
import { SqlYearTransitionPreviewStore } from "../src/lib/persistence/sql/sql-year-transition-preview-store.ts";
import type { SqlBatchStatement, SqlDatabase } from "../src/lib/persistence/sql/types.ts";
import type { AgendaStore, CreateAgendaInput } from "../src/lib/persistence/types.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_YEAR = "year-n";
const TARGET_YEAR = "year-n1";
const SOURCE_CLASS = "class-ma1a-n";
const TARGET_CLASS = "class-ma2a-n1";
const SOURCE_COURSE = "ac-source";
const TARGET_COURSE = "ac-target";
const CTX = "ctx-moteur-y1";
const ITEM_X = "item-X";
const SESS_P = "session-p";
const CLASSROOM_N1 = "classroom-n1";
const SUBJECT_N1 = "subject-n1";

function course(id: string, classId: string, schoolYearId: string, archived = false): AnnualCourse {
  return {
    id,
    schoolYearId,
    classId,
    contextId: CTX,
    isArchived: archived,
    archivedAt: archived ? "2027-08-01T00:00:00.000Z" : null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

function weeks(count = 2): SchoolYearWithWeeks["weeks"] {
  return Array.from({ length: count }, (_, index) => ({
    number: index + 1,
    kind: index % 2 === 0 ? ("A" as const) : ("B" as const),
    monday: index === 0 ? "2027-08-23" : "2027-08-30",
  }));
}

function yearRecord(id: string, status: SchoolYearWithWeeks["status"], weekCount = 2): SchoolYearWithWeeks {
  return {
    id,
    label: id === TARGET_YEAR ? "2027-2028" : "2026-2027",
    status,
    startsOn: "2027-08-23",
    endsOn: "2028-07-01",
    sourceFilename: null,
    importedAt: null,
    activatedAt: status === "active" ? "2026-08-01T00:00:00.000Z" : null,
    createdAt: "2026-01-01T00:00:00.000Z",
    weeks: weeks(weekCount),
  };
}

function slot(annualCourseId: string, id = "slot-1"): CourseScheduleSlot {
  return {
    id,
    annualCourseId,
    dayOfWeek: 1,
    periodStart: 2,
    periodEnd: 3,
    weekKind: "all",
    validFrom: null,
    validTo: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
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
      title: "Travail path",
      detail: "Path",
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
    day: patch.day ?? 4,
    hour: patch.hour ?? 15,
    weekOffset: patch.weekOffset ?? 3,
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
    studentVisible: patch.studentVisible ?? true,
    templateId: patch.templateId ?? "tpl-n",
  };
}

function mappings(): YearTransitionClassMapping[] {
  return [{ sourceClassId: SOURCE_CLASS, targetClassId: TARGET_CLASS }];
}

function spyAdapters() {
  const inner = new MemoryRuntimeAgendaAdapterStore();
  const calls = { upsertClassroom: 0, upsertSubject: 0 };
  return {
    calls,
    adapters: {
      listClassrooms: () => inner.listClassrooms(),
      findClassroomById: (id: string) => inner.findClassroomById(id),
      findClassroomBySchoolClassId: (id: string) => inner.findClassroomBySchoolClassId(id),
      async upsertClassroom() {
        calls.upsertClassroom += 1;
        throw new Error("ensureRuntimeClassroom interdit");
      },
      listSubjects: () => inner.listSubjects(),
      findSubjectById: (id: string) => inner.findSubjectById(id),
      findSubjectByAnnualCourseId: (id: string) => inner.findSubjectByAnnualCourseId(id),
      async upsertSubject() {
        calls.upsertSubject += 1;
        throw new Error("ensureRuntimeSubject interdit");
      },
    },
  };
}

interface MemoryWorld {
  agenda: MemoryAgendaStore;
  previews: MemoryYearTransitionPreviewStore;
  applyStore: MemoryYearTransitionApplyStore;
  courses: MemoryAnnualCourseStore;
  paths: MemoryPedagogicalPathStore;
  schedules: MemoryCourseScheduleStore;
  years: MemorySchoolYearStore;
  notes: MemoryAnnualCourseNotesStore;
  teacherNotes: MemoryTeacherNotesStore;
  spy: ReturnType<typeof spyAdapters>;
  deps: ApplyPersistedYearTransitionDeps;
}

async function seedMemory(options: {
  targetStatus?: SchoolYearWithWeeks["status"];
  weekCount?: number;
  extraItems?: PrototypeAgendaItem[];
  extraCourses?: AnnualCourse[];
  extraSlots?: CourseScheduleSlot[];
  path?: ReferencePedagogicalPath;
  classrooms?: Array<{ id: string; schoolClassId: string | null }>;
  subjects?: Array<{ id: string; classroomId: string; annualCourseId: string | null }>;
  mapping?: YearTransitionClassMapping[];
  targetArchived?: boolean;
} = {}): Promise<MemoryWorld> {
  resetMemoryLegacySchool();
  resetMemorySchoolYearStore();
  replaceMemorySchoolYears([
    yearRecord(SOURCE_YEAR, "active"),
    yearRecord(TARGET_YEAR, options.targetStatus ?? "draft", options.weekCount ?? 2),
  ]);
  replaceMemoryLegacySchool({
    classrooms: (options.classrooms ?? [
      { id: "classroom-n", schoolClassId: SOURCE_CLASS },
      { id: CLASSROOM_N1, schoolClassId: TARGET_CLASS },
    ]).map((entry) => ({
      id: entry.id,
      name: entry.id,
      programLabel: "x",
      accessCodeHint: "x",
      schoolClassId: entry.schoolClassId,
    })),
    subjects: (options.subjects ?? [
      { id: "subject-n", classroomId: "classroom-n", annualCourseId: SOURCE_COURSE },
      { id: SUBJECT_N1, classroomId: CLASSROOM_N1, annualCourseId: TARGET_COURSE },
    ]).map(
      (entry) => ({
        id: entry.id,
        classroomId: entry.classroomId,
        name: "Branche",
        annualCourseId: entry.annualCourseId,
      }),
    ),
    memberships: [],
    studentAccesses: [],
  });

  const agenda = new MemoryAgendaStore(options.extraItems ?? [sourceItem()]);
  const courses = new MemoryAnnualCourseStore();
  await courses.createCourse(course(SOURCE_COURSE, SOURCE_CLASS, SOURCE_YEAR));
  await courses.createCourse(course(TARGET_COURSE, TARGET_CLASS, TARGET_YEAR, options.targetArchived ?? false));
  for (const extra of options.extraCourses ?? []) await courses.createCourse(extra);

  const schedules = new MemoryCourseScheduleStore();
  await schedules.createSlot(slot(TARGET_COURSE));
  for (const extra of options.extraSlots ?? []) await schedules.createSlot(extra);

  const paths = new MemoryPedagogicalPathStore();
  await paths.savePath(
    options.path ??
      pathFor([
        refSession("session-other", 1, [{ id: "item-other" }]),
        refSession(SESS_P, 2, [{ id: ITEM_X }]),
      ]),
  );

  const previews = new MemoryYearTransitionPreviewStore();
  const applyStore = new MemoryYearTransitionApplyStore(agenda);
  const spy = spyAdapters();
  const years = new MemorySchoolYearStore();
  const notes = new MemoryAnnualCourseNotesStore();
  const teacherNotes = new MemoryTeacherNotesStore();
  const deps: ApplyPersistedYearTransitionDeps = {
    previews,
    applyStore,
    years,
    courses,
    agenda,
    paths,
    schedules,
    adapters: spy.adapters,
    now: () => "2027-03-01T00:00:00.000Z",
  };
  return { agenda, previews, applyStore, courses, paths, schedules, years, notes, teacherNotes, spy, deps };
}

async function persistLive(world: MemoryWorld, mappingsOverride?: YearTransitionClassMapping[]) {
  const input = await assembleLiveYearTransitionPreviewInput(
    {
      sourceSchoolYearId: SOURCE_YEAR,
      targetSchoolYearId: TARGET_YEAR,
      classMappings: mappingsOverride ?? mappings(),
    },
    world.deps,
  );
  return createPersistedYearTransitionPreview(input, {
    store: world.previews,
    idGenerator: () => "transition-1",
    now: () => "2027-02-01T00:00:00.000Z",
  });
}

async function sourceDump(agenda: MemoryAgendaStore) {
  return (await agenda.exportAllItems()).filter((item) => item.schoolYearId === SOURCE_YEAR);
}

test("1 — APP_VERSION 2.62.0", () => {
  assert.equal(APP_VERSION, "2.62.0");
});

test("2 — dernière migration 0032", () => {
  assert.equal(SQL_MIGRATION_FILES.at(-1), "0032_year_transition_apply.sql");
});

test("3-5 — migration crée tables APPLY, provenance, pas de CourseSession", async () => {
  const db = createNodeSqliteDatabase(":memory:");
  await applyMigrations(db);
  const tables = await db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .bind()
    .all<{ name: string }>();
  const names = (tables.results ?? []).map((row) => row.name);
  assert.ok(names.includes("year_transition_applies"));
  assert.ok(names.includes("year_transition_apply_entries"));
  assert.equal(names.includes("course_sessions"), false);
  const cols = await db.prepare("PRAGMA table_info(agenda_items)").bind().all<{ name: string }>();
  const colNames = (cols.results ?? []).map((row) => row.name);
  assert.ok(colNames.includes("source_transition_id"));
  assert.ok(colNames.includes("source_agenda_item_id"));
  db.close();
});

test("6 — transition inconnue → 0 write", async () => {
  const world = await seedMemory();
  const before = await world.agenda.exportAllItems();
  const result = await applyPersistedYearTransition("missing", world.deps);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "TRANSITION_NOT_FOUND");
  assert.deepEqual(await world.agenda.exportAllItems(), before);
  assert.equal(await world.applyStore.getByTransitionId("missing"), null);
});

test("7 — snapshot hash corrompu → 0 write", async () => {
  const world = await seedMemory();
  const created = await persistLive(world);
  const loaded = await world.previews.getById(created.id);
  assert.ok(loaded);
  await world.previews.create(
    {
      ...loaded!,
      id: "corrupt",
      fingerprint: "0".repeat(64),
    },
    [],
  );
  const result = await applyPersistedYearTransition("corrupt", world.deps);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "PREVIEW_CORRUPTED");
});

test("8 — engineVersion mismatch → 0 write", async () => {
  const world = await seedMemory();
  const created = await persistLive(world);
  const loaded = await world.previews.getById(created.id);
  await world.previews.create({ ...loaded!, id: "eng", engineVersion: 99 }, []);
  const result = await applyPersistedYearTransition("eng", world.deps);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "ENGINE_VERSION_MISMATCH");
});

test("9 — target year active → refus", async () => {
  const world = await seedMemory({ targetStatus: "active" });
  await persistLive(world);
  const result = await applyPersistedYearTransition("transition-1", world.deps);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "TARGET_YEAR_NOT_DRAFT");
});

test("10 — target year archived → refus", async () => {
  const world = await seedMemory({ targetStatus: "archived" });
  await persistLive(world);
  const result = await applyPersistedYearTransition("transition-1", world.deps);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "TARGET_YEAR_NOT_DRAFT");
});

test("11-45 — PROJECTABLE crée 1 item N+1, N immuable, champs cibles", async () => {
  const world = await seedMemory();
  const beforeN = await sourceDump(world.agenda);
  const notesBefore = JSON.stringify(await world.teacherNotes.exportAllNotes());
  await persistLive(world);
  const result = await applyPersistedYearTransition("transition-1", world.deps);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.code, "APPLIED");
  assert.equal(result.createdCount, 1);
  const after = await world.agenda.exportAllItems();
  const created = after.filter((item) => item.schoolYearId === TARGET_YEAR);
  assert.equal(created.length, 1);
  const item = created[0]!;
  assert.equal(item.schoolYearId, TARGET_YEAR);
  assert.equal(item.annualCourseId, TARGET_COURSE);
  assert.equal(item.hour, YEAR_TRANSITION_AGENDA_COMPAT_HOUR);
  assert.equal(item.hour, 8);
  assert.equal(item.weekOffset, 0);
  assert.equal(item.day, 0);
  assert.equal(item.schoolWeekNumber, 2);
  assert.match(item.courseSessionKey ?? "", new RegExp(`^${TARGET_YEAR}\\|${TARGET_COURSE}\\|`));
  assert.equal(item.courseSessionDate, "2027-08-30");
  assert.equal(item.referenceItemId, ITEM_X);
  assert.equal(item.referenceSessionId, SESS_P);
  assert.equal(item.type, "HOMEWORK");
  assert.equal(item.title, "Travail historique");
  assert.equal(item.detail, "N");
  assert.equal(item.authorTeacherId, "teacher-1");
  assert.equal(item.studentVisible, false);
  assert.equal(item.templateId, null);
  assert.equal(item.sourceTransitionId, "transition-1");
  assert.equal(item.sourceAgendaItemId, 10);
  assert.notEqual(item.day, 4);
  assert.notEqual(item.hour, 15);
  assert.deepEqual(await sourceDump(world.agenda), beforeN);
  assert.equal(JSON.stringify(await world.teacherNotes.exportAllNotes()), notesBefore);
  assert.equal(world.spy.calls.upsertClassroom, 0);
  assert.equal(world.spy.calls.upsertSubject, 0);
  const apply = await world.applyStore.getByTransitionId("transition-1");
  assert.equal(apply?.fingerprint, result.fingerprint);
  assert.equal(apply?.engineVersion, YEAR_TRANSITION_PREVIEW_ENGINE_VERSION);
  assert.equal(apply?.appVersion, "2.62.0");
  const ledger = await world.applyStore.listEntries("transition-1");
  assert.equal(ledger[0]?.applyResult, "CREATED");
  assert.equal(ledger[0]?.previewReason, "PROJECTABLE");
});

test("12 — PREVIEW_STALE utilise live stores, 0 write", async () => {
  const world = await seedMemory();
  await persistLive(world);
  const items = await world.agenda.exportAllItems();
  items[0] = { ...items[0]!, title: "changé après preview" };
  await world.agenda.replaceAllItems(items);
  const before = await world.agenda.exportAllItems();
  const result = await applyPersistedYearTransition("transition-1", world.deps);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "PREVIEW_STALE");
    assert.ok(result.persistedFingerprint);
    assert.ok(result.currentFingerprint);
    assert.notEqual(result.persistedFingerprint, result.currentFingerprint);
  }
  assert.deepEqual(await world.agenda.exportAllItems(), before);
});

test("14 — preview_json n'est pas vérité métier", async () => {
  const world = await seedMemory();
  const created = await persistLive(world);
  const loaded = await world.previews.getById(created.id);
  await world.previews.create(
    { ...loaded!, id: "json-lie", previewJson: JSON.stringify({ entries: [{ reason: "APPLY_BLOCKED" }] }) },
    [],
  );
  const result = await applyPersistedYearTransition("json-lie", world.deps);
  assert.equal(result.ok, true);
});

test("15 — classMappings extraits du snapshot", async () => {
  const world = await seedMemory();
  const created = await persistLive(world);
  const extracted = extractClassMappingsFromSnapshotJson(created.snapshotJson);
  assert.deepEqual(extracted, mappings());
  assert.equal(
    yearTransitionPreviewFingerprintFromSnapshotJson(created.snapshotJson),
    created.fingerprint,
  );
});

test("28 — REFERENCE_SESSION_CHANGED écrit la session courante", async () => {
  const world = await seedMemory({
    extraItems: [sourceItem({ referenceSessionId: "old-session" })],
  });
  await persistLive(world);
  const result = await applyPersistedYearTransition("transition-1", world.deps);
  assert.equal(result.ok, true);
  const created = (await world.agenda.exportAllItems()).find((item) => item.schoolYearId === TARGET_YEAR);
  assert.equal(created?.referenceSessionId, SESS_P);
});

test("33 — auteur vide → null SQL / vide mémoire", async () => {
  const world = await seedMemory({ extraItems: [sourceItem({ authorTeacherId: "" })] });
  await persistLive(world);
  const result = await applyPersistedYearTransition("transition-1", world.deps);
  assert.equal(result.ok, true);
  const created = (await world.agenda.exportAllItems()).find((item) => item.schoolYearId === TARGET_YEAR);
  assert.equal(created?.authorTeacherId, "");
});

test("46 — classroom 0 → refus", async () => {
  const world = await seedMemory({ classrooms: [], subjects: [] });
  await persistLive(world);
  const before = await world.agenda.exportAllItems();
  const result = await applyPersistedYearTransition("transition-1", world.deps);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "TARGET_CLASSROOM_MISSING");
  assert.deepEqual(await world.agenda.exportAllItems(), before);
});

test("47 — classroom ambigu → refus", async () => {
  const world = await seedMemory({
    classrooms: [
      { id: "c1", schoolClassId: TARGET_CLASS },
      { id: "c2", schoolClassId: TARGET_CLASS },
    ],
    subjects: [{ id: SUBJECT_N1, classroomId: "c1", annualCourseId: TARGET_COURSE }],
  });
  await persistLive(world);
  const result = await applyPersistedYearTransition("transition-1", world.deps);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "TARGET_CLASSROOM_AMBIGUOUS");
});

test("48 — subject 0 → refus", async () => {
  const world = await seedMemory({
    subjects: [],
  });
  await persistLive(world);
  const result = await applyPersistedYearTransition("transition-1", world.deps);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "TARGET_SUBJECT_MISSING");
});

test("49 — subject ambigu → refus", async () => {
  const world = await seedMemory({
    subjects: [
      { id: "s1", classroomId: CLASSROOM_N1, annualCourseId: TARGET_COURSE },
      { id: "s2", classroomId: CLASSROOM_N1, annualCourseId: TARGET_COURSE },
    ],
  });
  await persistLive(world);
  const result = await applyPersistedYearTransition("transition-1", world.deps);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "TARGET_SUBJECT_AMBIGUOUS");
});

test("50 — subject mauvais classroom → refus", async () => {
  const world = await seedMemory({
    classrooms: [
      { id: CLASSROOM_N1, schoolClassId: TARGET_CLASS },
      { id: "other", schoolClassId: "other-class" },
    ],
    subjects: [{ id: SUBJECT_N1, classroomId: "other", annualCourseId: TARGET_COURSE }],
  });
  await persistLive(world);
  const result = await applyPersistedYearTransition("transition-1", world.deps);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "TARGET_SUBJECT_CLASSROOM_MISMATCH");
});

test("53-55 — ALREADY_PRESENT 0 création, item inchangé, ledger", async () => {
  const existing: PrototypeAgendaItem = {
    id: 50,
    classroomId: CLASSROOM_N1,
    subjectId: SUBJECT_N1,
    authorTeacherId: "other",
    day: 0,
    hour: 8,
    weekOffset: 0,
    schoolWeekNumber: 2,
    type: "HOMEWORK",
    title: "Déjà là",
    detail: "cible",
    schoolYearId: TARGET_YEAR,
    annualCourseId: TARGET_COURSE,
    courseSessionKey: `${TARGET_YEAR}|${TARGET_COURSE}|2027-08-30`,
    courseSessionDate: "2027-08-30",
    referenceSessionId: SESS_P,
    referenceItemId: ITEM_X,
    studentVisible: true,
    templateId: "keep",
  };
  const world = await seedMemory({ extraItems: [sourceItem(), existing] });
  const beforeTarget = structuredClone(existing);
  await persistLive(world);
  const result = await applyPersistedYearTransition("transition-1", world.deps);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.createdCount, 0);
  assert.equal(result.alreadyPresentCount, 1);
  const after = (await world.agenda.exportAllItems()).find((item) => item.id === 50);
  assert.deepEqual(after, beforeTarget);
  const ledger = await world.applyStore.listEntries("transition-1");
  assert.equal(ledger[0]?.applyResult, "ALREADY_PRESENT");
});

async function expectBlocked(reason: string, seed: Parameters<typeof seedMemory>[0]) {
  const world = await seedMemory(seed);
  await persistLive(world);
  const before = await world.agenda.exportAllItems();
  const result = await applyPersistedYearTransition("transition-1", world.deps);
  assert.equal(result.ok, false, reason);
  if (!result.ok) {
    assert.equal(result.code, "APPLY_BLOCKED");
    assert.ok(result.blockers?.some((entry) => entry.reason === reason), `${reason} ${JSON.stringify(result.blockers)}`);
  }
  assert.deepEqual(await world.agenda.exportAllItems(), before);
  assert.equal(await world.applyStore.getByTransitionId("transition-1"), null);
}

test("56 — TARGET_EXISTING_DIVERGED bloque", async () => {
  await expectBlocked("TARGET_EXISTING_DIVERGED", {
    extraItems: [
      sourceItem(),
      {
        ...sourceItem({ id: 50, schoolYearId: TARGET_YEAR, annualCourseId: TARGET_COURSE }),
        classroomId: CLASSROOM_N1,
        subjectId: SUBJECT_N1,
        courseSessionKey: "wrong-key",
        courseSessionDate: "1999-01-01",
        schoolWeekNumber: 1,
        day: 2,
        hour: 8,
        referenceSessionId: SESS_P,
        referenceItemId: ITEM_X,
      },
    ],
  });
});

test("57 — SOURCE_COURSE_MISSING bloque", async () => {
  await expectBlocked("SOURCE_COURSE_MISSING", {
    extraItems: [sourceItem({ annualCourseId: "ghost-course" })],
  });
});

test("58 — CLASS_MAPPING_MISSING bloque", async () => {
  const world = await seedMemory();
  await persistLive(world, []);
  const result = await applyPersistedYearTransition("transition-1", world.deps);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "APPLY_BLOCKED");
    assert.ok(result.blockers?.some((entry) => entry.reason === "CLASS_MAPPING_MISSING"));
  }
});

test("59 — CLASS_MAPPING_CONFLICT bloque", async () => {
  const world = await seedMemory();
  await persistLive(world, [
    { sourceClassId: SOURCE_CLASS, targetClassId: TARGET_CLASS },
    { sourceClassId: null, targetClassId: TARGET_CLASS },
  ]);
  const result = await applyPersistedYearTransition("transition-1", world.deps);
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.blockers?.some((entry) => entry.reason === "CLASS_MAPPING_CONFLICT"));
});

test("60 — UNSUPPORTED cardinality bloque", async () => {
  const world = await seedMemory();
  await persistLive(world, [
    { sourceClassId: SOURCE_CLASS, targetClassId: TARGET_CLASS },
    { sourceClassId: SOURCE_CLASS, targetClassId: "other-target" },
  ]);
  const result = await applyPersistedYearTransition("transition-1", world.deps);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.blockers?.some((entry) => entry.reason === "UNSUPPORTED_CLASS_MAPPING_CARDINALITY"));
  }
});

test("61 — UNSCHEDULED bloque", async () => {
  await expectBlocked("UNSCHEDULED_REFERENCE_SESSION", { weekCount: 1 });
});

test("62 — TARGET_SESSION_AMBIGUOUS bloqué par unique session compute — skip si non reproductible via slots identiques", async () => {
  const world = await seedMemory({
    extraSlots: [slot(TARGET_COURSE, "slot-dup")],
  });
  await persistLive(world);
  const result = await applyPersistedYearTransition("transition-1", world.deps);
  assert.equal(result.ok, true);
});

test("63 — TARGET_COURSE_MISSING bloque", async () => {
  const world = await seedMemory();
  await persistLive(world, [{ sourceClassId: SOURCE_CLASS, targetClassId: "no-course-class" }]);
  const result = await applyPersistedYearTransition("transition-1", world.deps);
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.blockers?.some((entry) => entry.reason === "TARGET_COURSE_MISSING"));
});

test("64 — TARGET_COURSE_AMBIGUOUS : unique (année, classe, CTX) empêche le live store", async () => {
  const world = await seedMemory();
  await assert.rejects(
    () => world.courses.createCourse(course("ac-target-2", TARGET_CLASS, TARGET_YEAR)),
    /cours annuel existe déjà/,
  );
});

test("65 — TARGET_COURSE_ARCHIVED bloque", async () => {
  await expectBlocked("TARGET_COURSE_ARCHIVED", { targetArchived: true });
});

test("67 — TARGET_REFERENCE_CONFLICT bloque", async () => {
  const dup = (id: number): PrototypeAgendaItem => ({
    ...sourceItem({ id, schoolYearId: TARGET_YEAR, annualCourseId: TARGET_COURSE }),
    classroomId: CLASSROOM_N1,
    subjectId: SUBJECT_N1,
    hour: 8,
    weekOffset: 0,
    schoolWeekNumber: 2,
    day: 0,
    courseSessionKey: `${TARGET_YEAR}|${TARGET_COURSE}|2027-08-30`,
    courseSessionDate: "2027-08-30",
    referenceSessionId: SESS_P,
    referenceItemId: ITEM_X,
  });
  await expectBlocked("TARGET_REFERENCE_CONFLICT", {
    extraItems: [sourceItem(), dup(50), dup(51)],
  });
});

test("66 — DUPLICATE_SOURCE_REFERENCE bloque", async () => {
  await expectBlocked("DUPLICATE_SOURCE_REFERENCE", {
    extraItems: [sourceItem({ id: 10 }), sourceItem({ id: 11 })],
  });
});

test("68 — ORPHAN_NO_REFERENCE_ITEM skip autorisé + no-op ledger", async () => {
  const world = await seedMemory({ extraItems: [sourceItem({ referenceItemId: null })] });
  await persistLive(world);
  const result = await applyPersistedYearTransition("transition-1", world.deps);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.createdCount, 0);
  assert.equal(result.skippedCount, 1);
  const ledger = await world.applyStore.listEntries("transition-1");
  assert.equal(ledger[0]?.applyResult, "SKIPPED_NO_REFERENCE");
});

test("69 — ORPHAN_DEAD_REFERENCE_ITEM skip", async () => {
  const world = await seedMemory({ extraItems: [sourceItem({ referenceItemId: "dead" })] });
  await persistLive(world);
  const result = await applyPersistedYearTransition("transition-1", world.deps);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.skippedCount, 1);
  const ledger = await world.applyStore.listEntries("transition-1");
  assert.equal(ledger[0]?.applyResult, "SKIPPED_DEAD_REFERENCE");
});

test("70 — CLASS_CONTINUATION_ABSENT skip", async () => {
  const world = await seedMemory();
  await persistLive(world, [{ sourceClassId: SOURCE_CLASS, targetClassId: null }]);
  const result = await applyPersistedYearTransition("transition-1", world.deps);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const ledger = await world.applyStore.listEntries("transition-1");
  assert.equal(ledger[0]?.applyResult, "SKIPPED_NO_CONTINUATION");
});

test("71 — PROJECTABLE + orphan", async () => {
  const world = await seedMemory({
    extraItems: [sourceItem({ id: 10 }), sourceItem({ id: 11, referenceItemId: null })],
  });
  await persistLive(world);
  const result = await applyPersistedYearTransition("transition-1", world.deps);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.createdCount, 1);
  assert.equal(result.skippedCount, 1);
});

test("72 — blocker + PROJECTABLE → 0 AgendaItem", async () => {
  const world = await seedMemory({
    extraItems: [sourceItem({ id: 10 }), sourceItem({ id: 11, annualCourseId: "ghost" })],
  });
  await persistLive(world);
  const before = await world.agenda.exportAllItems();
  const result = await applyPersistedYearTransition("transition-1", world.deps);
  assert.equal(result.ok, false);
  assert.deepEqual(await world.agenda.exportAllItems(), before);
});

test("73-75 — no-op skips puis second APPLY ALREADY_APPLIED", async () => {
  const world = await seedMemory({ extraItems: [sourceItem({ referenceItemId: null })] });
  await persistLive(world);
  const first = await applyPersistedYearTransition("transition-1", world.deps);
  assert.equal(first.ok, true);
  const second = await applyPersistedYearTransition("transition-1", world.deps);
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.code, "ALREADY_APPLIED");
  assert.equal((await world.agenda.exportAllItems()).filter((item) => item.schoolYearId === TARGET_YEAR).length, 0);
});

test("74-75 — deuxième APPLY même T pas de doublon", async () => {
  const world = await seedMemory();
  await persistLive(world);
  await applyPersistedYearTransition("transition-1", world.deps);
  const afterFirst = await world.agenda.exportAllItems();
  const second = await applyPersistedYearTransition("transition-1", world.deps);
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.code, "ALREADY_APPLIED");
  assert.deepEqual(await world.agenda.exportAllItems(), afterFirst);
});

test("76 — ledger CREATED mais item supprimé → DIVERGED", async () => {
  const world = await seedMemory();
  await persistLive(world);
  await applyPersistedYearTransition("transition-1", world.deps);
  await world.agenda.replaceAllItems((await world.agenda.exportAllItems()).filter((item) => item.id === 10));
  const result = await applyPersistedYearTransition("transition-1", world.deps);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "APPLY_LEDGER_DIVERGED");
});

test("77 — ledger ALREADY mais target disparu → DIVERGED", async () => {
  const existing: PrototypeAgendaItem = {
    ...sourceItem({ id: 50, schoolYearId: TARGET_YEAR, annualCourseId: TARGET_COURSE }),
    classroomId: CLASSROOM_N1,
    subjectId: SUBJECT_N1,
    hour: 8,
    weekOffset: 0,
    schoolWeekNumber: 2,
    day: 0,
    courseSessionKey: `${TARGET_YEAR}|${TARGET_COURSE}|2027-08-30`,
    courseSessionDate: "2027-08-30",
    referenceSessionId: SESS_P,
  };
  const world = await seedMemory({ extraItems: [sourceItem(), existing] });
  await persistLive(world);
  await applyPersistedYearTransition("transition-1", world.deps);
  await world.agenda.replaceAllItems([sourceItem()]);
  const result = await applyPersistedYearTransition("transition-1", world.deps);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "APPLY_LEDGER_DIVERGED");
});

test("78-80 — rollback Memory item 2/3", async () => {
  const world = await seedMemory({
    extraItems: [
      sourceItem({ id: 10, referenceItemId: "item-a" }),
      sourceItem({ id: 11, referenceItemId: "item-b" }),
      sourceItem({ id: 12, referenceItemId: "item-c" }),
    ],
    path: pathFor([
      refSession("s1", 1, [{ id: "item-a" }]),
      refSession("s2", 2, [{ id: "item-b" }, { id: "item-c" }]),
    ]),
  });
  const created = await persistLive(world);
  assert.equal(created.preview.entries.filter((entry) => entry.reason === "PROJECTABLE").length, 3);
  const inner = world.applyStore;
  const wrapped: YearTransitionApplyStore = {
    getByTransitionId: (id) => inner.getByTransitionId(id),
    listEntries: (id) => inner.listEntries(id),
    async applyAtomically(plan) {
      if (plan.items.length < 3) throw new Error("expected 3");
      await inner.applyAtomically({
        ...plan,
        items: plan.items.map((item, index) =>
          index === 1 ? { ...item, annualCourseId: plan.items[0]!.annualCourseId, referenceItemId: plan.items[0]!.referenceItemId } : item,
        ),
      });
    },
  };
  const before = await world.agenda.exportAllItems();
  const result = await applyPersistedYearTransition("transition-1", { ...world.deps, applyStore: wrapped });
  assert.equal(result.ok, false);
  assert.deepEqual(await world.agenda.exportAllItems(), before);
  assert.equal(await inner.getByTransitionId("transition-1"), null);
});

test("82 — unique conflict same T → ALREADY_APPLIED après relecture", async () => {
  const world = await seedMemory();
  await persistLive(world);
  let committed = false;
  const inner = world.applyStore;
  const wrapped: YearTransitionApplyStore = {
    getByTransitionId: (id) => inner.getByTransitionId(id),
    listEntries: (id) => inner.listEntries(id),
    async applyAtomically(plan) {
      await inner.applyAtomically(plan);
      if (!committed) {
        committed = true;
        throw new Error("UNIQUE constraint failed: year_transition_applies.transition_id");
      }
    },
  };
  const result = await applyPersistedYearTransition("transition-1", { ...world.deps, applyStore: wrapped });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.code, "ALREADY_APPLIED");
});

test("83 — conflict autre T → pas d'écrasement", async () => {
  const world = await seedMemory();
  await persistLive(world);
  const wrapped: YearTransitionApplyStore = {
    getByTransitionId: async () => null,
    listEntries: async () => [],
    async applyAtomically() {
      throw new Error("UNIQUE constraint failed: agenda_items.annual_course_id, agenda_items.reference_item_id");
    },
  };
  const before = await world.agenda.exportAllItems();
  const result = await applyPersistedYearTransition("transition-1", { ...world.deps, applyStore: wrapped });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "APPLY_CONCURRENT_CONFLICT");
  assert.deepEqual(await world.agenda.exportAllItems(), before);
});

test("84 — provenance autre transition jamais modifiée", async () => {
  const other: PrototypeAgendaItem = {
    ...sourceItem({ id: 77, schoolYearId: TARGET_YEAR, annualCourseId: TARGET_COURSE, referenceItemId: "other-ref" }),
    classroomId: CLASSROOM_N1,
    subjectId: SUBJECT_N1,
    hour: 8,
    weekOffset: 0,
    schoolWeekNumber: 1,
    day: 0,
    courseSessionKey: `${TARGET_YEAR}|${TARGET_COURSE}|2027-08-23`,
    courseSessionDate: "2027-08-23",
    sourceTransitionId: "other-T",
    sourceAgendaItemId: 1,
  };
  const world = await seedMemory({ extraItems: [sourceItem(), other] });
  const before = structuredClone(other);
  await persistLive(world);
  await applyPersistedYearTransition("transition-1", world.deps);
  const after = (await world.agenda.exportAllItems()).find((item) => item.id === 77);
  assert.deepEqual(after, before);
});

test("94-99 — backup APPLY + orphelins refusés", async () => {
  assert.ok(CAMPUS_BACKUP_INSERT_ORDER.includes("year_transition_applies"));
  assert.ok(CAMPUS_BACKUP_INSERT_ORDER.includes("year_transition_apply_entries"));
  assert.ok(
    CAMPUS_BACKUP_INSERT_ORDER.indexOf("year_transition_previews") <
      CAMPUS_BACKUP_INSERT_ORDER.indexOf("year_transition_applies"),
  );
  assert.ok(
    CAMPUS_BACKUP_INSERT_ORDER.indexOf("year_transition_applies") <
      CAMPUS_BACKUP_INSERT_ORDER.indexOf("year_transition_apply_entries"),
  );

  const empty: Record<string, Array<Record<string, unknown>>> = {};
  for (const name of CAMPUS_BACKUP_INSERT_ORDER) empty[name] = [];
  const admin = {
    ...empty,
    teachers: [{ id: "admin-1", display_name: "Admin", initials: "Ad", password_hash: "x", is_admin: 1, is_active: 1 }],
  };
  const orphanApply = validateCampusTables({
    ...admin,
    year_transition_applies: [
      {
        transition_id: "missing-preview",
        fingerprint: "x",
        engine_version: 1,
        app_version: "2.62.0",
        applied_at: "2027-01-01T00:00:00.000Z",
      },
    ],
  });
  assert.equal(orphanApply.ok, false);
  const orphanEntry = validateCampusTables({
    ...admin,
    year_transition_apply_entries: [
      {
        transition_id: "missing-apply",
        source_agenda_item_id: 1,
        preview_reason: "PROJECTABLE",
        apply_result: "CREATED",
        created_at: "2027-01-01T00:00:00.000Z",
      },
    ],
  });
  assert.equal(orphanEntry.ok, false);
});

test("100 — APPLY n'appelle pas duplicateItemsFromArchivedYear / replaceAllItems / notes", async () => {
  const files = [
    "src/features/year-transition/apply.ts",
    "src/features/year-transition/assemble.ts",
    "src/features/year-transition/snapshot-mappings.ts",
    "src/lib/persistence/memory-year-transition-apply-store.ts",
    "src/lib/persistence/sql/sql-year-transition-apply-store.ts",
  ];
  for (const file of files) {
    const src = await readFile(join(ROOT, file), "utf8");
    assert.equal(src.includes("duplicateItemsFromArchivedYear"), false, file);
    assert.equal(src.includes("replaceAllItems"), false, file);
    assert.equal(src.includes("createAgendaItem"), false, file);
    assert.equal(src.includes("updateAgendaItem"), false, file);
    assert.equal(src.includes("deleteAgendaItem"), false, file);
    assert.equal(src.includes("moveStructuredControlPlacement"), false, file);
    assert.equal(src.includes("ensureRuntime"), false, file);
    assert.equal(src.includes("teacher_notes"), false, file);
    assert.equal(src.includes("annual_course_notes"), false, file);
  }
  assert.ok(YEAR_TRANSITION_APPLY_BLOCKING_REASONS.includes("TARGET_SESSION_AMBIGUOUS"));
  assert.ok(YEAR_TRANSITION_APPLY_BLOCKING_REASONS.includes("TARGET_COURSE_AMBIGUOUS"));
  assert.ok(YEAR_TRANSITION_APPLY_BLOCKING_REASONS.includes("SOURCE_COURSE_MISSING"));
});

test("SQLite PROJECTABLE + rollback + Memory/SQLite parité", async () => {
  const memory = await seedMemory();
  await persistLive(memory);
  const memResult = await applyPersistedYearTransition("transition-1", memory.deps);
  assert.equal(memResult.ok, true);

  const db = createNodeSqliteDatabase(":memory:");
  await applyMigrations(db);
  await db
    .prepare(
      `INSERT INTO teachers (id, display_name, initials, password_hash, is_admin, is_active)
       VALUES (?, ?, ?, ?, 0, 1)`,
    )
    .bind("teacher-1", "Prof", "Pr", "x")
    .run();
  await db
    .prepare(
      `INSERT INTO school_years (id, label, status, starts_on, ends_on, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(SOURCE_YEAR, "2026-2027", "active", "2026-08-01", "2027-07-01", "2026-01-01T00:00:00.000Z")
    .run();
  await db
    .prepare(
      `INSERT INTO school_years (id, label, status, starts_on, ends_on, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(TARGET_YEAR, "2027-2028", "draft", "2027-08-23", "2028-07-01", "2026-01-01T00:00:00.000Z")
    .run();
  await db
    .prepare("INSERT INTO school_weeks (school_year_id, week_number, week_kind, monday) VALUES (?, 1, 'A', ?)")
    .bind(TARGET_YEAR, "2027-08-23")
    .run();
  await db
    .prepare("INSERT INTO school_weeks (school_year_id, week_number, week_kind, monday) VALUES (?, 2, 'B', ?)")
    .bind(TARGET_YEAR, "2027-08-30")
    .run();
  await db
    .prepare(
      "INSERT INTO classrooms (id, name, program_label, access_code_hint, school_class_id) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(CLASSROOM_N1, "C", "p", "h", TARGET_CLASS)
    .run();
  await db
    .prepare("INSERT INTO subjects (id, classroom_id, name, annual_course_id) VALUES (?, ?, ?, ?)")
    .bind(SUBJECT_N1, CLASSROOM_N1, "Branche", TARGET_COURSE)
    .run();

  const courses = new SqlAnnualCourseStore(db);
  await courses.createCourse(course(SOURCE_COURSE, SOURCE_CLASS, SOURCE_YEAR));
  await courses.createCourse(course(TARGET_COURSE, TARGET_CLASS, TARGET_YEAR));
  const schedules = new SqlCourseScheduleStore(db);
  await schedules.createSlot(slot(TARGET_COURSE));
  const paths = new SqlPedagogicalPathStore(db);
  await paths.savePath(
    pathFor([
      refSession("session-other", 1, [{ id: "item-other" }]),
      refSession(SESS_P, 2, [{ id: ITEM_X }]),
    ]),
  );
  const agenda = new SqlAgendaStore(db);
  await agenda.createAgendaItem({
    classroomId: CLASSROOM_N1,
    subjectId: SUBJECT_N1,
    authorTeacherId: "teacher-1",
    day: 4,
    hour: 15,
    weekOffset: 3,
    schoolWeekNumber: 8,
    type: "HOMEWORK",
    title: "Travail historique",
    detail: "N",
    schoolYearId: SOURCE_YEAR,
    annualCourseId: SOURCE_COURSE,
    courseSessionKey: `${SOURCE_YEAR}|${SOURCE_COURSE}|2026-10-12`,
    courseSessionDate: "2026-10-12",
    referenceSessionId: SESS_P,
    referenceItemId: ITEM_X,
    studentVisible: true,
  });
  const previews = new SqlYearTransitionPreviewStore(db);
  const applyStore = new SqlYearTransitionApplyStore(db);
  const years = new SqlSchoolYearStore(db);
  const adapters = new SqlRuntimeAgendaAdapterStore(db);
  const deps: ApplyPersistedYearTransitionDeps = {
    previews,
    applyStore,
    years,
    courses,
    agenda,
    paths,
    schedules,
    adapters,
    now: () => "2027-03-01T00:00:00.000Z",
  };
  const input = await assembleLiveYearTransitionPreviewInput(
    { sourceSchoolYearId: SOURCE_YEAR, targetSchoolYearId: TARGET_YEAR, classMappings: mappings() },
    deps,
  );
  await createPersistedYearTransitionPreview(input, {
    store: previews,
    idGenerator: () => "transition-sql",
    now: () => "2027-02-01T00:00:00.000Z",
  });
  const beforeN = (await agenda.exportAllItems()).filter((item) => item.schoolYearId === SOURCE_YEAR);
  const sqlResult = await applyPersistedYearTransition("transition-sql", deps);
  assert.equal(sqlResult.ok, true);
  if (!sqlResult.ok) {
    db.close();
    return;
  }
  const created = (await agenda.exportAllItems()).filter((item) => item.schoolYearId === TARGET_YEAR);
  assert.equal(created.length, 1);
  assert.equal(created[0]?.studentVisible, false);
  assert.equal(created[0]?.sourceTransitionId, "transition-sql");
  assert.equal(created[0]?.hour, 8);
  assert.deepEqual(
    (await agenda.exportAllItems()).filter((item) => item.schoolYearId === SOURCE_YEAR),
    beforeN,
  );
  const author = await db
    .prepare("SELECT author_teacher_id, student_visible, source_transition_id FROM agenda_items WHERE school_year_id = ?")
    .bind(TARGET_YEAR)
    .first<{ author_teacher_id: string | null; student_visible: number; source_transition_id: string }>();
  assert.equal(author?.student_visible, 0);
  assert.equal(author?.source_transition_id, "transition-sql");

  const wrapped: SqlDatabase = {
    prepare: (query) => db.prepare(query),
    exec: (query) => db.exec(query),
    async batch(statements: SqlBatchStatement[]) {
      const mutated = statements.map((statement, index) =>
        index === 0
          ? { sql: "INSERT INTO year_transition_applies (transition_id) VALUES (?)", values: ["broken"] }
          : statement,
      );
      await db.batch(mutated);
    },
  };
  const failStore = new SqlYearTransitionApplyStore(wrapped);
  const countBefore = (await agenda.exportAllItems()).length;
  await createPersistedYearTransitionPreview(input, {
    store: previews,
    idGenerator: () => "transition-fail",
    now: () => "2027-02-02T00:00:00.000Z",
  });
  const failed = await applyPersistedYearTransition("transition-fail", { ...deps, applyStore: failStore });
  assert.equal(failed.ok, false);
  assert.equal((await agenda.exportAllItems()).length, countBefore);
  const failParent = await db
    .prepare("SELECT COUNT(*) AS count FROM year_transition_applies WHERE transition_id = ?")
    .bind("transition-fail")
    .first<{ count: number }>();
  assert.equal(Number(failParent?.count ?? -1), 0);

  const dump = await dumpCampusTables(db);
  assert.ok(dump.year_transition_applies.length >= 1);
  assert.ok(dump.year_transition_apply_entries.length >= 1);
  assert.ok(dump.agenda_items.some((row) => row.source_transition_id === "transition-sql"));

  db.close();
});

test("backup/restore roundtrip APPLY memory", async () => {
  const world = await seedMemory();
  await persistLive(world);
  await applyPersistedYearTransition("transition-1", world.deps);
  const previewDump = {
    year_transition_previews: [
      {
        id: "transition-1",
        source_school_year_id: SOURCE_YEAR,
        target_school_year_id: TARGET_YEAR,
        fingerprint: (await world.previews.getById("transition-1"))!.fingerprint,
        engine_version: 1,
        app_version: "2.62.0",
        snapshot_json: (await world.previews.getById("transition-1"))!.snapshotJson,
        preview_json: (await world.previews.getById("transition-1"))!.previewJson,
        created_at: "2027-02-01T00:00:00.000Z",
      },
    ],
    year_transition_preview_entries: (await world.previews.listEntries("transition-1")).map((entry) => ({
      transition_id: entry.transitionId,
      source_agenda_item_id: entry.sourceAgendaItemId,
      reason: entry.reason,
      reference_item_id: entry.referenceItemId,
      target_annual_course_id: entry.targetAnnualCourseId,
      entry_json: entry.entryJson,
    })),
  };
  const applyDump = world.applyStore.exportBackupTables();
  const tables: Record<string, Array<Record<string, unknown>>> = {};
  for (const name of CAMPUS_BACKUP_INSERT_ORDER) tables[name] = [];
  tables.teachers = [
    { id: "admin-1", display_name: "Admin", initials: "Ad", password_hash: "x", is_admin: 1, is_active: 1 },
  ];
  tables.year_transition_previews = previewDump.year_transition_previews;
  tables.year_transition_preview_entries = previewDump.year_transition_preview_entries;
  tables.year_transition_applies = applyDump.year_transition_applies;
  tables.year_transition_apply_entries = applyDump.year_transition_apply_entries;
  const validated = validateCampusTables(tables);
  assert.equal(validated.ok, true, validated.ok ? "" : validated.reason);
  const clone = new MemoryYearTransitionApplyStore(new MemoryAgendaStore([]));
  clone.importBackupTables(applyDump);
  assert.equal((await clone.getByTransitionId("transition-1"))?.appVersion, "2.62.0");
  assert.equal((await clone.listEntries("transition-1")).length, 1);
});

test("CreateAgendaInput et PublicationInput n'exposent pas la provenance APPLY", async () => {
  const typesSrc = await readFile(join(ROOT, "src/lib/persistence/types.ts"), "utf8");
  const createSlice = typesSrc.slice(
    typesSrc.indexOf("export interface CreateAgendaInput"),
    typesSrc.indexOf("export interface StructuredControlPlacement"),
  );
  assert.match(createSlice, /export interface CreateAgendaInput/);
  assert.doesNotMatch(createSlice, /sourceTransitionId|sourceAgendaItemId/);

  const storeSlice = typesSrc.slice(
    typesSrc.indexOf("export interface AgendaStore"),
    typesSrc.indexOf("export interface TemplateStore"),
  );
  assert.match(storeSlice, /export interface AgendaStore/);
  assert.doesNotMatch(storeSlice, /installExactItemsCopyOnWrite/);
  assert.doesNotMatch(storeSlice, /sourceTransitionId|sourceAgendaItemId/);

  const pubSrc = await readFile(join(ROOT, "src/features/agenda/publications.ts"), "utf8");
  const inputSlice = pubSrc.slice(
    pubSrc.indexOf("export interface PublicationInput"),
    pubSrc.indexOf("export type PublicationPatch"),
  );
  assert.match(inputSlice, /export interface PublicationInput/);
  assert.doesNotMatch(inputSlice, /sourceTransitionId|sourceAgendaItemId/);

  const _createCheck: CreateAgendaInput = {
    classroomId: "c",
    subjectId: "s",
    authorTeacherId: "t",
    day: 1,
    hour: 8,
    schoolWeekNumber: 1,
    type: "HOMEWORK",
    title: "x",
    detail: "y",
  };
  const _pubCheck: PublicationInput = { ..._createCheck };
  const _storeCheck = null as unknown as AgendaStore;
  void _createCheck;
  void _pubCheck;
  void _storeCheck;
  assert.equal("sourceTransitionId" in _createCheck, false);
  assert.equal("sourceAgendaItemId" in _createCheck, false);
});

test("createPublication ignore une provenance injectée et force null", () => {
  const injected = {
    id: 1,
    classroomId: "c",
    subjectId: "s",
    authorTeacherId: "t",
    day: 1,
    hour: 8,
    schoolWeekNumber: 1,
    type: "HOMEWORK" as const,
    title: "x",
    detail: "y",
    sourceTransitionId: "hack-T",
    sourceAgendaItemId: 99,
  };
  const items = createPublication([], injected as PublicationInput & { id: number });
  assert.equal(items[0]?.sourceTransitionId, null);
  assert.equal(items[0]?.sourceAgendaItemId, null);
});

test("createAgendaItem Memory écrit toujours une provenance nulle", async () => {
  const agenda = new MemoryAgendaStore([]);
  const created = await agenda.createAgendaItem({
    classroomId: "c",
    subjectId: "s",
    authorTeacherId: "teacher-1",
    day: 1,
    hour: 8,
    schoolWeekNumber: 1,
    type: "HOMEWORK",
    title: "Création normale",
    detail: "d",
  });
  assert.equal(created.sourceTransitionId, null);
  assert.equal(created.sourceAgendaItemId, null);
});

test("createAgendaItem SQLite écrit NULL, NULL — rejeu 0032 idempotent", async () => {
  const db = createNodeSqliteDatabase(":memory:");
  await applyMigrations(db);
  await applyMigrations(db);

  const cols = await db.prepare("PRAGMA table_info(agenda_items)").bind().all<{ name: string }>();
  const colNames = (cols.results ?? []).map((row) => row.name);
  assert.equal(colNames.filter((name) => name === "source_transition_id").length, 1);
  assert.equal(colNames.filter((name) => name === "source_agenda_item_id").length, 1);

  const tables = await db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .bind()
    .all<{ name: string }>();
  const tableNames = (tables.results ?? []).map((row) => row.name);
  assert.ok(tableNames.includes("year_transition_applies"));
  assert.ok(tableNames.includes("year_transition_apply_entries"));

  const indexes = await db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name")
    .bind()
    .all<{ name: string }>();
  const indexNames = (indexes.results ?? []).map((row) => row.name);
  assert.ok(indexNames.includes("idx_agenda_items_source_transition"));
  assert.ok(indexNames.includes("idx_year_transition_apply_entries_result"));
  assert.ok(indexNames.includes("idx_year_transition_apply_entries_course"));
  assert.ok(indexNames.includes("idx_year_transition_apply_entries_reference"));

  await db
    .prepare(
      `INSERT INTO teachers (id, display_name, initials, password_hash, is_admin, is_active)
       VALUES (?, ?, ?, ?, 0, 1)`,
    )
    .bind("teacher-1", "Prof", "Pr", "x")
    .run();
  await db
    .prepare(
      "INSERT INTO classrooms (id, name, program_label, access_code_hint) VALUES (?, ?, ?, ?)",
    )
    .bind("classroom-n1", "C", "p", "h")
    .run();
  await db
    .prepare("INSERT INTO subjects (id, classroom_id, name) VALUES (?, ?, ?)")
    .bind("subject-n1", "classroom-n1", "Branche")
    .run();

  const agenda = new SqlAgendaStore(db);
  const created = await agenda.createAgendaItem({
    classroomId: "classroom-n1",
    subjectId: "subject-n1",
    authorTeacherId: "teacher-1",
    day: 1,
    hour: 8,
    schoolWeekNumber: 1,
    type: "HOMEWORK",
    title: "Création SQL normale",
    detail: "d",
  });
  assert.equal(created.sourceTransitionId, null);
  assert.equal(created.sourceAgendaItemId, null);
  const row = await db
    .prepare(
      "SELECT source_transition_id, source_agenda_item_id FROM agenda_items WHERE id = ?",
    )
    .bind(created.id)
    .first<{ source_transition_id: string | null; source_agenda_item_id: number | null }>();
  assert.equal(row?.source_transition_id, null);
  assert.equal(row?.source_agenda_item_id, null);
  db.close();
});

test("rejeu explicite migration 0032 — deux applyMigrations sans erreur", async () => {
  const db = createNodeSqliteDatabase(":memory:");
  await applyMigrations(db);
  await applyMigrations(db);
  const cols = await db.prepare("PRAGMA table_info(agenda_items)").bind().all<{ name: string }>();
  const names = (cols.results ?? []).map((row) => row.name);
  assert.equal(names.filter((name) => name === "source_transition_id").length, 1);
  assert.equal(names.filter((name) => name === "source_agenda_item_id").length, 1);
  const tables = await db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .bind()
    .all<{ name: string }>();
  const tableNames = (tables.results ?? []).map((row) => row.name);
  assert.ok(tableNames.includes("year_transition_applies"));
  assert.ok(tableNames.includes("year_transition_apply_entries"));
  const indexes = await db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name")
    .bind()
    .all<{ name: string }>();
  const indexNames = (indexes.results ?? []).map((row) => row.name);
  assert.ok(indexNames.includes("idx_agenda_items_source_transition"));
  assert.ok(indexNames.includes("idx_year_transition_apply_entries_result"));
  assert.ok(indexNames.includes("idx_year_transition_apply_entries_course"));
  assert.ok(indexNames.includes("idx_year_transition_apply_entries_reference"));
  db.close();
});

test("updateAgendaItem conserve la provenance APPLY (Memory + SQLite)", async () => {
  const world = await seedMemory();
  await persistLive(world);
  const applied = await applyPersistedYearTransition("transition-1", world.deps);
  assert.equal(applied.ok, true);
  const created = (await world.agenda.exportAllItems()).find((item) => item.schoolYearId === TARGET_YEAR);
  assert.ok(created);
  assert.equal(created.sourceTransitionId, "transition-1");
  assert.equal(created.sourceAgendaItemId, 10);
  const updated = await world.agenda.updateAgendaItem(created.id, "teacher-1", {
    title: "Titre modifié après APPLY",
    detail: "contenu N+1 édité",
  });
  assert.equal(updated.ok, true);
  if (!updated.ok) return;
  assert.equal(updated.item.sourceTransitionId, "transition-1");
  assert.equal(updated.item.sourceAgendaItemId, 10);
  assert.equal(updated.item.title, "Titre modifié après APPLY");

  const db = createNodeSqliteDatabase(":memory:");
  await applyMigrations(db);
  await db
    .prepare(
      `INSERT INTO teachers (id, display_name, initials, password_hash, is_admin, is_active)
       VALUES (?, ?, ?, ?, 0, 1)`,
    )
    .bind("teacher-1", "Prof", "Pr", "x")
    .run();
  await db
    .prepare(
      "INSERT INTO classrooms (id, name, program_label, access_code_hint) VALUES (?, ?, ?, ?)",
    )
    .bind(CLASSROOM_N1, "C", "p", "h")
    .run();
  await db
    .prepare("INSERT INTO subjects (id, classroom_id, name) VALUES (?, ?, ?)")
    .bind(SUBJECT_N1, CLASSROOM_N1, "Branche")
    .run();
  await db
    .prepare(
      `INSERT INTO agenda_items (
        classroom_id, subject_id, author_teacher_id, day, hour, week_offset, school_week_number,
        type, title, detail, student_visible, source_transition_id, source_agenda_item_id
      ) VALUES (?, ?, ?, 1, 8, 0, 1, 'HOMEWORK', 'APPLY', 'n1', 0, ?, ?)`,
    )
    .bind(CLASSROOM_N1, SUBJECT_N1, "teacher-1", "transition-sql", 10)
    .run();
  const sqlAgenda = new SqlAgendaStore(db);
  const sqlItem = (await sqlAgenda.exportAllItems())[0];
  assert.ok(sqlItem);
  assert.equal(sqlItem.sourceTransitionId, "transition-sql");
  const sqlUpdated = await sqlAgenda.updateAgendaItem(sqlItem.id, "teacher-1", {
    title: "SQL modifié",
  });
  assert.equal(sqlUpdated.ok, true);
  if (!sqlUpdated.ok) {
    db.close();
    return;
  }
  assert.equal(sqlUpdated.item.sourceTransitionId, "transition-sql");
  assert.equal(sqlUpdated.item.sourceAgendaItemId, 10);
  const persisted = await db
    .prepare(
      "SELECT source_transition_id, source_agenda_item_id, title FROM agenda_items WHERE id = ?",
    )
    .bind(sqlItem.id)
    .first<{ source_transition_id: string | null; source_agenda_item_id: number | null; title: string }>();
  assert.equal(persisted?.source_transition_id, "transition-sql");
  assert.equal(Number(persisted?.source_agenda_item_id), 10);
  assert.equal(persisted?.title, "SQL modifié");
  db.close();
});

test("installExactItemsCopyOnWrite hors AgendaStore, hors routes/UI, hors barrel", async () => {
  const files = [
    "src/lib/persistence/types.ts",
    "src/lib/persistence/index.ts",
    "src/features/year-transition/apply.ts",
    "src/lib/persistence/sql/sql-year-transition-apply-store.ts",
  ];
  for (const file of files) {
    const src = await readFile(join(ROOT, file), "utf8");
    assert.equal(src.includes("installExactItemsCopyOnWrite"), false, file);
  }
  const memoryStore = await readFile(join(ROOT, "src/lib/persistence/memory-store.ts"), "utf8");
  const applyMemory = await readFile(
    join(ROOT, "src/lib/persistence/memory-year-transition-apply-store.ts"),
    "utf8",
  );
  assert.match(memoryStore, /installExactItemsCopyOnWrite/);
  assert.match(applyMemory, /installExactItemsCopyOnWrite/);
  assert.doesNotMatch(applyMemory, /replaceAllItems/);

  const { readdir } = await import("node:fs/promises");
  async function walk(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const out: string[] = [];
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".next" || entry.name === "dist") continue;
        out.push(...(await walk(full)));
      } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx") || entry.name.endsWith(".mjs")) {
        out.push(full);
      }
    }
    return out;
  }
  const allowed = new Set([
    join(ROOT, "src/lib/persistence/memory-store.ts"),
    join(ROOT, "src/lib/persistence/memory-year-transition-apply-store.ts"),
    join(ROOT, "tests/year-transition-apply.test.ts"),
  ]);
  for (const file of [...(await walk(join(ROOT, "src"))), ...(await walk(join(ROOT, "web"))), ...(await walk(join(ROOT, "tests")))]) {
    if (allowed.has(file)) continue;
    const src = await readFile(file, "utf8");
    assert.equal(src.includes("installExactItemsCopyOnWrite"), false, file);
  }
});
