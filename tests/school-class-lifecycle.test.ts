import assert from "node:assert/strict";
import test from "node:test";

process.env.CAMPUS_PBKDF2_ITERATIONS ??= "10000";

import { APP_VERSION } from "../src/lib/app-version.ts";
import {
  applyClassLifecyclePatch,
  classDeleteBlockers,
  classDisplayMeta,
  classDisplayProfessionLabel,
  classLifecycleStatus,
  countClassesByStatus,
  filterClassesByStatus,
  formatProfessionPrefixBadge,
  groupSchoolClasses,
  listActiveSchoolClasses,
  type SchoolClassRecord,
  type SchoolProfessionRecord,
} from "../src/features/school-catalog/index.ts";
import {
  getMemorySchoolCatalogStore,
  resetMemorySchoolCatalogStore,
} from "../src/lib/persistence/memory-school-catalog-store.ts";
import { createNodeSqliteDatabase } from "../src/lib/persistence/sql/adapters.ts";
import { applyMigrations } from "../src/lib/persistence/sql/migrate.ts";
import { SqlSchoolCatalogStore } from "../src/lib/persistence/sql/sql-school-catalog-store.ts";
import { MemoryAnnualCourseStore } from "../src/lib/persistence/memory-annual-course-store.ts";

function freshCatalog() {
  resetMemorySchoolCatalogStore();
  return getMemorySchoolCatalogStore();
}

function classRecord(overrides: Partial<SchoolClassRecord> & Pick<SchoolClassRecord, "id" | "code">): SchoolClassRecord {
  return {
    label: overrides.label ?? overrides.code,
    sortOrder: overrides.sortOrder ?? 1,
    isActive: overrides.isActive ?? true,
    schoolYearId: overrides.schoolYearId ?? "sy-2026",
    schoolYearLabel: overrides.schoolYearLabel ?? "2026-2027",
    professionId: overrides.professionId ?? "prof-1",
    trainingYear: overrides.trainingYear ?? 1,
    parallelCode: overrides.parallelCode ?? null,
    isArchived: overrides.isArchived ?? false,
    archivedAt: overrides.archivedAt ?? null,
    ...overrides,
  };
}

test("version 2.23.0", () => {
  assert.equal(APP_VERSION, "2.23.0");
});

test("affichage — abréviations métier non tronquées", () => {
  assert.equal(formatProfessionPrefixBadge("MECMA"), "MECMA");
  assert.equal(formatProfessionPrefixBadge("MECAUTO"), "MECAUTO");
  assert.equal(formatProfessionPrefixBadge("CONDVL"), "CONDVL");
  assert.equal(formatProfessionPrefixBadge("AMA"), "AMA");
  assert.notEqual(formatProfessionPrefixBadge("MECMA"), "MEC");
});

test("affichage — classe structurée montre la profession, pas le libellé généré", () => {
  const schoolClass = classRecord({
    id: "c-condvl1",
    code: "CONDVL1",
    label: "CONDVL 1",
    parallelCode: null,
  });
  const profession: SchoolProfessionRecord = {
    id: "prof-1",
    adminCode: "PRF-0001",
    label: "Conducteur de véhicules lourds",
    classCodePrefix: "CONDVL",
    durationYears: 3,
    sortOrder: 1,
    isActive: true,
    isArchived: false,
    archivedAt: null,
  };
  assert.equal(classDisplayProfessionLabel(schoolClass, profession), "Conducteur de véhicules lourds");
  assert.notEqual(classDisplayProfessionLabel(schoolClass, profession), "CONDVL 1");
  assert.match(classDisplayMeta(schoolClass), /1re année/);
  assert.match(classDisplayMeta(schoolClass), /Groupe : aucun/);
  assert.match(classDisplayMeta(schoolClass), /2026-2027/);

  const grouped = classRecord({
    id: "c-mecma1a",
    code: "MECMA1A",
    label: "MECMA 1A",
    parallelCode: "A",
  });
  assert.match(classDisplayMeta(grouped), /Groupe A/);
});

test("affichage — legacy sans profession utilise le label", () => {
  const legacy = classRecord({
    id: "c-ma1",
    code: "MA1",
    label: "MA 1 historique",
    professionId: null,
    trainingYear: null,
    schoolYearId: null,
    schoolYearLabel: null,
  });
  assert.equal(classDisplayProfessionLabel(legacy, null), "MA 1 historique");
});

test("lifecycle — nouvelle classe, désactivation, archivage, désarchivage, réactivation", async () => {
  const store = freshCatalog();
  const created = await store.createClass({ code: "ZZ9", label: "ZZ9" });
  assert.equal(created.isActive, true);
  assert.equal(created.isArchived, false);
  assert.equal(created.archivedAt, null);
  assert.equal(classLifecycleStatus(created), "active");

  const disabled = await store.updateClass(created.id, { isActive: false });
  assert.equal(disabled?.isActive, false);
  assert.equal(disabled?.isArchived, false);
  assert.equal(classLifecycleStatus(disabled!), "inactive");

  const archived = await store.updateClass(created.id, { isArchived: true });
  assert.equal(archived?.isActive, false);
  assert.equal(archived?.isArchived, true);
  assert.ok(archived?.archivedAt);
  assert.equal(classLifecycleStatus(archived!), "archived");

  const unarchived = await store.updateClass(created.id, { isArchived: false });
  assert.equal(unarchived?.isActive, false);
  assert.equal(unarchived?.isArchived, false);
  assert.equal(unarchived?.archivedAt, null);
  assert.equal(classLifecycleStatus(unarchived!), "inactive");

  const reactivated = await store.updateClass(created.id, { isActive: true });
  assert.equal(reactivated?.isActive, true);
  assert.equal(reactivated?.isArchived, false);

  await assert.rejects(
    () => store.updateClass(created.id, { isArchived: true }).then((entry) =>
      store.updateClass(entry!.id, { isActive: true }),
    ),
    /Désarchivez/,
  );
});

test("lifecycle — applyClassLifecyclePatch ne réactive pas au désarchivage", () => {
  const archived = applyClassLifecyclePatch(
    { isActive: false, isArchived: true, archivedAt: "2026-01-01T00:00:00.000Z" },
    { isArchived: false },
  );
  assert.equal(archived.ok, true);
  if (!archived.ok) return;
  assert.equal(archived.value.isActive, false);
  assert.equal(archived.value.isArchived, false);
  assert.equal(archived.value.archivedAt, null);
});

test("suppression — classe jamais utilisée autorisée ; cours / attribution / publication bloquent", async () => {
  const store = freshCatalog();
  const unused = await store.createClass({ code: "FREE1", label: "FREE1", schoolYearId: "sy-2026" });
  assert.equal(await store.deleteClass(unused.id), true);
  assert.equal((await store.listClasses()).some((entry) => entry.id === unused.id), false);

  const used = classRecord({ id: "used-1", code: "MMA1A", schoolYearId: "sy-2026" });
  const otherYear = classRecord({ id: "used-2", code: "MMA1A", schoolYearId: "sy-2027", schoolYearLabel: "2027-2028" });
  const emptyUsage = {
    courses: [],
    assignments: [],
    notes: [],
    agendaItems: [],
    timetableSlots: [],
    linkedClassroomIds: [],
  };
  assert.equal(classDeleteBlockers(used, [used, otherYear], emptyUsage).ok, true);

  const withCourse = classDeleteBlockers(used, [used], {
    ...emptyUsage,
    courses: [{ id: "ac-1", classId: used.id }],
  });
  assert.equal(withCourse.ok, false);
  if (!withCourse.ok) assert.match(withCourse.reason, /1 cours annuel/);

  const withAssignment = classDeleteBlockers(used, [used], {
    ...emptyUsage,
    courses: [{ id: "ac-1", classId: used.id }],
    assignments: [{ annualCourseId: "ac-1" }],
  });
  assert.equal(withAssignment.ok, false);
  if (!withAssignment.ok) assert.match(withAssignment.reason, /1 attribution/);

  const withPublication = classDeleteBlockers(used, [used, otherYear], {
    ...emptyUsage,
    agendaItems: [{ classroomId: "MMA1A", schoolYearId: "sy-2026" }],
  });
  assert.equal(withPublication.ok, false);
  if (!withPublication.ok) assert.match(withPublication.reason, /1 publication/);

  const otherYearOk = classDeleteBlockers(otherYear, [used, otherYear], {
    ...emptyUsage,
    agendaItems: [{ classroomId: "MMA1A", schoolYearId: "sy-2026" }],
  });
  assert.equal(otherYearOk.ok, true);

  const legacyA = classRecord({
    id: "leg-a",
    code: "LEG1",
    schoolYearId: null,
    schoolYearLabel: null,
    professionId: null,
    trainingYear: null,
  });
  const legacyB = classRecord({
    id: "leg-b",
    code: "LEG1",
    schoolYearId: null,
    schoolYearLabel: "autre",
    professionId: null,
    trainingYear: null,
  });
  const ambiguous = classDeleteBlockers(legacyA, [legacyA, legacyB], {
    ...emptyUsage,
    agendaItems: [{ classroomId: "LEG1", schoolYearId: null }],
  });
  assert.equal(ambiguous.ok, false);
});

test("suppression Memory — AnnualCourse refuse, aucune donnée dépendante effacée", async () => {
  const store = freshCatalog();
  const created = await store.createClass({
    code: "DEL1",
    label: "DEL1",
    schoolYearId: "sy-2026",
    schoolYearLabel: "2026-2027",
  });
  const courses = new MemoryAnnualCourseStore();
  await courses.createCourse({
    id: "ac-del",
    schoolYearId: "sy-2026",
    classId: created.id,
    contextId: "ctx-1",
    isArchived: false,
    archivedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  const blockers = classDeleteBlockers(created, await store.listClasses(), {
    courses: await courses.listCourses(),
    assignments: [],
    notes: [],
    agendaItems: [],
    timetableSlots: [],
    linkedClassroomIds: [],
  });
  assert.equal(blockers.ok, false);
  assert.equal((await courses.listCourses()).length, 1);
  assert.ok((await store.listClasses()).some((entry) => entry.id === created.id));
});

test("filtres — Actives / Désactivées / Archivées", () => {
  const classes = [
    classRecord({ id: "a", code: "A1", isActive: true, isArchived: false }),
    classRecord({ id: "b", code: "B1", isActive: false, isArchived: false }),
    classRecord({ id: "c", code: "C1", isActive: false, isArchived: true, archivedAt: "2026-01-01T00:00:00.000Z" }),
  ];
  assert.deepEqual(countClassesByStatus(classes), { active: 1, inactive: 1, archived: 1 });
  assert.deepEqual(filterClassesByStatus(classes, "active").map((entry) => entry.id), ["a"]);
  assert.deepEqual(filterClassesByStatus(classes, "inactive").map((entry) => entry.id), ["b"]);
  assert.deepEqual(filterClassesByStatus(classes, "archived").map((entry) => entry.id), ["c"]);
  assert.equal(listActiveSchoolClasses(classes).length, 1);
  assert.equal(listActiveSchoolClasses(classes)[0]?.id, "a");
});

test("regroupements — profession, année scolaire, année de formation, code", () => {
  const professions: SchoolProfessionRecord[] = [
    {
      id: "p-mec",
      adminCode: "PRF-0001",
      label: "Mécanicien en maintenance d’automobiles",
      classCodePrefix: "MECMA",
      durationYears: 3,
      sortOrder: 1,
      isActive: true,
      isArchived: false,
      archivedAt: null,
    },
    {
      id: "p-cond",
      adminCode: "PRF-0002",
      label: "Conducteur de véhicules lourds",
      classCodePrefix: "CONDVL",
      durationYears: 3,
      sortOrder: 2,
      isActive: true,
      isArchived: false,
      archivedAt: null,
    },
  ];
  const classes = [
    classRecord({ id: "1", code: "MECMA1B", professionId: "p-mec", trainingYear: 1, parallelCode: "B" }),
    classRecord({ id: "2", code: "CONDVL1", professionId: "p-cond", trainingYear: 1, parallelCode: null }),
    classRecord({ id: "3", code: "MECMA1A", professionId: "p-mec", trainingYear: 1, parallelCode: "A" }),
    classRecord({ id: "4", code: "MECMA2A", professionId: "p-mec", trainingYear: 2, parallelCode: "A" }),
    classRecord({
      id: "5",
      code: "MECMA1A",
      professionId: "p-mec",
      trainingYear: 1,
      parallelCode: "A",
      schoolYearId: "sy-2027",
      schoolYearLabel: "2027-2028",
    }),
  ];

  const byProfession = groupSchoolClasses({ classes, professions, groupBy: "profession" });
  assert.equal(byProfession[0]?.title, "Mécanicien en maintenance d’automobiles — MECMA");
  assert.deepEqual(byProfession[0]?.classes.map((entry) => entry.code), ["MECMA1A", "MECMA1A", "MECMA1B", "MECMA2A"]);
  assert.equal(byProfession[1]?.title, "Conducteur de véhicules lourds — CONDVL");

  const byYear = groupSchoolClasses({ classes, professions, groupBy: "schoolYear" });
  assert.equal(byYear[0]?.title, "2027-2028");
  assert.equal(byYear[1]?.title, "2026-2027");

  const byTraining = groupSchoolClasses({ classes, professions, groupBy: "trainingYear" });
  assert.equal(byTraining[0]?.title, "1re année");
  assert.equal(byTraining[1]?.title, "2e année");

  const byCode = groupSchoolClasses({ classes, professions, groupBy: "code" });
  assert.deepEqual(
    byCode[0]?.classes.map((entry) => entry.code),
    ["CONDVL1", "MECMA1A", "MECMA1A", "MECMA1B", "MECMA2A"],
  );
});

test("migration 0021 — 0019 → 0020 → 0021 puis replay conserve les classes", async () => {
  const db = createNodeSqliteDatabase(":memory:");
  await applyMigrations(db, { until: "0019_annual_courses_teacher_assignments.sql" });
  await db
    .prepare(
      `INSERT INTO school_classes
         (id, code, label, sort_order, is_active, school_year_label, profession_id, training_year, school_year_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind("keep-1", "KEEP1", "KEEP1", 1, 1, "2026-2027", null, null, null)
    .run();
  await applyMigrations(db, { until: "0020_school_class_structure.sql" });
  await applyMigrations(db, { until: "0021_school_class_lifecycle.sql" });
  await applyMigrations(db);

  const columns = await db
    .prepare("PRAGMA table_info(school_classes)")
    .bind()
    .all<{ name: string }>();
  const names = (columns.results ?? []).map((row) => row.name);
  assert.ok(names.includes("is_archived"));
  assert.ok(names.includes("archived_at"));

  const row = await db
    .prepare("SELECT id, code, is_archived, archived_at FROM school_classes WHERE id = ?")
    .bind("keep-1")
    .first<{ id: string; code: string; is_archived: number; archived_at: string | null }>();
  assert.equal(row?.code, "KEEP1");
  assert.equal(row?.is_archived, 0);
  assert.equal(row?.archived_at, null);

  const catalog = new SqlSchoolCatalogStore(db);
  await catalog.ensureSeeded();
  const listed = await catalog.listClasses();
  const keep = listed.find((entry) => entry.id === "keep-1");
  assert.equal(keep?.isArchived, false);
  assert.equal(keep?.archivedAt, null);

  const created = await catalog.createClass({ code: "SQL1", label: "SQL1", schoolYearId: "sy-2026" });
  const archived = await catalog.updateClass(created.id, { isArchived: true });
  assert.equal(archived?.isArchived, true);
  assert.equal(archived?.isActive, false);
  await applyMigrations(db);
  const still = (await catalog.listClasses()).find((entry) => entry.id === created.id);
  assert.equal(still?.isArchived, true);

  const unusedSql = await catalog.createClass({ code: "SQLDEL", label: "SQLDEL", schoolYearId: "sy-2026" });
  assert.equal(await catalog.deleteClass(unusedSql.id), true);
  assert.equal((await catalog.listClasses()).some((entry) => entry.id === unusedSql.id), false);
  db.close();
});
