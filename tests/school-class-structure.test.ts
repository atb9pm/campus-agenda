import assert from "node:assert/strict";
import test from "node:test";

process.env.CAMPUS_PBKDF2_ITERATIONS ??= "10000";

import {
  buildClassCode,
  buildClassLabel,
  createStructuredClasses,
  normalizeClassCodePrefix,
  parseStructuredClassesRequest,
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

test("API — organization invalide non convertie en unique, parallelCodes typé", () => {
  assert.equal(parseStructuredClassesRequest({}).ok, false);
  assert.equal(parseStructuredClassesRequest({ organization: "mixte" }).ok, false);
  assert.equal(parseStructuredClassesRequest({ organization: "unique" }).ok, true);
  assert.equal(parseStructuredClassesRequest({ organization: "parallel" }).ok, false);
  assert.equal(parseStructuredClassesRequest({ organization: "parallel", parallelCodes: "A" }).ok, false);
  assert.equal(parseStructuredClassesRequest({ organization: "parallel", parallelCodes: [1] }).ok, false);
  const ok = parseStructuredClassesRequest({ organization: "parallel", parallelCodes: ["A", "B"] });
  assert.equal(ok.ok, true);
  if (ok.ok) assert.deepEqual(ok.value.parallelCodes, ["A", "B"]);
});

test("groupes — A/B/C ok, deux A refusés même avec codes différents, A ok sur une autre année", async () => {
  const { store, profession } = await professionWithPlan();
  const first = await createStructuredClasses(store, {
    years: [YEAR_2026, YEAR_2027],
    input: {
      schoolYearId: YEAR_2026.id,
      professionId: profession.id,
      trainingYear: 1,
      organization: "parallel",
      parallelCodes: ["A", "B", "C"],
    },
  });
  assert.equal(first.ok, true);

  await assert.rejects(
    () =>
      store.createClass({
        code: "MMX1A",
        label: "MMX 1A",
        schoolYearId: YEAR_2026.id,
        schoolYearLabel: YEAR_2026.label,
        professionId: profession.id,
        trainingYear: 1,
        parallelCode: "A",
      }),
    /groupe A/i,
  );

  const otherYear = await store.createClass({
    code: "MMA1A",
    label: "MMA 1A",
    schoolYearId: YEAR_2027.id,
    schoolYearLabel: YEAR_2027.label,
    professionId: profession.id,
    trainingYear: 1,
    parallelCode: "A",
  });
  assert.equal(otherYear.parallelCode, "A");

  const unique = await store.createClass({
    code: "MMA2",
    label: "MMA 2",
    schoolYearId: YEAR_2026.id,
    schoolYearLabel: YEAR_2026.label,
    professionId: profession.id,
    trainingYear: 2,
    parallelCode: null,
  });
  assert.equal(unique.parallelCode, null);
  await assert.rejects(
    () =>
      store.createClass({
        code: "MMA2B",
        label: "MMA 2B",
        schoolYearId: YEAR_2026.id,
        schoolYearLabel: YEAR_2026.label,
        professionId: profession.id,
        trainingYear: 2,
        parallelCode: null,
      }),
    /classe unique/i,
  );

  const legacy = await store.createClass({
    code: "LEGACYZ",
    label: "LEGACYZ",
    schoolYearId: null,
    parallelCode: "A",
  });
  assert.equal(legacy.schoolYearId, null);
});

test("groupes — modifier le préfixe ne permet pas de recréer A en doublon", async () => {
  const { store, profession } = await professionWithPlan();
  await store.createClass({
    code: "MMA1A",
    label: "MMA 1A",
    schoolYearId: YEAR_2026.id,
    schoolYearLabel: YEAR_2026.label,
    professionId: profession.id,
    trainingYear: 1,
    parallelCode: "A",
  });
  const updated = await store.updateProfession(profession.id, { classCodePrefix: "MM" });
  assert.equal(updated.ok, true);
  const duplicate = await createStructuredClasses(store, {
    years: [YEAR_2026],
    input: {
      schoolYearId: YEAR_2026.id,
      professionId: profession.id,
      trainingYear: 1,
      organization: "parallel",
      parallelCodes: ["A", "B"],
    },
  });
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) assert.match(duplicate.reason, /groupe A/i);
});

test("batch atomique — échec au milieu, zéro classe du lot (Memory + SQL)", async () => {
  const { store, profession } = await professionWithPlan();
  const beforeIds = new Set((await store.listClasses()).map((entry) => entry.id));
  await assert.rejects(
    () =>
      store.createClassesBatch([
        {
          code: "MMA1A",
          label: "MMA 1A",
          schoolYearId: YEAR_2026.id,
          schoolYearLabel: YEAR_2026.label,
          professionId: profession.id,
          trainingYear: 1,
          parallelCode: "A",
        },
        {
          code: "MMA1B",
          label: "MMA 1B",
          schoolYearId: YEAR_2026.id,
          schoolYearLabel: YEAR_2026.label,
          professionId: profession.id,
          trainingYear: 1,
          parallelCode: "A",
        },
      ]),
    /groupe A/i,
  );
  const afterMemory = await store.listClasses();
  assert.deepEqual(
    afterMemory.map((entry) => entry.id),
    [...beforeIds],
  );
  assert.equal(afterMemory.some((entry) => entry.code === "MMA1A" && entry.schoolYearId === YEAR_2026.id), false);

  const db = createNodeSqliteDatabase(":memory:");
  await applyMigrations(db);
  const catalog = new SqlSchoolCatalogStore(db);
  await catalog.ensureSeeded();
  const sqlProfession = await catalog.createProfession({
    label: "Mécanicien en maintenance",
    durationYears: 3,
    classCodePrefix: "MMA",
  });
  const branches = await catalog.listBranches();
  await catalog.createContext({
    professionId: sqlProfession.id,
    trainingYear: 1,
    branchId: branches[0]!.id,
  });
  const beforeSql = new Set((await catalog.listClasses()).map((entry) => entry.id));
  const originalBatch = db.batch.bind(db);
  db.batch = async (statements) => {
    db.db.exec("BEGIN");
    try {
      for (const [index, statement] of statements.entries()) {
        if (index === 1) throw new Error("échec volontaire");
        db.db.prepare(statement.sql).run(...statement.values);
      }
      db.db.exec("COMMIT");
    } catch (error) {
      db.db.exec("ROLLBACK");
      throw error;
    }
  };
  await assert.rejects(
    () =>
      catalog.createClassesBatch([
        {
          code: "MMA1A",
          label: "MMA 1A",
          schoolYearId: YEAR_2026.id,
          schoolYearLabel: YEAR_2026.label,
          professionId: sqlProfession.id,
          trainingYear: 1,
          parallelCode: "A",
        },
        {
          code: "MMA1B",
          label: "MMA 1B",
          schoolYearId: YEAR_2026.id,
          schoolYearLabel: YEAR_2026.label,
          professionId: sqlProfession.id,
          trainingYear: 1,
          parallelCode: "B",
        },
        {
          code: "MMA1C",
          label: "MMA 1C",
          schoolYearId: YEAR_2026.id,
          schoolYearLabel: YEAR_2026.label,
          professionId: sqlProfession.id,
          trainingYear: 1,
          parallelCode: "C",
        },
      ]),
    /échec volontaire/,
  );
  db.batch = originalBatch;
  const afterSql = await catalog.listClasses();
  assert.deepEqual(
    afterSql.map((entry) => entry.id).sort(),
    [...beforeSql].sort(),
  );
  assert.equal(afterSql.some((entry) => entry.code === "MMA1A"), false);
  db.close();
});

test("migration 0020 — deux classes structurées pré-0020 sans groupe restent NULL et éditables", async () => {
  const db = createNodeSqliteDatabase(":memory:");
  await applyMigrations(db, { until: "0019_annual_courses_teacher_assignments.sql" });

  await db
    .prepare(
      `INSERT INTO school_professions (id, admin_code, label, duration_years, sort_order, is_active)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind("prof-ma", "PRF-0099", "Mécanicien automobile", 4, 1, 1)
    .run();
  await db
    .prepare(
      `INSERT INTO school_classes
         (id, code, label, sort_order, is_active, school_year_label, profession_id, training_year, school_year_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind("class-ma3a", "MA3A", "MA3A", 1, 1, "2026-2027", "prof-ma", 3, "sy-2026")
    .run();
  await db
    .prepare(
      `INSERT INTO school_classes
         (id, code, label, sort_order, is_active, school_year_label, profession_id, training_year, school_year_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind("class-ma3b", "MA3B", "MA3B", 2, 1, "2026-2027", "prof-ma", 3, "sy-2026")
    .run();

  await applyMigrations(db, { until: "0020_school_class_structure.sql" });

  const uniqueIndex = await db
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'index' AND name = 'idx_school_classes_structured_unique'`,
    )
    .bind()
    .first<{ name: string }>();
  assert.equal(uniqueIndex, null);

  const afterMigrate = await db
    .prepare(
      `SELECT id, code, parallel_code FROM school_classes
       WHERE id IN (?, ?) ORDER BY code`,
    )
    .bind("class-ma3a", "class-ma3b")
    .all<{ id: string; code: string; parallel_code: string | null }>();
  assert.deepEqual(
    (afterMigrate.results ?? []).map((row) => ({
      id: row.id,
      code: row.code,
      parallelCode: row.parallel_code,
    })),
    [
      { id: "class-ma3a", code: "MA3A", parallelCode: null },
      { id: "class-ma3b", code: "MA3B", parallelCode: null },
    ],
  );

  const catalog = new SqlSchoolCatalogStore(db);
  await catalog.ensureSeeded();
  await assert.rejects(
    () =>
      catalog.createClass({
        code: "MA3",
        label: "MA 3",
        schoolYearId: "sy-2026",
        schoolYearLabel: "2026-2027",
        professionId: "prof-ma",
        trainingYear: 3,
        parallelCode: null,
      }),
    /classe unique/i,
  );
  const assignedA = await catalog.updateClass("class-ma3a", { parallelCode: "A" });
  const assignedB = await catalog.updateClass("class-ma3b", { parallelCode: "B" });
  assert.equal(assignedA?.parallelCode, "A");
  assert.equal(assignedB?.parallelCode, "B");

  await assert.rejects(
    () =>
      catalog.createClass({
        code: "MAX3A",
        label: "MAX 3A",
        schoolYearId: "sy-2026",
        schoolYearLabel: "2026-2027",
        professionId: "prof-ma",
        trainingYear: 3,
        parallelCode: "A",
      }),
    /groupe A/i,
  );

  const unique = await catalog.createClass({
    code: "MA3",
    label: "MA 3",
    schoolYearId: "sy-2026",
    schoolYearLabel: "2026-2027",
    professionId: "prof-ma",
    trainingYear: 3,
    parallelCode: null,
  });
  assert.equal(unique.parallelCode, null);
  await assert.rejects(
    () =>
      catalog.createClass({
        code: "MA3U",
        label: "MA 3U",
        schoolYearId: "sy-2026",
        schoolYearLabel: "2026-2027",
        professionId: "prof-ma",
        trainingYear: 3,
        parallelCode: null,
      }),
    /classe unique/i,
  );

  db.close();
});

test("migration 0020 — replay ne reconstruit pas school_classes (colonne future conservée)", async () => {
  const db = createNodeSqliteDatabase(":memory:");
  await applyMigrations(db, { until: "0020_school_class_structure.sql" });
  await db.exec("ALTER TABLE school_classes ADD COLUMN future_note TEXT;");
  await db
    .prepare(
      `INSERT INTO school_classes (id, code, label, sort_order, is_active, future_note)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind("future-keep-1", "FUT1", "FUT1", 99, 1, "conserver-moi")
    .run();
  const before = await db
    .prepare("SELECT id, future_note FROM school_classes WHERE id = ?")
    .bind("future-keep-1")
    .all<{ id: string; future_note: string }>();
  assert.equal(before.results?.[0]?.future_note, "conserver-moi");

  await applyMigrations(db);

  const columns = await db
    .prepare("PRAGMA table_info(school_classes)")
    .bind()
    .all<{ name: string }>();
  assert.ok((columns.results ?? []).some((row) => row.name === "future_note"));
  const after = await db
    .prepare("SELECT future_note FROM school_classes WHERE id = ?")
    .bind(before.results![0]!.id)
    .first<{ future_note: string }>();
  assert.equal(after?.future_note, "conserver-moi");
  const recorded = await db
    .prepare("SELECT filename FROM schema_migrations WHERE filename = ?")
    .bind("0020_school_class_structure.sql")
    .first<{ filename: string }>();
  assert.equal(recorded?.filename, "0020_school_class_structure.sql");
  db.close();
});
