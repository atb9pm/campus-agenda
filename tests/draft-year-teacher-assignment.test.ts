import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assignTeacherToCourse,
  createAnnualCourse,
  schoolYearAllowsTeacherAssignment,
} from "../src/features/annual-courses/index.ts";
import type { AnnualCourseServiceDeps } from "../src/features/annual-courses/service.ts";
import { ARCHIVED_YEAR_MUTATION_REASON } from "../src/features/school-catalog/school-year-attachment.ts";
import type { AnnualCourse } from "../src/features/annual-courses/types.ts";
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
import type { SchoolYearWithWeeks } from "../src/features/school-year/types.ts";

const ACTIVE_ID = "year-2026-active";
const DRAFT_ID = "year-2027-draft";
const ARCHIVED_ID = "year-2025-archived";

function yearRecord(id: string, label: string, status: SchoolYearWithWeeks["status"]): SchoolYearWithWeeks {
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

async function world() {
  resetMemorySchoolCatalogStore();
  resetMemoryAnnualCourseStore();
  resetMemoryPedagogicalPathStore();
  resetMemoryTeacherAccountStore();
  resetMemorySchoolYearStore();
  replaceMemorySchoolYears([
    yearRecord(ACTIVE_ID, "2026-2027", "active"),
    yearRecord(DRAFT_ID, "2027-2028", "draft"),
    yearRecord(ARCHIVED_ID, "2025-2026", "archived"),
  ]);

  const catalog = getMemorySchoolCatalogStore();
  await catalog.ensureSeeded();
  const years = new MemorySchoolYearStore();
  await catalog.applySchoolYearBackfill(await years.listSchoolYears());
  const profession = await catalog.createProfession({
    label: "Mécatronicien d’automobiles",
    durationYears: 4,
    classCodePrefix: "MECAUTO",
  });
  const branches = await catalog.listBranches();
  const branch = branches.find((entry) => entry.label === "Moteur") ?? branches[0]!;
  await catalog.updateBranch(branch.id, { teachingType: "TECHNICAL" });
  const context = await catalog.createContext({
    professionId: profession.id,
    trainingYear: 3,
    branchId: branch.id,
  });
  assert.equal(context.ok, true);
  if (!context.ok) throw new Error(context.reason);

  const activeClass = await catalog.createClass({
    code: "MECAUTO3A",
    label: "MECAUTO3A",
    schoolYearId: ACTIVE_ID,
    schoolYearLabel: "2026-2027",
    professionId: profession.id,
    trainingYear: 3,
  });
  const draftClass = await catalog.createClass({
    code: "MECAUTO3A",
    label: "MECAUTO3A",
    schoolYearId: DRAFT_ID,
    schoolYearLabel: "2027-2028",
    professionId: profession.id,
    trainingYear: 3,
  });
  const deps: AnnualCourseServiceDeps = {
    courses: new MemoryAnnualCourseStore(),
    catalog,
    years,
    teachers: getMemoryTeacherAccountStore(),
    notes: getMemoryAnnualCourseNotesStore(),
  };
  const teacherA = await deps.teachers.createAccount({
    displayName: "Enseignant N",
    initials: "ENA",
    teachingType: "TECHNICAL",
  });
  const teacherB = await deps.teachers.createAccount({
    displayName: "Enseignant N+1",
    initials: "ENB",
    teachingType: "TECHNICAL",
  });
  assert.equal(teacherA.ok, true);
  assert.equal(teacherB.ok, true);
  if (!teacherA.ok || !teacherB.ok) throw new Error("comptes enseignants");
  return {
    deps,
    years,
    contextId: context.value.id,
    activeClass,
    draftClass,
    teacherA: teacherA.account.id,
    teacherB: teacherB.account.id,
  };
}

async function openCourse(deps: AnnualCourseServiceDeps, schoolYearId: string, classId: string, contextId: string) {
  const created = await createAnnualCourse(deps, { schoolYearId, classId, contextId });
  assert.equal(created.ok, true, JSON.stringify(created));
  if (!created.ok) throw new Error(created.reason);
  return created.value;
}

test("année ACTIVE, DRAFT ou ARCHIVED : seule l’archive interdit l’attribution", () => {
  assert.equal(schoolYearAllowsTeacherAssignment("active"), true);
  assert.equal(schoolYearAllowsTeacherAssignment("draft"), true);
  assert.equal(schoolYearAllowsTeacherAssignment("archived"), false);
  assert.equal(schoolYearAllowsTeacherAssignment(null), false);
  assert.equal(schoolYearAllowsTeacherAssignment(undefined), false);
});

test("ACTIVE et DRAFT autorisent l’attribution ; ARCHIVED la refuse", async () => {
  const campus = await world();
  const activeCourse = await openCourse(
    campus.deps,
    ACTIVE_ID,
    campus.activeClass.id,
    campus.contextId,
  );
  const activeAssigned = await assignTeacherToCourse(campus.deps, {
    annualCourseId: activeCourse.id,
    teacherId: campus.teacherA,
    role: "PRIMARY",
    validFrom: "2026-08-17",
    createdByAdminId: "admin-1",
  });
  assert.equal(activeAssigned.ok, true, JSON.stringify(activeAssigned));

  const draftCourse = await openCourse(
    campus.deps,
    DRAFT_ID,
    campus.draftClass.id,
    campus.contextId,
  );
  assert.equal((await campus.deps.courses.listAssignments(draftCourse.id)).length, 0);
  const draftAssigned = await assignTeacherToCourse(campus.deps, {
    annualCourseId: draftCourse.id,
    teacherId: campus.teacherB,
    role: "PRIMARY",
    validFrom: "2027-08-23",
    createdByAdminId: "admin-1",
  });
  assert.equal(draftAssigned.ok, true, JSON.stringify(draftAssigned));
  if (draftAssigned.ok) assert.equal(draftAssigned.value.teacherId, campus.teacherB);

  const archived = await campus.deps.courses.createCourse({
    id: "ac-archived",
    schoolYearId: ARCHIVED_ID,
    classId: campus.activeClass.id,
    contextId: campus.contextId,
    isArchived: false,
    archivedAt: null,
    createdAt: "2025-08-01T00:00:00.000Z",
    updatedAt: "2025-08-01T00:00:00.000Z",
  });
  const refused = await assignTeacherToCourse(campus.deps, {
    annualCourseId: archived.id,
    teacherId: campus.teacherB,
    role: "PRIMARY",
    validFrom: "2025-08-18",
    createdByAdminId: "admin-1",
  });
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.equal(refused.reason, ARCHIVED_YEAR_MUTATION_REASON);
});

test("cours N+1 sans enseignant : l’admin attribue manuellement, l’année N reste intacte", async () => {
  const campus = await world();
  const activeCourse = await openCourse(
    campus.deps,
    ACTIVE_ID,
    campus.activeClass.id,
    campus.contextId,
  );
  const sourceAssignment = await assignTeacherToCourse(campus.deps, {
    annualCourseId: activeCourse.id,
    teacherId: campus.teacherA,
    role: "PRIMARY",
    validFrom: "2026-08-17",
    createdByAdminId: "admin-1",
  });
  assert.equal(sourceAssignment.ok, true, JSON.stringify(sourceAssignment));
  const beforeCourse = await campus.deps.courses.getCourse(activeCourse.id);
  const beforeAssignments = await campus.deps.courses.listAssignments(activeCourse.id);

  const prepared = await openCourse(
    campus.deps,
    DRAFT_ID,
    campus.draftClass.id,
    campus.contextId,
  );
  assert.deepEqual(await campus.deps.courses.listAssignments(prepared.id), []);
  assert.equal(
    (await campus.deps.courses.listAssignments()).some((entry) => entry.annualCourseId === prepared.id),
    false,
  );

  const manual = await assignTeacherToCourse(campus.deps, {
    annualCourseId: prepared.id,
    teacherId: campus.teacherB,
    role: "PRIMARY",
    validFrom: "2027-08-23",
    createdByAdminId: "admin-1",
  });
  assert.equal(manual.ok, true, JSON.stringify(manual));
  const co = await assignTeacherToCourse(campus.deps, {
    annualCourseId: prepared.id,
    teacherId: campus.teacherA,
    role: "CO_TEACHER",
    validFrom: "2027-08-23",
    createdByAdminId: "admin-1",
  });
  assert.equal(co.ok, true, JSON.stringify(co));

  const draftAssignments = await campus.deps.courses.listAssignments(prepared.id);
  assert.deepEqual(
    draftAssignments.map((entry) => `${entry.teacherId}|${entry.role}`).sort(),
    [`${campus.teacherA}|CO_TEACHER`, `${campus.teacherB}|PRIMARY`].sort(),
  );
  assert.deepEqual(await campus.deps.courses.getCourse(activeCourse.id), beforeCourse);
  assert.deepEqual(await campus.deps.courses.listAssignments(activeCourse.id), beforeAssignments);
  assert.equal((await campus.years.listSchoolYears()).find((year) => year.id === ACTIVE_ID)?.status, "active");
  assert.equal((await campus.years.listSchoolYears()).find((year) => year.id === DRAFT_ID)?.status, "draft");
  const sourceStill = (await campus.deps.courses.listAssignments(activeCourse.id))[0];
  assert.equal(sourceStill?.teacherId, campus.teacherA);
  assert.equal(sourceStill?.role, "PRIMARY");
});

test("écran Attributions : DRAFT affiche le choix d’enseignant, sans préremplissage", async () => {
  const panel = await readFile(new URL("../web/app/components/annual-courses-admin-panel.tsx", import.meta.url), "utf8");
  assert.match(panel, /schoolYearAllowsTeacherAssignment\(workingYear\?\.status\)/);
  assert.doesNotMatch(panel, /canAssignTeachers = workingYear\?\.status === "active"/);
  assert.match(panel, /Attributions des cours/);
  assert.match(panel, /Choisir…/);
  assert.match(panel, /yearReadOnly = workingYear\?\.status === "archived"/);
  assert.match(panel, /Lecture seule/);
  const teacherChoice = panel.indexOf("defaultValue=\"\"");
  const teacherSelect = panel.slice(teacherChoice - 80, panel.indexOf("Choisir…") + "Choisir…".length);
  assert.match(teacherSelect, /<select[\s\S]*defaultValue=""/);
  assert.doesNotMatch(teacherSelect, /value=\{/);
  assert.match(panel, /Déjà rattaché à cette année/);
});

test("un cours préparé ne reçoit pas l’enseignant de N tant que l’admin ne le choisit pas", async () => {
  const campus = await world();
  const activeCourse = await openCourse(campus.deps, ACTIVE_ID, campus.activeClass.id, campus.contextId);
  await assignTeacherToCourse(campus.deps, {
    annualCourseId: activeCourse.id,
    teacherId: campus.teacherA,
    role: "PRIMARY",
    validFrom: "2026-08-17",
    createdByAdminId: "admin-1",
  });
  const prepared: AnnualCourse = await openCourse(
    campus.deps,
    DRAFT_ID,
    campus.draftClass.id,
    campus.contextId,
  );
  const teachers = (await campus.deps.courses.listAssignments(prepared.id)).map((entry) => entry.teacherId);
  assert.deepEqual(teachers, []);
  assert.equal(teachers.includes(campus.teacherA), false);
});
