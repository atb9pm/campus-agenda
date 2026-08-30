import assert from "node:assert/strict";
import test from "node:test";

process.env.CAMPUS_PBKDF2_ITERATIONS ??= "10000";

import {
  buildClassCode,
  buildClassLabel,
  createStructuredClasses,
  normalizeClassCodePrefix,
  resolveSchoolClass,
  trainingYearsForDuration,
  validateStructuredClassBatch,
} from "../src/features/school-catalog/index.ts";
import { resolveAnnualCourseForPublication } from "../src/features/annual-courses/index.ts";
import {
  getMemorySchoolCatalogStore,
  resetMemorySchoolCatalogStore,
} from "../src/lib/persistence/memory-school-catalog-store.ts";
import { createNodeSqliteDatabase } from "../src/lib/persistence/sql/adapters.ts";
import { applyMigrations } from "../src/lib/persistence/sql/migrate.ts";
import { SqlSchoolCatalogStore } from "../src/lib/persistence/sql/sql-school-catalog-store.ts";
import { SqlAnnualCourseStore } from "../src/lib/persistence/sql/sql-annual-course-store.ts";
import { APP_VERSION } from "../src/lib/app-version.ts";

function freshCatalog() {
  resetMemorySchoolCatalogStore();
  return getMemorySchoolCatalogStore();
}

const YEAR_2026 = { id: "sy-2026", label: "2026-2027", status: "active" as const };
const YEAR_2027 = { id: "sy-2027", label: "2027-2028", status: "draft" as const };
const YEAR_ARCHIVED = { id: "sy-old", label: "2025-2026", status: "archived" as const };

async function professionWithPlan(store = freshCatalog(), prefix = "MMA") {
  await store.ensureSeeded();
  const profession = await store.createProfession({
    label: "Mécanicien en maintenance",
    durationYears: 3,
    classCodePrefix: prefix,
  });
  const branches = await store.listBranches();
  const moteur = branches.find((entry) => entry.label === "Moteur") ?? branches[0]!;
  const elec = branches.find((entry) => entry.label.includes("lectri")) ?? branches[1] ?? moteur;
  const year1 = await store.createContext({
    professionId: profession.id,
    trainingYear: 1,
    branchId: moteur.id,
  });
  assert.equal(year1.ok, true);
  if (elec.id !== moteur.id) {
    const extra = await store.createContext({
      professionId: profession.id,
      trainingYear: 1,
      branchId: elec.id,
    });
    assert.equal(extra.ok, true);
  }
  return { store, profession, moteur, contextsBefore: await store.listContexts() };
}

test("version 2.22.0", () => {
  assert.equal(APP_VERSION, "2.22.0");
});

test("profession — création label + prefix + durée, normalisation MMA", async () => {
  const store = freshCatalog();
  const created = await store.createProfession({
    label: "Mécanicien en maintenance",
    durationYears: 3,
    classCodePrefix: "mma",
  });
  assert.equal(created.classCodePrefix, "MMA");
  assert.equal(created.durationYears, 3);
  assert.match(created.adminCode, /^PRF-\d{4}$/);
  assert.notEqual(created.classCodePrefix, created.adminCode);
});

test("profession — prefix obligatoire côté normalisation, doublon refusé, PRF refusé", () => {
  assert.equal(normalizeClassCodePrefix("  ma  ").ok, true);
  if (normalizeClassCodePrefix("  ma  ").ok) {
    assert.equal(normalizeClassCodePrefix("  ma  ").value, "MA");
  }
  assert.equal(normalizeClassCodePrefix("M").ok, false);
  assert.equal(normalizeClassCodePrefix("PRF-0001").ok, false);
  assert.equal(normalizeClassCodePrefix("prf0001").ok, false);
});

test("profession — prefix doublon refusé, legacy prefix null lisible", async () => {
  const store = freshCatalog();
  const first = await store.createProfession({
    label: "Mécatronicien",
    durationYears: 4,
    classCodePrefix: "MA",
  });
  assert.equal(first.classCodePrefix, "MA");
  await assert.rejects(
    () => store.createProfession({ label: "Autre", durationYears: 3, classCodePrefix: "ma" }),
    /déjà utilisée/,
  );
  const legacy = await store.createProfession({ label: "Ancienne", durationYears: 3 });
  assert.equal(legacy.classCodePrefix, null);
});

test("plan — durée 3 → années 1,2,3 ; CTX = profession + année + branche", async () => {
  const { store, profession, contextsBefore } = await professionWithPlan();
  assert.deepEqual(trainingYearsForDuration(profession.durationYears), [1, 2, 3]);
  const four = await store.createProfession({
    label: "Informaticien",
    durationYears: 4,
    classCodePrefix: "INF",
  });
  assert.deepEqual(trainingYearsForDuration(four.durationYears), [1, 2, 3, 4]);
  const ctx = contextsBefore.find((entry) => entry.professionId === profession.id);
  assert.ok(ctx);
  assert.equal(ctx.trainingYear, 1);
  assert.match(ctx.adminCode, /^CTX-\d{4}$/);
});

test("codes — MMA + 1 + A/B/null", () => {
  assert.equal(buildClassCode({ prefix: "MMA", trainingYear: 1, parallelCode: "A" }), "MMA1A");
  assert.equal(buildClassCode({ prefix: "MMA", trainingYear: 1, parallelCode: "B" }), "MMA1B");
  assert.equal(buildClassCode({ prefix: "MMA", trainingYear: 1, parallelCode: null }), "MMA1");
  assert.equal(buildClassLabel({ prefix: "MMA", trainingYear: 1, parallelCode: "A" }), "MMA 1A");
  assert.equal(buildClassLabel({ prefix: "MMA", trainingYear: 1, parallelCode: null }), "MMA 1");
});

test("batch — A/B/C créent trois classes, un seul CTX, pas de création si groupe doublon ou plan vide", async () => {
  const { store, profession, contextsBefore } = await professionWithPlan();
  const ctxCountBefore = contextsBefore.filter((entry) => entry.professionId === profession.id).length;

  const created = await createStructuredClasses(store, {
    years: [YEAR_2026, YEAR_2027],
    input: {
      schoolYearId: YEAR_2026.id,
      professionId: profession.id,
      trainingYear: 1,
      organization: "parallel",
      parallelCodes: ["A", "B", "C"],
    },
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.equal(created.value.length, 3);
  assert.deepEqual(
    created.value.map((entry) => entry.code),
    ["MMA1A", "MMA1B", "MMA1C"],
  );
  assert.deepEqual(
    created.value.map((entry) => entry.parallelCode),
    ["A", "B", "C"],
  );
  assert.ok(created.value.every((entry) => entry.professionId === profession.id));
  assert.ok(created.value.every((entry) => entry.trainingYear === 1));
  assert.ok(created.value.every((entry) => entry.schoolYearId === YEAR_2026.id));

  const ctxCountAfter = (await store.listContexts()).filter(
    (entry) => entry.professionId === profession.id,
  ).length;
  assert.equal(ctxCountAfter, ctxCountBefore);

  const duplicateGroups = await createStructuredClasses(store, {
    years: [YEAR_2026],
    input: {
      schoolYearId: YEAR_2026.id,
      professionId: profession.id,
      trainingYear: 1,
      organization: "parallel",
      parallelCodes: ["A", "A"],
    },
  });
  assert.equal(duplicateGroups.ok, false);

  const emptyProfession = await store.createProfession({
    label: "Sans plan",
    durationYears: 3,
    classCodePrefix: "SPP",
  });
  const emptyPlan = await createStructuredClasses(store, {
    years: [YEAR_2026],
    input: {
      schoolYearId: YEAR_2026.id,
      professionId: emptyProfession.id,
      trainingYear: 1,
      organization: "unique",
    },
  });
  assert.equal(emptyPlan.ok, false);
  if (!emptyPlan.ok) {
    assert.match(emptyPlan.reason, /Aucune branche|plan de formation/i);
  }
});

test("batch — année archivée refusée, prefix manquant refusé", async () => {
  const { store, profession } = await professionWithPlan();
  const archived = validateStructuredClassBatch({
    input: {
      schoolYearId: YEAR_ARCHIVED.id,
      professionId: profession.id,
      trainingYear: 1,
      organization: "unique",
    },
    years: [YEAR_ARCHIVED],
    professions: await store.listProfessions(),
    classes: await store.listClasses(),
    contexts: await store.listContexts(),
  });
  assert.equal(archived.ok, false);

  const legacyProfession = await store.createProfession({
    label: "Sans abréviation",
    durationYears: 3,
  });
  const noPrefix = validateStructuredClassBatch({
    input: {
      schoolYearId: YEAR_2026.id,
      professionId: legacyProfession.id,
      trainingYear: 1,
      organization: "unique",
    },
    years: [YEAR_2026],
    professions: await store.listProfessions(),
    classes: await store.listClasses(),
    contexts: await store.listContexts(),
  });
  assert.equal(noPrefix.ok, false);
});

test("multi-années — MMA1A autorisé d'une année à l'autre, refusé la même année", async () => {
  const { store, profession } = await professionWithPlan();
  const first = await createStructuredClasses(store, {
    years: [YEAR_2026, YEAR_2027],
    input: {
      schoolYearId: YEAR_2026.id,
      professionId: profession.id,
      trainingYear: 1,
      organization: "parallel",
      parallelCodes: ["A"],
    },
  });
  assert.equal(first.ok, false, "un seul groupe parallèle doit être refusé");

  const unique2026 = await createStructuredClasses(store, {
    years: [YEAR_2026, YEAR_2027],
    input: {
      schoolYearId: YEAR_2026.id,
      professionId: profession.id,
      trainingYear: 1,
      organization: "unique",
    },
  });
  assert.equal(unique2026.ok, true);
  if (!unique2026.ok) return;
  assert.equal(unique2026.value[0]?.code, "MMA1");

  const parallel2026 = await store.createClass({
    code: "MMA1A",
    label: "MMA 1A",
    schoolYearId: YEAR_2026.id,
    schoolYearLabel: YEAR_2026.label,
    professionId: profession.id,
    trainingYear: 1,
    parallelCode: "A",
  });
  assert.equal(parallel2026.code, "MMA1A");

  const sameYear = await createStructuredClasses(store, {
    years: [YEAR_2026, YEAR_2027],
    input: {
      schoolYearId: YEAR_2026.id,
      professionId: profession.id,
      trainingYear: 1,
      organization: "parallel",
      parallelCodes: ["A", "B"],
    },
  });
  assert.equal(sameYear.ok, false);

  const nextYear = await store.createClass({
    code: "MMA1A",
    label: "MMA 1A",
    schoolYearId: YEAR_2027.id,
    schoolYearLabel: YEAR_2027.label,
    professionId: profession.id,
    trainingYear: 1,
    parallelCode: "A",
  });
  assert.equal(nextYear.code, "MMA1A");
  assert.notEqual(nextYear.id, parallel2026.id);
});

test("legacy — schoolYearId null protégé contre un doublon exact", async () => {
  const store = freshCatalog();
  await store.createClass({ code: "LEG1", label: "LEG1", schoolYearId: null });
  await assert.rejects(
    () => store.createClass({ code: "LEG1", label: "LEG1", schoolYearId: null }),
    /legacy/,
  );
});

test("Agenda — résolution contextualisée par schoolYearId, jamais le premier arbitraire", async () => {
  const { store, profession, moteur } = await professionWithPlan();
  const class2026 = await store.createClass({
    code: "MMA1A",
    label: "MMA 1A",
    schoolYearId: YEAR_2026.id,
    schoolYearLabel: YEAR_2026.label,
    professionId: profession.id,
    trainingYear: 1,
    parallelCode: "A",
  });
  const class2027 = await store.createClass({
    code: "MMA1A",
    label: "MMA 1A",
    schoolYearId: YEAR_2027.id,
    schoolYearLabel: YEAR_2027.label,
    professionId: profession.id,
    trainingYear: 1,
    parallelCode: "A",
  });

  const classes = await store.listClasses();
  assert.equal(
    resolveSchoolClass({ classroomName: "MMA1A", classes, schoolYearId: YEAR_2026.id })?.id,
    class2026.id,
  );
  assert.equal(
    resolveSchoolClass({ classroomName: "MMA1A", classes, schoolYearId: YEAR_2027.id })?.id,
    class2027.id,
  );
  assert.equal(resolveSchoolClass({ classroomName: "MMA1A", classes }), null);

  const memoryCourses = [
    {
      id: "ac-2026",
      schoolYearId: YEAR_2026.id,
      classId: class2026.id,
      contextId: (await store.listContexts()).find((entry) => entry.branchId === moteur.id)!.id,
      isArchived: false,
      archivedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "ac-2027",
      schoolYearId: YEAR_2027.id,
      classId: class2027.id,
      contextId: (await store.listContexts()).find((entry) => entry.branchId === moteur.id)!.id,
      isArchived: false,
      archivedAt: null,
      createdAt: "2027-01-01T00:00:00.000Z",
      updatedAt: "2027-01-01T00:00:00.000Z",
    },
  ];
  const contexts = await store.listContexts();
  const branches = await store.listBranches();
  const published = resolveAnnualCourseForPublication({
    classroomName: "MMA1A",
    subjectName: moteur.label,
    classes,
    branches,
    contexts,
    courses: memoryCourses,
    schoolYearId: YEAR_2026.id,
  });
  assert.equal(published?.schoolClass.id, class2026.id);
  assert.equal(published?.course.id, "ac-2026");

  const edited = resolveAnnualCourseForPublication({
    classroomName: "MMA1A",
    subjectName: moteur.label,
    classes,
    branches,
    contexts,
    courses: memoryCourses,
    schoolYearId: YEAR_2027.id,
  });
  assert.equal(edited?.schoolClass.id, class2027.id);
  assert.equal(edited?.course.id, "ac-2027");
});

test("prefix modifié ne renomme pas les classes existantes", async () => {
  const { store, profession } = await professionWithPlan();
  const created = await store.createClass({
    code: "MMA1A",
    label: "MMA 1A",
    schoolYearId: YEAR_2026.id,
    professionId: profession.id,
    trainingYear: 1,
    parallelCode: "A",
  });
  const updated = await store.updateProfession(profession.id, { classCodePrefix: "MM" });
  assert.equal(updated.ok, true);
  const same = (await store.listClasses()).find((entry) => entry.id === created.id);
  assert.equal(same?.code, "MMA1A");
  const next = await createStructuredClasses(store, {
    years: [YEAR_2026],
    input: {
      schoolYearId: YEAR_2026.id,
      professionId: profession.id,
      trainingYear: 1,
      organization: "unique",
    },
  });
  assert.equal(next.ok, true);
  if (!next.ok) return;
  assert.equal(next.value[0]?.code, "MM1");
});

test("SQLite — 0001→0019→0020 puis applyMigrations rejoué, classes legacy conservées, MMA1A multi-années", async () => {
  const db = createNodeSqliteDatabase(":memory:");
  await applyMigrations(db, { until: "0019_annual_courses_teacher_assignments.sql" });

  await db
    .prepare(
      `INSERT INTO school_classes
         (id, code, label, sort_order, is_active, school_year_label, profession_id, training_year, school_year_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind("legacy-keep-1", "KEEP1", "KEEP1", 1, 1, "2024-2025", null, null, null)
    .run();

  const before = await db
    .prepare("SELECT id, code, profession_id, training_year, school_year_id, school_year_label FROM school_classes")
    .bind()
    .all<{
      id: string;
      code: string;
      profession_id: string | null;
      training_year: number | null;
      school_year_id: string | null;
      school_year_label: string | null;
    }>();
  const beforeIds = new Set((before.results ?? []).map((row) => row.id));
  assert.ok(beforeIds.has("legacy-keep-1"));

  await applyMigrations(db, { until: "0020_school_class_structure.sql" });
  await applyMigrations(db);

  const columns = await db
    .prepare("PRAGMA table_info(school_classes)")
    .bind()
    .all<{ name: string }>();
  const names = (columns.results ?? []).map((row) => row.name);
  assert.ok(names.includes("parallel_code"));
  assert.ok(names.includes("profession_id"));
  assert.ok(names.includes("training_year"));
  assert.ok(names.includes("school_year_id"));
  assert.ok(names.includes("school_year_label"));

  const professionCols = await db
    .prepare("PRAGMA table_info(school_professions)")
    .bind()
    .all<{ name: string }>();
  assert.ok((professionCols.results ?? []).some((row) => row.name === "class_code_prefix"));

  const after = await db
    .prepare("SELECT id, code, parallel_code FROM school_classes WHERE id = ?")
    .bind("legacy-keep-1")
    .first<{ id: string; code: string; parallel_code: string | null }>();
  assert.equal(after?.id, "legacy-keep-1");
  assert.equal(after?.code, "KEEP1");
  assert.equal(after?.parallel_code, null);

  const catalog = new SqlSchoolCatalogStore(db);
  await catalog.ensureSeeded();
  const listed = await catalog.listClasses();
  assert.ok(listed.some((entry) => entry.id === "legacy-keep-1"));
  assert.ok(listed.every((entry) => entry.parallelCode === null || typeof entry.parallelCode === "string"));

  const profession = await catalog.createProfession({
    label: "Mécanicien en maintenance",
    durationYears: 3,
    classCodePrefix: "MMA",
  });
  const branches = await catalog.listBranches();
  const moteur = branches[0]!;
  const ctx = await catalog.createContext({
    professionId: profession.id,
    trainingYear: 1,
    branchId: moteur.id,
  });
  assert.equal(ctx.ok, true);

  const first = await catalog.createClass({
    code: "MMA1A",
    label: "MMA 1A",
    schoolYearId: "sy-2026",
    schoolYearLabel: "2026-2027",
    professionId: profession.id,
    trainingYear: 1,
    parallelCode: "A",
  });
  const second = await catalog.createClass({
    code: "MMA1A",
    label: "MMA 1A",
    schoolYearId: "sy-2027",
    schoolYearLabel: "2027-2028",
    professionId: profession.id,
    trainingYear: 1,
    parallelCode: "A",
  });
  assert.notEqual(first.id, second.id);

  await assert.rejects(
    () =>
      catalog.createClass({
        code: "MMA1A",
        label: "MMA 1A",
        schoolYearId: "sy-2026",
        schoolYearLabel: "2026-2027",
        professionId: profession.id,
        trainingYear: 1,
        parallelCode: "A",
      }),
    /existe déjà/,
  );

  await applyMigrations(db);
  const replayed = await db
    .prepare("SELECT id FROM school_classes WHERE id = ?")
    .bind("legacy-keep-1")
    .first<{ id: string }>();
  assert.equal(replayed?.id, "legacy-keep-1");
  const stillTwo = (await catalog.listClasses()).filter((entry) => entry.code === "MMA1A");
  assert.equal(stillTwo.length, 2);

  const courses = new SqlAnnualCourseStore(db);
  const contextId = ctx.ok ? ctx.value.id : "";
  const now = "2026-08-30T00:00:00.000Z";
  await courses.createCourse({
    id: "ac-mma-2026",
    schoolYearId: "sy-2026",
    classId: first.id,
    contextId,
    isArchived: false,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  });
  await courses.createCourse({
    id: "ac-mma-2027",
    schoolYearId: "sy-2027",
    classId: second.id,
    contextId,
    isArchived: false,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  });
  const resolved2026 = resolveAnnualCourseForPublication({
    classroomName: "MMA1A",
    subjectName: moteur.label,
    classes: await catalog.listClasses(),
    branches: await catalog.listBranches(),
    contexts: await catalog.listContexts(),
    courses: await courses.listCourses(),
    schoolYearId: "sy-2026",
  });
  const resolved2027 = resolveAnnualCourseForPublication({
    classroomName: "MMA1A",
    subjectName: moteur.label,
    classes: await catalog.listClasses(),
    branches: await catalog.listBranches(),
    contexts: await catalog.listContexts(),
    courses: await courses.listCourses(),
    schoolYearId: "sy-2027",
  });
  assert.equal(resolved2026?.schoolClass.id, first.id);
  assert.equal(resolved2027?.schoolClass.id, second.id);

  db.close();
});
