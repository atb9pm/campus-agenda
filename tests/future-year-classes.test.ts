import assert from "node:assert/strict";
import test from "node:test";

import { SCHOOL_WEEK_MONDAYS } from "../src/features/calendar/index.ts";
import { APP_VERSION } from "../src/lib/app-version.ts";
import {
  assignTeacherToCourse,
  createAnnualCourse,
  DRAFT_YEAR_ASSIGNMENT_REASON,
  COURSE_CLASS_YEAR_MISMATCH_REASON,
} from "../src/features/annual-courses/index.ts";
import type { AnnualCourseServiceDeps } from "../src/features/annual-courses/service.ts";
import {
  ARCHIVED_YEAR_MUTATION_REASON,
  CLASS_YEAR_MOVE_REASON,
  assertClassStaysInSchoolYear,
  assertSchoolYearWritable,
  validateAdminClassCreate,
} from "../src/features/school-catalog/index.ts";
import {
  ADMIN_WORKING_YEAR_BADGE_LABELS,
  filterBySchoolYearId,
  formatAdminWorkingSectionTitle,
  formatAdminWorkingYearOption,
  schoolYearStatusesAfterAdminWorkingYearChange,
  writeAdminWorkingYearId,
} from "../src/features/school-year/index.ts";
import { SQL_MIGRATION_FILES, applyMigrations } from "../src/lib/persistence/sql/migrate.ts";
import { createNodeSqliteDatabase } from "../src/lib/persistence/sql/adapters.ts";
import { MemoryAnnualCourseStore, resetMemoryAnnualCourseStore } from "../src/lib/persistence/memory-annual-course-store.ts";
import {
  getMemoryAnnualCourseNotesStore,
  resetMemoryPedagogicalPathStore,
} from "../src/lib/persistence/memory-pedagogical-path-store.ts";
import {
  getMemorySchoolCatalogStore,
  resetMemorySchoolCatalogStore,
} from "../src/lib/persistence/memory-school-catalog-store.ts";
import {
  MemorySchoolYearStore,
  replaceMemorySchoolYears,
  resetMemorySchoolYearStore,
} from "../src/lib/persistence/memory-school-year-store.ts";
import { getMemoryTeacherAccountStore, resetMemoryTeacherAccountStore } from "../src/lib/persistence/memory-teacher-account-store.ts";
import { SqlSchoolCatalogStore } from "../src/lib/persistence/sql/sql-school-catalog-store.ts";
import { SqlSchoolYearStore } from "../src/lib/persistence/sql/sql-school-year-store.ts";
import type { SchoolYearWithWeeks } from "../src/features/school-year/types.ts";

const ACTIVE_ID = "year-2026-active";
const DRAFT_ID = "year-2028-draft";
const ARCHIVED_ID = "year-2025-archived";

function yearRecord(
  id: string,
  label: string,
  status: SchoolYearWithWeeks["status"],
): SchoolYearWithWeeks {
  return {
    id,
    label,
    status,
    startsOn: `${label.slice(0, 4)}-08-01`,
    endsOn: `${label.slice(5)}-07-31`,
    sourceFilename: null,
    importedAt: null,
    activatedAt: status === "active" ? "2026-08-01T00:00:00.000Z" : null,
    createdAt: "2026-01-01T00:00:00.000Z",
    weeks: [],
  };
}

function seedYears(): SchoolYearWithWeeks[] {
  return [
    yearRecord(ACTIVE_ID, "2026-2027", "active"),
    yearRecord(DRAFT_ID, "2028-2029", "draft"),
    yearRecord(ARCHIVED_ID, "2025-2026", "archived"),
  ];
}

async function memoryWorld() {
  resetMemorySchoolCatalogStore();
  resetMemoryAnnualCourseStore();
  resetMemoryPedagogicalPathStore();
  resetMemoryTeacherAccountStore();
  resetMemorySchoolYearStore();
  replaceMemorySchoolYears(seedYears());

  const catalog = getMemorySchoolCatalogStore();
  await catalog.ensureSeeded();
  const years = new MemorySchoolYearStore();
  await catalog.applySchoolYearBackfill(await years.listSchoolYears());

  const profession = await catalog.createProfession({
    label: "Mécatronicien d’automobiles",
    durationYears: 4,
    classCodePrefix: "MA",
  });
  const branches = await catalog.listBranches();
  const moteur = branches.find((entry) => entry.label === "Moteur") ?? branches[0]!;
  const ctx = await catalog.createContext({
    professionId: profession.id,
    trainingYear: 1,
    branchId: moteur.id,
  });
  assert.equal(ctx.ok, true);
  if (!ctx.ok) throw new Error(ctx.reason);

  const existingMa1 = (await catalog.listClasses()).find(
    (entry) => entry.code === "MA1" && entry.schoolYearId === ACTIVE_ID,
  );
  const activeMa1 =
    existingMa1 ??
    (await catalog.createClass({
      code: "MA1",
      label: "MA1",
      schoolYearId: ACTIVE_ID,
      schoolYearLabel: "2026-2027",
      professionId: profession.id,
      trainingYear: 1,
    }));

  const deps: AnnualCourseServiceDeps = {
    courses: new MemoryAnnualCourseStore(),
    catalog,
    years,
    teachers: getMemoryTeacherAccountStore(),
    notes: getMemoryAnnualCourseNotesStore(),
  };

  return { catalog, years, profession, moteur, context: ctx.value, activeMa1, deps };
}

test("version 2.50.0 — préparation classes/cours année future, sans migration", () => {
  assert.equal(APP_VERSION, "2.53.0");
  assert.equal(SQL_MIGRATION_FILES.at(-1), "0029_admin_mfa.sql");
});

test("A — 2026-2027 ACTIVE contient MA1", async () => {
  const world = await memoryWorld();
  const active = (await world.years.listSchoolYears()).find((year) => year.id === ACTIVE_ID);
  assert.equal(active?.status, "active");
  assert.equal(active?.label, "2026-2027");
  assert.equal(world.activeMa1.code, "MA1");
  assert.equal(world.activeMa1.schoolYearId, ACTIVE_ID);
});

test("B — 2028-2029 DRAFT peut aussi contenir MA1, IDs et années distincts", async () => {
  const world = await memoryWorld();
  const draftMa1 = await world.catalog.createClass({
    code: "MA1",
    label: "MA1",
    schoolYearId: DRAFT_ID,
    schoolYearLabel: "2028-2029",
    professionId: world.profession.id,
    trainingYear: 1,
  });
  assert.equal(draftMa1.code, world.activeMa1.code);
  assert.notEqual(draftMa1.id, world.activeMa1.id);
  assert.equal(draftMa1.schoolYearId, DRAFT_ID);
  assert.equal(world.activeMa1.schoolYearId, ACTIVE_ID);
  assert.notEqual(draftMa1.schoolYearId, world.activeMa1.schoolYearId);
});

test("B sqlite — même code MA1 sur deux années, contrainte annuelle", async () => {
  const db = createNodeSqliteDatabase(":memory:");
  await applyMigrations(db);
  const yearStore = new SqlSchoolYearStore(db);
  await yearStore.seedDefaultActiveYearIfEmpty();
  const active = await yearStore.getActiveSchoolYear();
  assert.ok(active);
  const draft = await yearStore.importDraftFromPlan(
    {
      label: "2028-2029",
      startsOn: "2028-08-01",
      endsOn: "2029-07-31",
      weeks: SCHOOL_WEEK_MONDAYS.map((entry) => ({
        number: entry.number,
        kind: null,
        monday: entry.monday,
      })),
      warnings: [],
    },
    "plan-test.pdf",
  );
  assert.equal(draft.status, "draft");

  const catalog = new SqlSchoolCatalogStore(db);
  await catalog.ensureSeeded();
  const profession = await catalog.createProfession({
    label: "Méca SQLite",
    durationYears: 4,
    classCodePrefix: "MA",
  });
  const activeMa1 = await catalog.createClass({
    code: "MA1",
    label: "MA1",
    schoolYearId: active.id,
    schoolYearLabel: active.label,
    professionId: profession.id,
    trainingYear: 1,
  });
  const draftMa1 = await catalog.createClass({
    code: "MA1",
    label: "MA1",
    schoolYearId: draft.id,
    schoolYearLabel: draft.label,
    professionId: profession.id,
    trainingYear: 1,
  });
  assert.notEqual(draftMa1.id, activeMa1.id);
  assert.notEqual(draftMa1.schoolYearId, activeMa1.schoolYearId);
  await assert.rejects(
    catalog.createClass({
      code: "MA1",
      label: "MA1 bis",
      schoolYearId: draft.id,
      schoolYearLabel: draft.label,
      professionId: profession.id,
      trainingYear: 1,
    }),
  );
  db.close();
});

test("C — AnnualCourse 2028-2029 pour une classe 2028-2029 : OK", async () => {
  const world = await memoryWorld();
  const draftMa1 = await world.catalog.createClass({
    code: "MA1",
    label: "MA1",
    schoolYearId: DRAFT_ID,
    schoolYearLabel: "2028-2029",
    professionId: world.profession.id,
    trainingYear: 1,
  });
  const created = await createAnnualCourse(world.deps, {
    schoolYearId: DRAFT_ID,
    classId: draftMa1.id,
    contextId: world.context.id,
  });
  assert.equal(created.ok, true, created.ok ? undefined : created.reason);
  if (!created.ok) return;
  assert.equal(created.value.schoolYearId, DRAFT_ID);
  assert.equal(created.value.classId, draftMa1.id);
});

test("D — AnnualCourse 2028-2029 avec une classe 2026-2027 : REFUS", async () => {
  const world = await memoryWorld();
  const refused = await createAnnualCourse(world.deps, {
    schoolYearId: DRAFT_ID,
    classId: world.activeMa1.id,
    contextId: world.context.id,
  });
  assert.equal(refused.ok, false);
  if (refused.ok) return;
  assert.equal(refused.reason, COURSE_CLASS_YEAR_MISMATCH_REASON);
});

test("E — changer l’année de travail ne modifie aucun SchoolYear.status", async () => {
  const years = seedYears().map(({ weeks: _weeks, ...year }) => year);
  const before = years.map((year) => year.status);
  const storage = new Map<string, string>();
  writeAdminWorkingYearId(
    { setItem: (key, value) => storage.set(key, value) },
    DRAFT_ID,
  );
  const after = schoolYearStatusesAfterAdminWorkingYearChange(years, DRAFT_ID);
  assert.deepEqual(after, before);
  assert.deepEqual(after, ["active", "draft", "archived"]);
  assert.equal(storage.get("campus.adminWorkingSchoolYearId"), DRAFT_ID);
});

test("F/G — vues admin filtrées par année de travail", async () => {
  const world = await memoryWorld();
  const draftMa1 = await world.catalog.createClass({
    code: "MA1",
    label: "MA1",
    schoolYearId: DRAFT_ID,
    schoolYearLabel: "2028-2029",
    professionId: world.profession.id,
    trainingYear: 1,
  });
  const all = await world.catalog.listClasses();
  const draftView = filterBySchoolYearId(all, DRAFT_ID);
  const activeView = filterBySchoolYearId(all, ACTIVE_ID);
  assert.ok(draftView.every((entry) => entry.schoolYearId === DRAFT_ID));
  assert.ok(activeView.every((entry) => entry.schoolYearId === ACTIVE_ID));
  assert.ok(draftView.some((entry) => entry.id === draftMa1.id));
  assert.ok(!draftView.some((entry) => entry.id === world.activeMa1.id));
  assert.ok(activeView.some((entry) => entry.id === world.activeMa1.id));
  assert.ok(!activeView.some((entry) => entry.id === draftMa1.id));
});

test("H — année archivée refuse créations et modifications", async () => {
  const world = await memoryWorld();
  const years = await world.years.listSchoolYears();
  const archivedCreate = validateAdminClassCreate({
    schoolYearId: ARCHIVED_ID,
    professionId: world.profession.id,
    trainingYear: 1,
    years,
    professions: [world.profession],
  });
  assert.equal(archivedCreate.ok, false);
  if (!archivedCreate.ok) {
    assert.equal(archivedCreate.reason, ARCHIVED_YEAR_MUTATION_REASON);
  }

  const archivedClass = await world.catalog.createClass({
    code: "HIST",
    label: "HIST",
    schoolYearId: ARCHIVED_ID,
    schoolYearLabel: "2025-2026",
    professionId: world.profession.id,
    trainingYear: 1,
  });
  const archivedCourse = await createAnnualCourse(world.deps, {
    schoolYearId: ARCHIVED_ID,
    classId: archivedClass.id,
    contextId: world.context.id,
  });
  assert.equal(archivedCourse.ok, false);
  if (!archivedCourse.ok) {
    assert.equal(archivedCourse.reason, ARCHIVED_YEAR_MUTATION_REASON);
  }

  const writable = assertSchoolYearWritable(years.find((year) => year.id === ARCHIVED_ID));
  assert.equal(writable.ok, false);
  const draftOk = assertSchoolYearWritable(years.find((year) => year.id === DRAFT_ID));
  assert.equal(draftOk.ok, true);
  const activeOk = assertSchoolYearWritable(years.find((year) => year.id === ACTIVE_ID));
  assert.equal(activeOk.ok, true);

  const move = assertClassStaysInSchoolYear({
    currentSchoolYearId: DRAFT_ID,
    nextSchoolYearId: ACTIVE_ID,
  });
  assert.equal(move.ok, false);
  if (!move.ok) assert.equal(move.reason, CLASS_YEAR_MOVE_REASON);
});

test("I — données 2026-2027 inchangées après préparation 2028-2029", async () => {
  const world = await memoryWorld();
  const beforeClasses = (await world.catalog.listClasses()).filter((entry) => entry.schoolYearId === ACTIVE_ID);
  const beforeCourses = await world.deps.courses.listCourses();
  const snapshot = beforeClasses.map((entry) => ({
    id: entry.id,
    code: entry.code,
    schoolYearId: entry.schoolYearId,
    professionId: entry.professionId,
    trainingYear: entry.trainingYear,
  }));

  const draftMa1 = await world.catalog.createClass({
    code: "MA1",
    label: "MA1",
    schoolYearId: DRAFT_ID,
    schoolYearLabel: "2028-2029",
    professionId: world.profession.id,
    trainingYear: 1,
  });
  const created = await createAnnualCourse(world.deps, {
    schoolYearId: DRAFT_ID,
    classId: draftMa1.id,
    contextId: world.context.id,
  });
  assert.equal(created.ok, true);

  const afterClasses = (await world.catalog.listClasses()).filter((entry) => entry.schoolYearId === ACTIVE_ID);
  assert.deepEqual(
    afterClasses.map((entry) => ({
      id: entry.id,
      code: entry.code,
      schoolYearId: entry.schoolYearId,
      professionId: entry.professionId,
      trainingYear: entry.trainingYear,
    })),
    snapshot,
  );
  assert.deepEqual(await world.deps.courses.listCourses().then((courses) => courses.filter((course) => course.schoolYearId === ACTIVE_ID)), beforeCourses);
  const active = await world.years.getActiveSchoolYear();
  const draft = await world.years.getSchoolYearById(DRAFT_ID);
  assert.equal(active?.status, "active");
  assert.equal(active?.label, "2026-2027");
  assert.equal(draft?.status, "draft");
  assert.equal(draft?.label, "2028-2029");
});

test("contexte pédagogique stable — profession/branche/CTX non dupliqués", async () => {
  const world = await memoryWorld();
  const professionId = world.profession.id;
  const branchId = world.moteur.id;
  const contextId = world.context.id;
  await world.catalog.createClass({
    code: "MA1",
    label: "MA1",
    schoolYearId: DRAFT_ID,
    schoolYearLabel: "2028-2029",
    professionId,
    trainingYear: 1,
  });
  assert.equal((await world.catalog.listProfessions()).filter((entry) => entry.id === professionId).length, 1);
  assert.equal((await world.catalog.listBranches()).filter((entry) => entry.id === branchId).length, 1);
  assert.equal((await world.catalog.listContexts()).filter((entry) => entry.id === contextId).length, 1);
});

test("UI — titres et badges année de travail", () => {
  const draft = { id: DRAFT_ID, label: "2028-2029", status: "draft" as const };
  const active = { id: ACTIVE_ID, label: "2026-2027", status: "active" as const };
  assert.equal(formatAdminWorkingSectionTitle("classes", draft), "Classes — 2028–2029");
  assert.equal(formatAdminWorkingSectionTitle("courses", draft), "Cours — 2028–2029");
  assert.equal(formatAdminWorkingYearOption(draft), "2028–2029 — Préparation");
  assert.equal(formatAdminWorkingYearOption(active), "2026–2027");
  assert.equal(ADMIN_WORKING_YEAR_BADGE_LABELS.draft, "Préparation");
  assert.equal(ADMIN_WORKING_YEAR_BADGE_LABELS.active, "Active");
});

test("affectation professeur refusée sur une année DRAFT", async () => {
  const world = await memoryWorld();
  const draftMa1 = await world.catalog.createClass({
    code: "MA1",
    label: "MA1",
    schoolYearId: DRAFT_ID,
    schoolYearLabel: "2028-2029",
    professionId: world.profession.id,
    trainingYear: 1,
  });
  const course = await createAnnualCourse(world.deps, {
    schoolYearId: DRAFT_ID,
    classId: draftMa1.id,
    contextId: world.context.id,
  });
  assert.equal(course.ok, true);
  if (!course.ok) return;
  await world.catalog.updateBranch(world.moteur.id, { teachingType: "TECHNICAL" });
  const teacher = await world.deps.teachers.createAccount({
    displayName: "Prof Technique",
    initials: "PTe",
    teachingType: "TECHNICAL",
  });
  assert.equal(teacher.ok, true);
  if (!teacher.ok) return;
  const assigned = await assignTeacherToCourse(world.deps, {
    annualCourseId: course.value.id,
    teacherId: teacher.account.id,
    role: "PRIMARY",
    validFrom: "2028-08-21",
    createdByAdminId: "admin-1",
  });
  assert.equal(assigned.ok, false);
  if (!assigned.ok) {
    assert.equal(assigned.reason, DRAFT_YEAR_ASSIGNMENT_REASON);
  }
});
