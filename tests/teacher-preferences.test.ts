import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DEFAULT_NOTEBOOK_WEEK_COUNT,
  NOTEBOOK_WEEK_COUNT_OPTIONS,
  clampNotebookWeekCount,
  isTeacherSetupPayload,
  normalizeTeacherSetup,
  notebookWeekCountPreference,
  withNotebookWeekCount,
  type TeacherSetupConfig,
} from "../src/features/teacher-setup/index.ts";
import {
  removeSetupPreferenceForCourse,
  upsertSetupPreferenceForCourse,
  type TeacherCourseWorkspaceEntry,
} from "../src/features/teacher-workspace/index.ts";
import {
  getMemoryTeacherSetupStore,
  resetMemoryTeacherSetupStore,
} from "../src/lib/persistence/memory-teacher-setup-store.ts";
import { createNodeSqliteDatabase } from "../src/lib/persistence/sql/adapters.ts";
import { applyMigrations } from "../src/lib/persistence/sql/migrate.ts";
import { seedDemoDatabase } from "../src/lib/persistence/sql/seed.ts";
import { SqlTeacherSetupStore } from "../src/lib/persistence/sql/sql-teacher-setup-store.ts";
import { TEACHER_CHF_ID } from "../src/features/classes/index.ts";

const LEGACY_CLASS = {
  id: "ac-mecma3a",
  name: "MECMA3A",
  programLabel: "Mécanicien",
  dayOfWeek: 1 as const,
  branchNames: ["CP2 Transmission"],
  icon: "",
  professionPrefix: "MECMA",
};

function legacyConfig(): TeacherSetupConfig {
  return { version: 1, classes: [structuredClone(LEGACY_CLASS)] };
}

function course(): TeacherCourseWorkspaceEntry {
  return {
    annualCourseId: "ac-mecma3a",
    assignmentId: "as-1",
    role: "PRIMARY",
    validFrom: "2026-08-01T00:00:00.000Z",
    validTo: null,
    schoolYearId: "year-2026",
    schoolYearLabel: "2026-2027",
    classId: "class-mecma3a",
    classCode: "MECMA3A",
    classLabel: "MECMA3A",
    classSortOrder: 1,
    professionId: null,
    professionLabel: "Mécanicien",
    professionClassCodePrefix: "MECMA",
    trainingYear: 3,
    parallelCode: "A",
    contextId: "ctx-1",
    branchId: "br-1",
    branchCode: "br-1",
    branchLabel: "CP2 Transmission",
    branchSortOrder: 1,
    teachingType: "TECHNICAL",
  };
}

test("préférence carnet — 3 semaines par défaut, y compris pour une ancienne configuration", () => {
  assert.equal(DEFAULT_NOTEBOOK_WEEK_COUNT, 3);
  assert.deepEqual([...NOTEBOOK_WEEK_COUNT_OPTIONS], [1, 2, 3, 4]);
  assert.equal(notebookWeekCountPreference(null), 3);
  assert.equal(notebookWeekCountPreference(legacyConfig()), 3);
  assert.equal(normalizeTeacherSetup(legacyConfig()).display, undefined);
});

test("préférence carnet — 1 à 4 enregistrés, valeurs hors bornes ramenées", () => {
  for (const count of [1, 2, 3, 4] as const) {
    assert.equal(notebookWeekCountPreference(withNotebookWeekCount(legacyConfig(), count)), count);
  }
  assert.equal(clampNotebookWeekCount(0), 1);
  assert.equal(clampNotebookWeekCount(9), 4);
  assert.equal(clampNotebookWeekCount(Number.NaN), 3);
  const normalized = normalizeTeacherSetup({
    ...legacyConfig(),
    display: { notebookWeekCount: 7 as 4 },
  });
  assert.equal(normalized.display?.notebookWeekCount, 4);
});

test("préférence carnet — une valeur invalide est ignorée, pas la configuration", () => {
  const raw = { ...legacyConfig(), display: "quatre" } as unknown as TeacherSetupConfig;
  assert.equal(isTeacherSetupPayload(raw), true);
  const normalized = normalizeTeacherSetup(raw);
  assert.equal(normalized.display, undefined);
  assert.equal(notebookWeekCountPreference(normalized), 3);
  assert.equal(normalized.classes.length, 1);
});

test("préférence carnet — les anciens jours par cours sont conservés tels quels", () => {
  const updated = withNotebookWeekCount(legacyConfig(), 2);
  assert.deepEqual(updated.classes, [LEGACY_CLASS]);
  assert.equal(normalizeTeacherSetup(updated).classes[0]?.dayOfWeek, 1);
});

test("préférence carnet — non perdue par les helpers de repli Ma semaine", () => {
  const withPreference = withNotebookWeekCount(legacyConfig(), 1);
  const upserted = upsertSetupPreferenceForCourse(withPreference, course(), { dayOfWeek: 2 });
  assert.equal(upserted.display?.notebookWeekCount, 1);
  const removed = removeSetupPreferenceForCourse(upserted, course());
  assert.equal(removed.display?.notebookWeekCount, 1);
});

test("préférence carnet — persistée en mémoire et en SQLite", async () => {
  resetMemoryTeacherSetupStore();
  const memory = getMemoryTeacherSetupStore();
  await memory.saveSetup(TEACHER_CHF_ID, withNotebookWeekCount(legacyConfig(), 4));
  assert.equal((await memory.getSetup(TEACHER_CHF_ID))?.display?.notebookWeekCount, 4);

  const db = createNodeSqliteDatabase(":memory:");
  await applyMigrations(db);
  await seedDemoDatabase(db);
  const sql = new SqlTeacherSetupStore(db);
  await sql.saveSetup(TEACHER_CHF_ID, withNotebookWeekCount(legacyConfig(), 2));
  const loaded = await sql.getSetup(TEACHER_CHF_ID);
  assert.equal(loaded?.display?.notebookWeekCount, 2);
  assert.equal(loaded?.classes[0]?.dayOfWeek, 1);
  const exported = await sql.exportAllSetups();
  assert.equal(exported.find((entry) => entry.teacherId === TEACHER_CHF_ID)?.config.display?.notebookWeekCount, 2);
  db.close();
});

test("Préférences — plus de jour d’affichage par cours, réglage du carnet branché", async () => {
  const [panel, page, notebook] = await Promise.all([
    readFile(new URL("../web/app/components/configuration-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/components/class-notebook-panel.tsx", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(panel, /Jour d’affichage/);
  assert.doesNotMatch(panel, /Afficher \/ masquer/);
  assert.doesNotMatch(panel, /Réinitialiser les préférences/);
  assert.match(panel, /Semaines affichées par défaut/);
  assert.match(panel, /withNotebookWeekCount/);
  assert.doesNotMatch(page, /resetTeacherSetup/);
  assert.match(page, /defaultWeekDisplayCount=\{notebookWeekCountPreference\(teacherSetup\)\}/);
  assert.match(notebook, /useState<WeekDisplayCount>\(defaultWeekDisplayCount\)/);
});
