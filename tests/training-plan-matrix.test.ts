import assert from "node:assert/strict";
import test from "node:test";

import { createAnnualCourse } from "../src/features/annual-courses/index.ts";
import { ensurePathForContext, mutatePath } from "../src/features/pedagogical-path/path-service.ts";
import {
  CTX_IN_USE_DELETE_REASON,
  formatPedagogicalContextLabel,
  listPlannedBranchesForClass,
  projectTrainingPlanMatrix,
  summarizeBranchUsages,
  trainingYearsForDuration,
} from "../src/features/school-catalog/index.ts";
import {
  getMemoryAnnualCourseStore,
  resetMemoryAnnualCourseStore,
} from "../src/lib/persistence/memory-annual-course-store.ts";
import {
  getMemoryAnnualCourseNotesStore,
  getMemoryPedagogicalPathStore,
  resetMemoryPedagogicalPathStore,
} from "../src/lib/persistence/memory-pedagogical-path-store.ts";
import {
  getMemorySchoolCatalogStore,
  resetMemorySchoolCatalogStore,
} from "../src/lib/persistence/memory-school-catalog-store.ts";
import {
  getMemoryTeacherAccountStore,
  resetMemoryTeacherAccountStore,
} from "../src/lib/persistence/memory-teacher-account-store.ts";
import type { SchoolYearStore } from "../src/lib/persistence/school-year-types.ts";

function yearsStub(): SchoolYearStore {
  return {
    listSchoolYears: async () => [
      {
        id: "year-2027",
        label: "2027-2028",
        status: "active",
        startsOn: "2027-08-01",
        endsOn: "2028-07-31",
        sourceFilename: null,
        importedAt: null,
        activatedAt: null,
        createdAt: "2027-01-01T00:00:00.000Z",
      },
    ],
  } as SchoolYearStore;
}

async function setupPlanWorld() {
  resetMemorySchoolCatalogStore();
  resetMemoryAnnualCourseStore();
  resetMemoryPedagogicalPathStore();
  resetMemoryTeacherAccountStore();
  const catalog = getMemorySchoolCatalogStore();
  await catalog.ensureSeeded();
  const ma = await catalog.createProfession({
    label: "Mécatronicien automobile",
    durationYears: 4,
    classCodePrefix: "MA",
  });
  const mma = await catalog.createProfession({
    label: "Mécanicien en maintenance automobile",
    durationYears: 3,
    classCodePrefix: "MMA",
  });
  const twoYears = await catalog.createProfession({
    label: "Profession courte",
    durationYears: 2,
    classCodePrefix: "PC",
  });
  const branches = await catalog.listBranches();
  const moteur = branches.find((entry) => entry.label === "Moteur");
  assert.ok(moteur);
  await catalog.updateBranch(moteur.id, { teachingType: "TECHNICAL" });
  const diagnostic = await catalog.createBranch({
    code: "DIAGNOSTIC",
    label: "Diagnostic",
    teachingType: "TECHNICAL",
  });
  return { catalog, ma, mma, twoYears, moteur, diagnostic };
}

async function assignYears(
  catalog: Awaited<ReturnType<typeof getMemorySchoolCatalogStore>>,
  professionId: string,
  branchId: string,
  years: number[],
) {
  for (const year of years) {
    const created = await catalog.createContext({ professionId, trainingYear: year, branchId });
    assert.equal(created.ok, true, created.ok ? "" : created.reason);
  }
}

function checkedYears(matrix: ReturnType<typeof projectTrainingPlanMatrix>, branchId: string): boolean[] {
  const row = matrix.rows.find((entry) => entry.branch.id === branchId);
  assert.ok(row);
  return row.cells.map((cell) => cell.checked);
}

test("matrice 4 ans — Moteur Y1–Y4, Diagnostic Y3–Y4", async () => {
  const { catalog, ma, moteur, diagnostic } = await setupPlanWorld();
  await assignYears(catalog, ma.id, moteur.id, [1, 2, 3, 4]);
  await assignYears(catalog, ma.id, diagnostic.id, [3, 4]);
  const matrix = projectTrainingPlanMatrix({
    profession: ma,
    branches: await catalog.listBranches(),
    contexts: await catalog.listContexts(),
  });
  assert.deepEqual(matrix.years, [1, 2, 3, 4]);
  assert.deepEqual(checkedYears(matrix, moteur.id), [true, true, true, true]);
  assert.deepEqual(checkedYears(matrix, diagnostic.id), [false, false, true, true]);
});

test("profession 3 ans — aucune colonne année 4", async () => {
  const { catalog, mma, moteur } = await setupPlanWorld();
  await assignYears(catalog, mma.id, moteur.id, [1, 2, 3]);
  const matrix = projectTrainingPlanMatrix({
    profession: mma,
    branches: await catalog.listBranches(),
    contexts: await catalog.listContexts(),
  });
  assert.deepEqual(matrix.years, [1, 2, 3]);
  assert.deepEqual(trainingYearsForDuration(3), [1, 2, 3]);
  assert.equal(matrix.rows[0]?.cells.some((cell) => cell.trainingYear === 4), false);
});

test("profession 2 ans — colonnes 1re et 2e uniquement", async () => {
  const { catalog, twoYears, moteur } = await setupPlanWorld();
  const matrix = projectTrainingPlanMatrix({
    profession: twoYears,
    branches: await catalog.listBranches(),
    contexts: await catalog.listContexts(),
  });
  assert.deepEqual(matrix.years, [1, 2]);
  const moteurRow = matrix.rows.find((row) => row.branch.id === moteur.id);
  assert.ok(moteurRow);
  assert.deepEqual(moteurRow.cells.map((cell) => cell.checked), [false, false]);
});

test("cocher Diagnostic année 3 crée le CTX attendu", async () => {
  const { catalog, ma, diagnostic } = await setupPlanWorld();
  const created = await catalog.createContext({
    professionId: ma.id,
    trainingYear: 3,
    branchId: diagnostic.id,
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.equal(created.value.professionId, ma.id);
  assert.equal(created.value.trainingYear, 3);
  assert.equal(created.value.branchId, diagnostic.id);
  assert.equal(created.value.isArchived, false);
});

test("décocher un CTX inutilisé le retire de la matrice", async () => {
  const { catalog, ma, diagnostic } = await setupPlanWorld();
  const created = await catalog.createContext({
    professionId: ma.id,
    trainingYear: 3,
    branchId: diagnostic.id,
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const removed = await catalog.deleteContext(created.value.id);
  assert.equal(removed.ok, true);
  const matrix = projectTrainingPlanMatrix({
    profession: ma,
    branches: await catalog.listBranches(),
    contexts: await catalog.listContexts(),
  });
  assert.deepEqual(checkedYears(matrix, diagnostic.id), [false, false, false, false]);
});

test("décocher un CTX utilisé refuse la suppression destructive", async () => {
  const { catalog, ma, moteur } = await setupPlanWorld();
  const created = await catalog.createContext({
    professionId: ma.id,
    trainingYear: 3,
    branchId: moteur.id,
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const schoolClass = await catalog.createClass({
    code: "MAPL3U",
    label: "MA3A",
    schoolYearId: "year-2027",
    schoolYearLabel: "2027-2028",
    professionId: ma.id,
    trainingYear: 3,
    parallelCode: "U",
  });
  const teachers = getMemoryTeacherAccountStore();
  const teacher = await teachers.createAccount({
    displayName: "Enseignant plan",
    initials: "PlA",
    teachingType: "TECHNICAL",
  });
  assert.equal(teacher.ok, true);
  if (!teacher.ok) return;
  const courseDeps = {
    courses: getMemoryAnnualCourseStore(),
    catalog,
    years: yearsStub(),
    teachers,
    notes: getMemoryAnnualCourseNotesStore(),
  };
  const course = await createAnnualCourse(courseDeps, {
    schoolYearId: "year-2027",
    classId: schoolClass.id,
    contextId: created.value.id,
  });
  assert.equal(course.ok, true);
  const deleted = await catalog.deleteContext(created.value.id);
  assert.equal(deleted.ok, false);
  if (!deleted.ok) assert.equal(deleted.reason, CTX_IN_USE_DELETE_REASON);
  const still = (await catalog.listContexts()).find((entry) => entry.id === created.value.id);
  assert.ok(still);
  assert.equal(still.isArchived, false);
  const remaining = await getMemoryAnnualCourseStore().listCourses();
  assert.equal(remaining.some((entry) => entry.contextId === created.value.id), true);
});

test("filtre de classe — MA2A Moteur seul, MA3A Moteur + Diagnostic", async () => {
  const { catalog, ma, moteur, diagnostic } = await setupPlanWorld();
  await assignYears(catalog, ma.id, moteur.id, [1, 2, 3, 4]);
  await assignYears(catalog, ma.id, diagnostic.id, [3, 4]);
  const ma2a = await catalog.createClass({
    code: "MAPL2A",
    label: "MA2A",
    schoolYearId: "year-2027",
    schoolYearLabel: "2027-2028",
    professionId: ma.id,
    trainingYear: 2,
    parallelCode: "A",
  });
  const ma3a = await catalog.createClass({
    code: "MAPL3A",
    label: "MA3A",
    schoolYearId: "year-2027",
    schoolYearLabel: "2027-2028",
    professionId: ma.id,
    trainingYear: 3,
    parallelCode: "A",
  });
  const options = {
    branches: await catalog.listBranches(),
    contexts: await catalog.listContexts(),
  };
  const year2 = listPlannedBranchesForClass({ schoolClass: ma2a, ...options }).map((entry) => entry.id);
  const year3 = listPlannedBranchesForClass({ schoolClass: ma3a, ...options }).map((entry) => entry.id);
  assert.deepEqual(year2, [moteur.id]);
  assert.equal(year3.includes(moteur.id), true);
  assert.equal(year3.includes(diagnostic.id), true);
  assert.equal(year2.includes(diagnostic.id), false);
});

test("libellés court et complet", () => {
  assert.equal(
    formatPedagogicalContextLabel({
      branchLabel: "Moteur",
      trainingYear: 3,
      professionLabel: "Mécatronicien automobile",
      mode: "short",
    }),
    "Moteur · 3e année",
  );
  assert.equal(
    formatPedagogicalContextLabel({
      branchLabel: "Moteur",
      trainingYear: 3,
      professionLabel: "Mécatronicien automobile",
      mode: "full",
    }),
    "Moteur · Mécatronicien automobile · 3e année",
  );
});

test("deux professions — même branche, CTX distincts", async () => {
  const { catalog, ma, mma, moteur } = await setupPlanWorld();
  const ma3 = await catalog.createContext({ professionId: ma.id, trainingYear: 3, branchId: moteur.id });
  const mma2 = await catalog.createContext({ professionId: mma.id, trainingYear: 2, branchId: moteur.id });
  assert.equal(ma3.ok, true);
  assert.equal(mma2.ok, true);
  if (!ma3.ok || !mma2.ok) return;
  assert.notEqual(ma3.value.id, mma2.value.id);
  const duplicate = await catalog.createContext({
    professionId: ma.id,
    trainingYear: 3,
    branchId: moteur.id,
  });
  assert.equal(duplicate.ok, false);
  const usages = summarizeBranchUsages({
    branchId: moteur.id,
    professions: await catalog.listProfessions(),
    contexts: await catalog.listContexts(),
  });
  assert.equal(usages.length, 2);
  const maUsage = usages.find((entry) => entry.professionId === ma.id);
  const mmaUsage = usages.find((entry) => entry.professionId === mma.id);
  assert.deepEqual(maUsage?.years, [3]);
  assert.deepEqual(mmaUsage?.years, [2]);
});

test("parcours pédagogiques distincts par contextId", async () => {
  const { catalog, ma, moteur } = await setupPlanWorld();
  const year2 = await catalog.createContext({ professionId: ma.id, trainingYear: 2, branchId: moteur.id });
  const year3 = await catalog.createContext({ professionId: ma.id, trainingYear: 3, branchId: moteur.id });
  assert.equal(year2.ok && year3.ok, true);
  if (!year2.ok || !year3.ok) return;
  const paths = getMemoryPedagogicalPathStore();
  const path2 = await ensurePathForContext({
    contextId: year2.value.id,
    catalog,
    pathStore: paths,
  });
  const path3 = await ensurePathForContext({
    contextId: year3.value.id,
    catalog,
    pathStore: paths,
  });
  assert.equal(path2.ok && path3.ok, true);
  const mutated2 = await mutatePath({
    contextId: year2.value.id,
    catalog,
    pathStore: paths,
    action: { type: "addSession" },
  });
  assert.equal(mutated2.ok, true);
  const after2 = await paths.getPathByContextId(year2.value.id);
  const after3 = await paths.getPathByContextId(year3.value.id);
  assert.ok(after2);
  assert.ok(after3);
  assert.equal(after2.sessions.length, 1);
  assert.equal(after3.sessions.length, 0);
  assert.notEqual(after2.contextId, after3.contextId);
});

test("AnnualCourse MA3A : CTX Moteur année 3, pas année 2", async () => {
  const { catalog, ma, moteur } = await setupPlanWorld();
  const ctx2 = await catalog.createContext({ professionId: ma.id, trainingYear: 2, branchId: moteur.id });
  const ctx3 = await catalog.createContext({ professionId: ma.id, trainingYear: 3, branchId: moteur.id });
  assert.equal(ctx2.ok && ctx3.ok, true);
  if (!ctx2.ok || !ctx3.ok) return;
  const schoolClass = await catalog.createClass({
    code: "MAPL3C",
    label: "MA3A",
    schoolYearId: "year-2027",
    schoolYearLabel: "2027-2028",
    professionId: ma.id,
    trainingYear: 3,
    parallelCode: "C",
  });
  const planned = listPlannedBranchesForClass({
    schoolClass,
    branches: await catalog.listBranches(),
    contexts: await catalog.listContexts(),
  });
  assert.equal(planned.some((entry) => entry.id === moteur.id), true);
  const classContexts = (await catalog.listContexts()).filter(
    (entry) =>
      entry.professionId === schoolClass.professionId &&
      entry.trainingYear === schoolClass.trainingYear &&
      entry.isActive &&
      !entry.isArchived,
  );
  assert.equal(classContexts.some((entry) => entry.id === ctx3.value.id), true);
  assert.equal(classContexts.some((entry) => entry.id === ctx2.value.id), false);

  const teachers = getMemoryTeacherAccountStore();
  await teachers.createAccount({
    displayName: "Titulaire MA3",
    initials: "T3A",
    teachingType: "TECHNICAL",
  });
  const courseDeps = {
    courses: getMemoryAnnualCourseStore(),
    catalog,
    years: yearsStub(),
    teachers,
    notes: getMemoryAnnualCourseNotesStore(),
  };
  const allowed = await createAnnualCourse(courseDeps, {
    schoolYearId: "year-2027",
    classId: schoolClass.id,
    contextId: ctx3.value.id,
  });
  assert.equal(allowed.ok, true);
  const rejected = await createAnnualCourse(courseDeps, {
    schoolYearId: "year-2027",
    classId: schoolClass.id,
    contextId: ctx2.value.id,
  });
  assert.equal(rejected.ok, false);
});

test("CTX archivé n’est plus une case cochée", async () => {
  const { catalog, ma, moteur } = await setupPlanWorld();
  const created = await catalog.createContext({
    professionId: ma.id,
    trainingYear: 1,
    branchId: moteur.id,
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  await catalog.updateContext(created.value.id, { isArchived: true });
  const matrix = projectTrainingPlanMatrix({
    profession: ma,
    branches: await catalog.listBranches(),
    contexts: await catalog.listContexts(),
  });
  assert.equal(checkedYears(matrix, moteur.id)[0], false);
});

test("CTX archivé : recréation refusée, restauration du même identifiant", async () => {
  const { catalog, ma, moteur } = await setupPlanWorld();
  const created = await catalog.createContext({
    professionId: ma.id,
    trainingYear: 1,
    branchId: moteur.id,
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  await catalog.updateContext(created.value.id, { isArchived: true });
  const duplicate = await catalog.createContext({
    professionId: ma.id,
    trainingYear: 1,
    branchId: moteur.id,
  });
  assert.equal(duplicate.ok, false);
  const restored = await catalog.updateContext(created.value.id, {
    isArchived: false,
    isActive: true,
  });
  assert.equal(restored.ok, true);
  if (!restored.ok) return;
  assert.equal(restored.value.id, created.value.id);
  assert.equal(restored.value.isArchived, false);
  const matrix = projectTrainingPlanMatrix({
    profession: ma,
    branches: await catalog.listBranches(),
    contexts: await catalog.listContexts(),
  });
  assert.equal(checkedYears(matrix, moteur.id)[0], true);
});
