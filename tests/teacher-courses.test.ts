import assert from "node:assert/strict";
import test from "node:test";

import { APP_VERSION } from "../src/lib/app-version.ts";
import {
  archiveAnnualCourse,
  assignTeacherToCourse,
  assignTemporaryReplacement,
  createAnnualCourse,
  endTeacherAssignment,
  type AnnualCourseServiceDeps,
} from "../src/features/annual-courses/index.ts";
import {
  buildTeacherCourseWorkspace,
  displaySetupsFromAssignedCourses,
  groupTeacherCoursesByClass,
  listTeacherCourses,
  matchSetupPreference,
  schoolYearIdFromSearchParams,
  sessionTeacherIdForCoursesApi,
  TEACHER_COURSES_EMPTY_MESSAGE,
  WORKSPACE_ASSIGNMENT_ROLE_LABELS,
  type TeacherCourseWorkspaceEntry,
} from "../src/features/teacher-workspace/index.ts";
import { TEACHER_NAV_SECTIONS, DEFAULT_TEACHER_NAV_SECTION } from "../src/features/teacher/index.ts";
import type { TeacherSetupConfig } from "../src/features/teacher-setup/index.ts";
import {
  MemoryAnnualCourseStore,
  resetMemoryAnnualCourseStore,
} from "../src/lib/persistence/memory-annual-course-store.ts";
import { getMemoryAnnualCourseNotesStore, resetMemoryPedagogicalPathStore } from "../src/lib/persistence/memory-pedagogical-path-store.ts";
import {
  getMemorySchoolCatalogStore,
  resetMemorySchoolCatalogStore,
} from "../src/lib/persistence/memory-school-catalog-store.ts";
import {
  getMemoryTeacherAccountStore,
  resetMemoryTeacherAccountStore,
} from "../src/lib/persistence/memory-teacher-account-store.ts";
import { createNodeSqliteDatabase } from "../src/lib/persistence/sql/adapters.ts";
import { applyMigrations } from "../src/lib/persistence/sql/migrate.ts";
import { SqlAnnualCourseStore } from "../src/lib/persistence/sql/sql-annual-course-store.ts";
import { SqlAnnualCourseNotesStore } from "../src/lib/persistence/sql/sql-pedagogical-path-store.ts";
import { SqlSchoolCatalogStore } from "../src/lib/persistence/sql/sql-school-catalog-store.ts";
import { SqlTeacherAccountStore } from "../src/lib/persistence/sql/sql-teacher-account-store.ts";
import type { SchoolYearRecord } from "../src/features/school-year/types.ts";
import type { SchoolYearStore } from "../src/lib/persistence/school-year-types.ts";

const TODAY = "2027-10-15T12:00:00.000Z";

function yearRecord(
  id: string,
  label: string,
  status: SchoolYearRecord["status"],
): SchoolYearRecord {
  return {
    id,
    label,
    status,
    startsOn: `${label.slice(0, 4)}-08-01`,
    endsOn: `${label.slice(5)}-07-31`,
    sourceFilename: null,
    importedAt: null,
    activatedAt: status === "active" ? "2027-08-01T00:00:00.000Z" : null,
    createdAt: "2027-01-01T00:00:00.000Z",
  };
}

function yearsStore(
  years: SchoolYearRecord[] = [
    yearRecord("year-2027", "2027-2028", "active"),
    yearRecord("year-2026", "2026-2027", "archived"),
  ],
): SchoolYearStore {
  return {
    listSchoolYears: async () => years,
    getActiveSchoolYear: async () => {
      const active = years.find((entry) => entry.status === "active");
      return active ? { ...active, weeks: [] } : null;
    },
  } as SchoolYearStore;
}

async function fixture() {
  resetMemorySchoolCatalogStore();
  resetMemoryAnnualCourseStore();
  resetMemoryPedagogicalPathStore();
  resetMemoryTeacherAccountStore();
  const catalog = getMemorySchoolCatalogStore();
  await catalog.ensureSeeded();
  const profession = await catalog.createProfession({
    label: "Mécanicien en maintenance d’automobiles",
    durationYears: 4,
    classCodePrefix: "MECMA",
  });
  const heavy = await catalog.createProfession({
    label: "Conducteur de véhicules lourds",
    durationYears: 3,
    classCodePrefix: "CONDVL",
  });
  const branches = await catalog.listBranches();
  const moteur = branches.find((entry) => entry.label === "Moteur") ?? branches[0]!;
  const elec = branches.find((entry) => /électri/i.test(entry.label)) ?? branches[1] ?? moteur;
  const chassis = branches.find((entry) => /ch[aâ]ssis/i.test(entry.label)) ?? branches[2] ?? moteur;
  await catalog.updateBranch(moteur.id, { teachingType: "TECHNICAL" });
  if (elec.id !== moteur.id) await catalog.updateBranch(elec.id, { teachingType: "TECHNICAL" });
  if (chassis.id !== moteur.id) await catalog.updateBranch(chassis.id, { teachingType: "TECHNICAL" });

  const ctxMoteur = await catalog.createContext({
    professionId: profession.id,
    trainingYear: 1,
    branchId: moteur.id,
  });
  const ctxElec = await catalog.createContext({
    professionId: profession.id,
    trainingYear: 1,
    branchId: elec.id,
  });
  const ctxChassis = await catalog.createContext({
    professionId: heavy.id,
    trainingYear: 1,
    branchId: chassis.id,
  });
  assert.equal(ctxMoteur.ok && ctxElec.ok && ctxChassis.ok, true);
  if (!ctxMoteur.ok || !ctxElec.ok || !ctxChassis.ok) throw new Error("CTX");

  const classA = await catalog.createClass({
    code: "MECMA1A",
    label: "MECMA 1A",
    sortOrder: 2,
    schoolYearId: "year-2027",
    schoolYearLabel: "2027-2028",
    professionId: profession.id,
    trainingYear: 1,
    parallelCode: "A",
  });
  const classB = await catalog.createClass({
    code: "CONDVL1",
    label: "CONDVL 1",
    sortOrder: 1,
    schoolYearId: "year-2027",
    schoolYearLabel: "2027-2028",
    professionId: heavy.id,
    trainingYear: 1,
    parallelCode: null,
  });
  const classLegacyYear = await catalog.createClass({
    code: "MECMA1A",
    label: "MECMA 1A 2026",
    sortOrder: 9,
    schoolYearId: "year-2026",
    schoolYearLabel: "2026-2027",
    professionId: profession.id,
    trainingYear: 1,
    parallelCode: "A",
  });

  const teachers = getMemoryTeacherAccountStore();
  const alice = await teachers.createAccount({
    displayName: "Alice Titulaire",
    initials: "AlT",
    teachingType: "TECHNICAL",
  });
  const bob = await teachers.createAccount({
    displayName: "Bob Coenseignant",
    initials: "BoC",
    teachingType: "TECHNICAL",
  });
  const admin = await teachers.createAccount({
    displayName: "Admin Sans cours",
    initials: "AdM",
    teachingType: "TECHNICAL",
    isAdmin: true,
  });
  assert.ok(alice.ok && bob.ok && admin.ok);

  const deps: AnnualCourseServiceDeps = {
    courses: new MemoryAnnualCourseStore(),
    catalog,
    years: yearsStore(),
    teachers,
    notes: getMemoryAnnualCourseNotesStore(),
  };

  return {
    deps,
    catalog,
    profession,
    heavy,
    moteur,
    elec,
    chassis,
    ctxMoteur: ctxMoteur.value,
    ctxElec: ctxElec.value,
    ctxChassis: ctxChassis.value,
    classA,
    classB,
    classLegacyYear,
    alice: alice.ok ? alice.account : null!,
    bob: bob.ok ? bob.account : null!,
    admin: admin.ok ? admin.account : null!,
    teachers,
  };
}

async function listFor(
  fx: Awaited<ReturnType<typeof fixture>>,
  teacherId: string,
  extra: { schoolYearId?: string | null; at?: string } = {},
) {
  return listTeacherCourses(fx.deps, {
    teacherId,
    at: extra.at ?? TODAY,
    schoolYearId: extra.schoolYearId,
  });
}

test("version 2.24.0 — Mes cours depuis les attributions", () => {
  assert.equal(APP_VERSION, "2.24.0");
  assert.deepEqual([...TEACHER_NAV_SECTIONS], [
    "mes-cours",
    "ma-semaine",
    "configuration",
    "administration",
  ]);
  assert.equal(DEFAULT_TEACHER_NAV_SECTION, "mes-cours");
  assert.equal(WORKSPACE_ASSIGNMENT_ROLE_LABELS.PRIMARY, "Titulaire");
  assert.equal(WORKSPACE_ASSIGNMENT_ROLE_LABELS.CO_TEACHER, "Co-enseignant");
  assert.equal(WORKSPACE_ASSIGNMENT_ROLE_LABELS.REPLACEMENT, "Remplacement temporaire");
  assert.match(TEACHER_COURSES_EMPTY_MESSAGE, /Aucun cours ne vous est actuellement attribué/);
});

test("A — PRIMARY visible", async () => {
  const fx = await fixture();
  const course = await createAnnualCourse(fx.deps, {
    schoolYearId: "year-2027",
    classId: fx.classA.id,
    contextId: fx.ctxMoteur.id,
  });
  assert.equal(course.ok, true);
  if (!course.ok) return;
  const assigned = await assignTeacherToCourse(fx.deps, {
    annualCourseId: course.value.id,
    teacherId: fx.alice.id,
    role: "PRIMARY",
    createdByAdminId: "admin-1",
    validFrom: "2027-08-01",
  });
  assert.equal(assigned.ok, true);
  const result = await listFor(fx, fx.alice.id);
  assert.equal(result.schoolYearId, "year-2027");
  assert.equal(result.courses.length, 1);
  assert.equal(result.courses[0]?.role, "PRIMARY");
  assert.equal(result.courses[0]?.classCode, "MECMA1A");
  assert.equal(result.courses[0]?.branchLabel, fx.moteur.label);
});

test("B — CO_TEACHER visible", async () => {
  const fx = await fixture();
  const course = await createAnnualCourse(fx.deps, {
    schoolYearId: "year-2027",
    classId: fx.classA.id,
    contextId: fx.ctxElec.id,
  });
  assert.equal(course.ok, true);
  if (!course.ok) return;
  await assignTeacherToCourse(fx.deps, {
    annualCourseId: course.value.id,
    teacherId: fx.alice.id,
    role: "PRIMARY",
    createdByAdminId: "admin-1",
    validFrom: "2027-08-01",
  });
  const co = await assignTeacherToCourse(fx.deps, {
    annualCourseId: course.value.id,
    teacherId: fx.bob.id,
    role: "CO_TEACHER",
    createdByAdminId: "admin-1",
    validFrom: "2027-08-01",
  });
  assert.equal(co.ok, true);
  const result = await listFor(fx, fx.bob.id);
  assert.equal(result.courses.length, 1);
  assert.equal(result.courses[0]?.role, "CO_TEACHER");
});

test("C — REPLACEMENT valide aujourd’hui visible", async () => {
  const fx = await fixture();
  const course = await createAnnualCourse(fx.deps, {
    schoolYearId: "year-2027",
    classId: fx.classA.id,
    contextId: fx.ctxMoteur.id,
  });
  assert.equal(course.ok, true);
  if (!course.ok) return;
  await assignTeacherToCourse(fx.deps, {
    annualCourseId: course.value.id,
    teacherId: fx.alice.id,
    role: "PRIMARY",
    createdByAdminId: "admin-1",
    validFrom: "2027-08-01",
  });
  const replacement = await assignTemporaryReplacement(fx.deps, {
    annualCourseId: course.value.id,
    teacherId: fx.bob.id,
    createdByAdminId: "admin-1",
    validFrom: "2027-10-01",
    validTo: "2027-10-31",
  });
  assert.equal(replacement.ok, true);
  const result = await listFor(fx, fx.bob.id);
  assert.equal(result.courses.length, 1);
  assert.equal(result.courses[0]?.role, "REPLACEMENT");
});

test("D — remplacement terminé absent", async () => {
  const fx = await fixture();
  const course = await createAnnualCourse(fx.deps, {
    schoolYearId: "year-2027",
    classId: fx.classA.id,
    contextId: fx.ctxMoteur.id,
  });
  assert.equal(course.ok, true);
  if (!course.ok) return;
  await assignTeacherToCourse(fx.deps, {
    annualCourseId: course.value.id,
    teacherId: fx.alice.id,
    role: "PRIMARY",
    createdByAdminId: "admin-1",
    validFrom: "2027-08-01",
  });
  const replacement = await assignTemporaryReplacement(fx.deps, {
    annualCourseId: course.value.id,
    teacherId: fx.bob.id,
    createdByAdminId: "admin-1",
    validFrom: "2027-08-01",
    validTo: "2027-12-31",
  });
  assert.equal(replacement.ok, true);
  if (!replacement.ok) return;
  const ended = await endTeacherAssignment(fx.deps, replacement.value.id, "admin-1", "2027-10-01");
  assert.equal(ended.ok, true);
  const result = await listFor(fx, fx.bob.id);
  assert.equal(result.courses.length, 0);
});

test("E — attribution future absente aujourd’hui", async () => {
  const fx = await fixture();
  const course = await createAnnualCourse(fx.deps, {
    schoolYearId: "year-2027",
    classId: fx.classA.id,
    contextId: fx.ctxMoteur.id,
  });
  assert.equal(course.ok, true);
  if (!course.ok) return;
  await assignTeacherToCourse(fx.deps, {
    annualCourseId: course.value.id,
    teacherId: fx.alice.id,
    role: "PRIMARY",
    createdByAdminId: "admin-1",
    validFrom: "2028-01-01",
  });
  const result = await listFor(fx, fx.alice.id);
  assert.equal(result.courses.length, 0);
});

test("F — classe désactivée absente", async () => {
  const fx = await fixture();
  const course = await createAnnualCourse(fx.deps, {
    schoolYearId: "year-2027",
    classId: fx.classA.id,
    contextId: fx.ctxMoteur.id,
  });
  assert.equal(course.ok, true);
  if (!course.ok) return;
  await assignTeacherToCourse(fx.deps, {
    annualCourseId: course.value.id,
    teacherId: fx.alice.id,
    role: "PRIMARY",
    createdByAdminId: "admin-1",
    validFrom: "2027-08-01",
  });
  await fx.catalog.updateClass(fx.classA.id, { isActive: false });
  const result = await listFor(fx, fx.alice.id);
  assert.equal(result.courses.length, 0);
  const stillAssigned = await fx.deps.courses.listAssignmentsForTeacher(fx.alice.id);
  assert.equal(stillAssigned.length, 1);
});

test("G — classe archivée absente", async () => {
  const fx = await fixture();
  const course = await createAnnualCourse(fx.deps, {
    schoolYearId: "year-2027",
    classId: fx.classA.id,
    contextId: fx.ctxMoteur.id,
  });
  assert.equal(course.ok, true);
  if (!course.ok) return;
  await assignTeacherToCourse(fx.deps, {
    annualCourseId: course.value.id,
    teacherId: fx.alice.id,
    role: "PRIMARY",
    createdByAdminId: "admin-1",
    validFrom: "2027-08-01",
  });
  await fx.catalog.updateClass(fx.classA.id, { isArchived: true });
  const result = await listFor(fx, fx.alice.id);
  assert.equal(result.courses.length, 0);
});

test("H — AnnualCourse archivé absent", async () => {
  const fx = await fixture();
  const course = await createAnnualCourse(fx.deps, {
    schoolYearId: "year-2027",
    classId: fx.classA.id,
    contextId: fx.ctxMoteur.id,
  });
  assert.equal(course.ok, true);
  if (!course.ok) return;
  await assignTeacherToCourse(fx.deps, {
    annualCourseId: course.value.id,
    teacherId: fx.alice.id,
    role: "PRIMARY",
    createdByAdminId: "admin-1",
    validFrom: "2027-08-01",
  });
  await archiveAnnualCourse(fx.deps, course.value.id);
  const result = await listFor(fx, fx.alice.id);
  assert.equal(result.courses.length, 0);
});

test("I — année scolaire différente absente", async () => {
  const fx = await fixture();
  await fx.deps.courses.createCourse({
    id: "ac-2026-moteur",
    schoolYearId: "year-2026",
    classId: fx.classLegacyYear.id,
    contextId: fx.ctxMoteur.id,
    isArchived: false,
    archivedAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  });
  await fx.deps.courses.createAssignment({
    id: "tca-2026-alice",
    annualCourseId: "ac-2026-moteur",
    teacherId: fx.alice.id,
    role: "PRIMARY",
    validFrom: "2026-08-01T00:00:00.000Z",
    validTo: null,
    createdByAdminId: "admin-1",
    createdAt: "2026-08-01T00:00:00.000Z",
    endedAt: null,
    overrideReason: null,
    overrideByAdminId: null,
  });
  const operational = await listFor(fx, fx.alice.id);
  assert.equal(operational.courses.length, 0);
  const history = await listFor(fx, fx.alice.id, { schoolYearId: "year-2026" });
  assert.equal(history.courses.length, 1);
  assert.equal(history.schoolYearId, "year-2026");
});

test("J — enseignant sans attribution → liste vide", async () => {
  const fx = await fixture();
  const result = await listFor(fx, fx.alice.id);
  assert.deepEqual(result.courses, []);
});

test("K — TeacherSetupConfig ne crée pas de cours", async () => {
  const fx = await fixture();
  const setup: TeacherSetupConfig = {
    version: 1,
    classes: [
      {
        id: "legacy-invented",
        name: "CLASSE-INVENTÉE",
        programLabel: "Inventée",
        dayOfWeek: 1,
        branchNames: ["Moteur"],
        icon: "🔧",
      },
    ],
  };
  const built = buildTeacherCourseWorkspace({
    teacherId: fx.alice.id,
    at: TODAY,
    assignments: [],
    courses: [],
    classes: await fx.catalog.listClasses(),
    contexts: await fx.catalog.listContexts(),
    branches: await fx.catalog.listBranches(),
    years: await fx.deps.years.listSchoolYears(),
    professions: await fx.catalog.listProfessions(),
  });
  assert.equal(built.courses.length, 0);
  assert.equal(matchSetupPreference({
    annualCourseId: "none",
    assignmentId: "none",
    role: "PRIMARY",
    validFrom: TODAY,
    validTo: null,
    schoolYearId: "year-2027",
    schoolYearLabel: "2027-2028",
    classId: fx.classA.id,
    classCode: fx.classA.code,
    classLabel: fx.classA.label,
    classSortOrder: fx.classA.sortOrder,
    professionId: fx.classA.professionId,
    professionLabel: "x",
    trainingYear: 1,
    parallelCode: "A",
    contextId: fx.ctxMoteur.id,
    branchId: fx.moteur.id,
    branchCode: fx.moteur.code,
    branchLabel: fx.moteur.label,
    branchSortOrder: fx.moteur.sortOrder,
    teachingType: "TECHNICAL",
  }, setup), null);
});

test("L — même code de classe, année active sélectionnée", async () => {
  const fx = await fixture();
  const current = await createAnnualCourse(fx.deps, {
    schoolYearId: "year-2027",
    classId: fx.classA.id,
    contextId: fx.ctxMoteur.id,
  });
  assert.equal(current.ok, true);
  if (!current.ok) return;
  await assignTeacherToCourse(fx.deps, {
    annualCourseId: current.value.id,
    teacherId: fx.alice.id,
    role: "PRIMARY",
    createdByAdminId: "admin-1",
    validFrom: "2027-08-01",
  });
  await fx.deps.courses.createCourse({
    id: "ac-2026-moteur",
    schoolYearId: "year-2026",
    classId: fx.classLegacyYear.id,
    contextId: fx.ctxMoteur.id,
    isArchived: false,
    archivedAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  });
  await fx.deps.courses.createAssignment({
    id: "tca-2026-alice",
    annualCourseId: "ac-2026-moteur",
    teacherId: fx.alice.id,
    role: "PRIMARY",
    validFrom: "2026-08-01T00:00:00.000Z",
    validTo: null,
    createdByAdminId: "admin-1",
    createdAt: "2026-08-01T00:00:00.000Z",
    endedAt: null,
    overrideReason: null,
    overrideByAdminId: null,
  });
  const result = await listFor(fx, fx.alice.id);
  assert.equal(result.courses.length, 1);
  assert.equal(result.courses[0]?.schoolYearId, "year-2027");
  assert.equal(result.courses[0]?.classId, fx.classA.id);
});

test("M — admin sans attribution → aucun cours", async () => {
  const fx = await fixture();
  const course = await createAnnualCourse(fx.deps, {
    schoolYearId: "year-2027",
    classId: fx.classA.id,
    contextId: fx.ctxMoteur.id,
  });
  assert.equal(course.ok, true);
  if (!course.ok) return;
  await assignTeacherToCourse(fx.deps, {
    annualCourseId: course.value.id,
    teacherId: fx.alice.id,
    role: "PRIMARY",
    createdByAdminId: fx.admin.id,
    validFrom: "2027-08-01",
  });
  assert.equal(fx.admin.isAdmin, true);
  const result = await listFor(fx, fx.admin.id);
  assert.equal(result.courses.length, 0);
});

test("N — session enseignant A n’obtient pas les cours de B", async () => {
  const fx = await fixture();
  const courseA = await createAnnualCourse(fx.deps, {
    schoolYearId: "year-2027",
    classId: fx.classA.id,
    contextId: fx.ctxMoteur.id,
  });
  const courseB = await createAnnualCourse(fx.deps, {
    schoolYearId: "year-2027",
    classId: fx.classB.id,
    contextId: fx.ctxChassis.id,
  });
  assert.equal(courseA.ok && courseB.ok, true);
  if (!courseA.ok || !courseB.ok) return;
  await assignTeacherToCourse(fx.deps, {
    annualCourseId: courseA.value.id,
    teacherId: fx.alice.id,
    role: "PRIMARY",
    createdByAdminId: "admin-1",
    validFrom: "2027-08-01",
  });
  await assignTeacherToCourse(fx.deps, {
    annualCourseId: courseB.value.id,
    teacherId: fx.bob.id,
    role: "PRIMARY",
    createdByAdminId: "admin-1",
    validFrom: "2027-08-01",
  });

  const params = new URLSearchParams({ teacherId: fx.bob.id, schoolYearId: "year-2027" });
  const teacherId = sessionTeacherIdForCoursesApi(fx.alice.id);
  assert.equal(teacherId, fx.alice.id);
  assert.notEqual(teacherId, params.get("teacherId"));
  assert.equal(schoolYearIdFromSearchParams(params), "year-2027");

  const result = await listTeacherCourses(fx.deps, {
    teacherId,
    schoolYearId: schoolYearIdFromSearchParams(params),
    at: TODAY,
  });
  assert.equal(result.courses.length, 1);
  assert.equal(result.courses[0]?.classCode, "MECMA1A");
  assert.ok(result.courses.every((entry) => entry.assignmentId));
  const bobResult = await listFor(fx, fx.bob.id);
  assert.equal(bobResult.courses[0]?.classCode, "CONDVL1");
});

test("O — ordre classes/branches déterministe", async () => {
  const fx = await fixture();
  const condvl = await createAnnualCourse(fx.deps, {
    schoolYearId: "year-2027",
    classId: fx.classB.id,
    contextId: fx.ctxChassis.id,
  });
  const moteur = await createAnnualCourse(fx.deps, {
    schoolYearId: "year-2027",
    classId: fx.classA.id,
    contextId: fx.ctxMoteur.id,
  });
  const elec = await createAnnualCourse(fx.deps, {
    schoolYearId: "year-2027",
    classId: fx.classA.id,
    contextId: fx.ctxElec.id,
  });
  assert.equal(condvl.ok && moteur.ok && elec.ok, true);
  if (!condvl.ok || !moteur.ok || !elec.ok) return;
  await assignTeacherToCourse(fx.deps, {
    annualCourseId: elec.value.id,
    teacherId: fx.alice.id,
    role: "CO_TEACHER",
    createdByAdminId: "admin-1",
    validFrom: "2027-08-01",
  });
  await assignTeacherToCourse(fx.deps, {
    annualCourseId: condvl.value.id,
    teacherId: fx.alice.id,
    role: "PRIMARY",
    createdByAdminId: "admin-1",
    validFrom: "2027-08-01",
  });
  await assignTeacherToCourse(fx.deps, {
    annualCourseId: moteur.value.id,
    teacherId: fx.alice.id,
    role: "PRIMARY",
    createdByAdminId: "admin-1",
    validFrom: "2027-08-01",
  });

  const result = await listFor(fx, fx.alice.id);
  assert.deepEqual(
    result.courses.map((entry) => `${entry.classCode}:${entry.branchLabel}`),
    result.courses
      .slice()
      .sort((left, right) => {
        if (left.classSortOrder !== right.classSortOrder) return left.classSortOrder - right.classSortOrder;
        const byCode = left.classCode.localeCompare(right.classCode, "fr-CH", { numeric: true });
        if (byCode !== 0) return byCode;
        if (left.branchSortOrder !== right.branchSortOrder) return left.branchSortOrder - right.branchSortOrder;
        return left.branchLabel.localeCompare(right.branchLabel, "fr-CH");
      })
      .map((entry) => `${entry.classCode}:${entry.branchLabel}`),
  );
  assert.equal(result.courses[0]?.classCode, "CONDVL1");
  const groups = groupTeacherCoursesByClass(result.courses);
  assert.equal(groups[0]?.classCode, "CONDVL1");
  assert.equal(groups[1]?.classCode, "MECMA1A");
  assert.equal(groups[1]?.courses.length, 2);
});

function workspaceEntry(
  patch: Partial<TeacherCourseWorkspaceEntry> & {
    classId: string;
    classCode: string;
    annualCourseId: string;
    branchId: string;
    branchLabel: string;
  },
): TeacherCourseWorkspaceEntry {
  return {
    assignmentId: `${patch.annualCourseId}-as`,
    role: "PRIMARY",
    validFrom: TODAY,
    validTo: null,
    schoolYearId: "year-2027",
    schoolYearLabel: "2027-2028",
    classLabel: patch.classCode,
    classSortOrder: 1,
    professionId: null,
    professionLabel: "Mécanicien en maintenance d’automobiles",
    trainingYear: 1,
    parallelCode: "A",
    contextId: `ctx-${patch.branchId}`,
    branchCode: patch.branchId,
    branchSortOrder: 1,
    teachingType: "TECHNICAL",
    ...patch,
  };
}

test("display setups — une classe, deux branches attribuées", () => {
  const courses = [
    workspaceEntry({
      annualCourseId: "ac-moteur",
      classId: "class-mecma1a",
      classCode: "MECMA1A",
      branchId: "br-moteur",
      branchLabel: "Moteur",
      branchSortOrder: 1,
    }),
    workspaceEntry({
      annualCourseId: "ac-elec",
      classId: "class-mecma1a",
      classCode: "MECMA1A",
      branchId: "br-elec",
      branchLabel: "Électricité",
      branchSortOrder: 2,
    }),
  ];
  const groups = groupTeacherCoursesByClass(courses);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.courses.length, 2);
  assert.deepEqual(
    groups[0]?.courses.map((entry) => entry.annualCourseId),
    ["ac-moteur", "ac-elec"],
  );

  const setups = displaySetupsFromAssignedCourses(courses);
  assert.equal(setups.length, 1);
  assert.equal(setups[0]?.id, "class-mecma1a");
  assert.equal(setups[0]?.name, "MECMA1A");
  assert.deepEqual(setups[0]?.branchNames, ["Moteur", "Électricité"]);
});

test("display setups — legacy Transmission n’entre pas dans branchNames", () => {
  const courses = [
    workspaceEntry({
      annualCourseId: "ac-moteur",
      classId: "class-mecma1a",
      classCode: "MECMA1A",
      branchId: "br-moteur",
      branchLabel: "Moteur",
    }),
    workspaceEntry({
      annualCourseId: "ac-elec",
      classId: "class-mecma1a",
      classCode: "MECMA1A",
      branchId: "br-elec",
      branchLabel: "Électricité",
    }),
  ];
  const setup: TeacherSetupConfig = {
    version: 1,
    classes: [
      {
        id: "legacy-mecma",
        name: "MECMA1A",
        programLabel: "Ancien libellé",
        dayOfWeek: 4,
        branchNames: ["Transmission"],
        icon: "⭐",
      },
    ],
  };
  const setups = displaySetupsFromAssignedCourses(courses, setup);
  assert.equal(setups.length, 1);
  assert.deepEqual(setups[0]?.branchNames, ["Moteur", "Électricité"]);
  assert.equal(setups[0]?.branchNames.includes("Transmission"), false);
  assert.equal(setups[0]?.dayOfWeek, 4);
  assert.equal(setups[0]?.icon, "⭐");
  assert.equal(setups[0]?.programLabel, "Ancien libellé");
  assert.equal(setups[0]?.id, "class-mecma1a");
});

test("display setups — deux classes distinctes", () => {
  const courses = [
    workspaceEntry({
      annualCourseId: "ac-condvl",
      classId: "class-condvl1",
      classCode: "CONDVL1",
      classSortOrder: 1,
      branchId: "br-chassis",
      branchLabel: "Châssis",
      professionLabel: "Conducteur de véhicules lourds",
      parallelCode: null,
    }),
    workspaceEntry({
      annualCourseId: "ac-moteur",
      classId: "class-mecma1a",
      classCode: "MECMA1A",
      classSortOrder: 2,
      branchId: "br-moteur",
      branchLabel: "Moteur",
    }),
  ];
  const setups = displaySetupsFromAssignedCourses(courses);
  assert.equal(setups.length, 2);
  assert.equal(setups[0]?.id, "class-condvl1");
  assert.deepEqual(setups[0]?.branchNames, ["Châssis"]);
  assert.equal(setups[1]?.id, "class-mecma1a");
  assert.deepEqual(setups[1]?.branchNames, ["Moteur"]);
});

test("display setups — même branche via plusieurs attributions, pas de doublon", () => {
  const courses = [
    workspaceEntry({
      annualCourseId: "ac-moteur-1",
      assignmentId: "as-1",
      classId: "class-mecma1a",
      classCode: "MECMA1A",
      branchId: "br-moteur",
      branchLabel: "Moteur",
      role: "PRIMARY",
    }),
    workspaceEntry({
      annualCourseId: "ac-moteur-1",
      assignmentId: "as-2",
      classId: "class-mecma1a",
      classCode: "MECMA1A",
      branchId: "br-moteur",
      branchLabel: "Moteur",
      role: "CO_TEACHER",
    }),
  ];
  const setups = displaySetupsFromAssignedCourses(courses);
  assert.equal(setups.length, 1);
  assert.deepEqual(setups[0]?.branchNames, ["Moteur"]);
});

test("correspondance setup — pas le premier doublon", () => {
  const setup: TeacherSetupConfig = {
    version: 1,
    classes: [
      {
        id: "one",
        name: "MECMA1A",
        programLabel: "x",
        dayOfWeek: 1,
        branchNames: ["Moteur"],
        icon: "1",
      },
      {
        id: "two",
        name: "MECMA1A",
        programLabel: "x",
        dayOfWeek: 2,
        branchNames: ["Électricité"],
        icon: "2",
      },
    ],
  };
  const matched = matchSetupPreference(
    {
      annualCourseId: "ac",
      assignmentId: "as",
      role: "PRIMARY",
      validFrom: TODAY,
      validTo: null,
      schoolYearId: "year-2027",
      schoolYearLabel: "2027-2028",
      classId: "class-other",
      classCode: "MECMA1A",
      classLabel: "MECMA 1A",
      classSortOrder: 1,
      professionId: null,
      professionLabel: null,
      trainingYear: 1,
      parallelCode: "A",
      contextId: "ctx",
      branchId: "br",
      branchCode: "BR",
      branchLabel: "Châssis",
      branchSortOrder: 1,
      teachingType: "TECHNICAL",
    },
    setup,
  );
  assert.equal(matched, null);
});

test("Memory et SQLite — même résultat Mes cours", async () => {
  const memoryFx = await fixture();
  const memoryCourse = await createAnnualCourse(memoryFx.deps, {
    schoolYearId: "year-2027",
    classId: memoryFx.classA.id,
    contextId: memoryFx.ctxMoteur.id,
  });
  assert.equal(memoryCourse.ok, true);
  if (!memoryCourse.ok) return;
  await assignTeacherToCourse(memoryFx.deps, {
    annualCourseId: memoryCourse.value.id,
    teacherId: memoryFx.alice.id,
    role: "PRIMARY",
    createdByAdminId: "admin-1",
    validFrom: "2027-08-01",
  });
  const memoryResult = await listFor(memoryFx, memoryFx.alice.id);

  const db = createNodeSqliteDatabase(":memory:");
  await applyMigrations(db);
  const catalog = new SqlSchoolCatalogStore(db);
  await catalog.ensureSeeded();
  const profession = await catalog.createProfession({
    label: "Mécanicien en maintenance d’automobiles",
    durationYears: 4,
    classCodePrefix: "MECMA",
  });
  const branches = await catalog.listBranches();
  const moteur = branches.find((entry) => entry.label === "Moteur") ?? branches[0]!;
  await catalog.updateBranch(moteur.id, { teachingType: "TECHNICAL" });
  const ctx = await catalog.createContext({
    professionId: profession.id,
    trainingYear: 1,
    branchId: moteur.id,
  });
  assert.equal(ctx.ok, true);
  if (!ctx.ok) return;
  const schoolClass = await catalog.createClass({
    code: "MECMA1A",
    label: "MECMA 1A",
    sortOrder: 2,
    schoolYearId: "year-2027",
    schoolYearLabel: "2027-2028",
    professionId: profession.id,
    trainingYear: 1,
    parallelCode: "A",
  });
  const teachers = new SqlTeacherAccountStore(db);
  const alice = await teachers.createAccount({
    displayName: "Alice Titulaire",
    initials: "AlT",
    teachingType: "TECHNICAL",
  });
  assert.equal(alice.ok, true);
  if (!alice.ok) return;
  const deps: AnnualCourseServiceDeps = {
    courses: new SqlAnnualCourseStore(db),
    catalog,
    years: yearsStore(),
    teachers,
    notes: new SqlAnnualCourseNotesStore(db),
  };
  const sqlCourse = await createAnnualCourse(deps, {
    schoolYearId: "year-2027",
    classId: schoolClass.id,
    contextId: ctx.value.id,
  });
  assert.equal(sqlCourse.ok, true);
  if (!sqlCourse.ok) return;
  await assignTeacherToCourse(deps, {
    annualCourseId: sqlCourse.value.id,
    teacherId: alice.account.id,
    role: "PRIMARY",
    createdByAdminId: "admin-1",
    validFrom: "2027-08-01",
  });
  const sqlResult = await listTeacherCourses(deps, {
    teacherId: alice.account.id,
    at: TODAY,
  });
  assert.equal(sqlResult.courses.length, memoryResult.courses.length);
  assert.equal(sqlResult.courses[0]?.role, memoryResult.courses[0]?.role);
  assert.equal(sqlResult.courses[0]?.classCode, memoryResult.courses[0]?.classCode);
  assert.equal(sqlResult.courses[0]?.branchLabel, memoryResult.courses[0]?.branchLabel);
  db.close();
});
