import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assignTeacherToCourse,
  createAnnualCourse,
  evaluateTeachingTypeGuard,
  listAssignmentCandidateTeachers,
  NO_COMPATIBLE_TEACHER_MESSAGE,
  preferredTeachersForBranch,
  type AnnualCourseServiceDeps,
} from "../src/features/annual-courses/index.ts";
import { APP_VERSION } from "../src/lib/app-version.ts";
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
  getMemoryTeacherAccountStore,
  resetMemoryTeacherAccountStore,
} from "../src/lib/persistence/memory-teacher-account-store.ts";
import { SQL_MIGRATION_FILES } from "../src/lib/persistence/sql/migrate.ts";
import type { SchoolYearStore } from "../src/lib/persistence/school-year-types.ts";
import type { TeachingType } from "../src/features/teaching-types/index.ts";

interface CandidateTeacher {
  id: string;
  displayName: string;
  isActive: boolean;
  isArchived: boolean;
  teachingType: TeachingType | null;
}

function teacher(
  id: string,
  displayName: string,
  teachingType: TeachingType | null,
  patch: Partial<CandidateTeacher> = {},
): CandidateTeacher {
  return {
    id,
    displayName,
    isActive: true,
    isArchived: false,
    teachingType,
    ...patch,
  };
}

const TECHNICAL = teacher("t-tech", "François Technique", "TECHNICAL");
const GENERAL = teacher("t-gen", "Sophie Générale", "GENERAL");
const ARCHIVED = teacher("t-arch", "Archivé Technique", "TECHNICAL", { isArchived: true });
const INACTIVE = teacher("t-off", "Inactif Technique", "TECHNICAL", { isActive: false });
const UNTYPED = teacher("t-none", "Sans type", null);
const ALL = [TECHNICAL, GENERAL, ARCHIVED, INACTIVE, UNTYPED];

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

test("version 2.40.0 — attributions : enseignants compatibles uniquement, pas de migration", async () => {
  assert.equal(APP_VERSION, "2.40.0");
  assert.equal(SQL_MIGRATION_FILES.at(-1), "0024_structured_agenda_bridge.sql");
  const [panel, helper] = await Promise.all([
    readFile(new URL("../web/app/components/annual-courses-admin-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/annual-courses/assignments.ts", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(panel, /Afficher les enseignants non correspondants/);
  assert.doesNotMatch(panel, /includeMismatched/);
  assert.match(panel, /listAssignmentCandidateTeachers/);
  assert.match(panel, /NO_COMPATIBLE_TEACHER_MESSAGE/);
  assert.match(helper, /evaluateTeachingTypeGuard/);
  assert.match(helper, /forceIncompatible/);
  assert.doesNotMatch(helper, /includeMismatched/);
  assert.equal(NO_COMPATIBLE_TEACHER_MESSAGE, "Aucun enseignant compatible");
});

test("1 — la case Afficher les enseignants non correspondants n’existe plus", async () => {
  const panel = await readFile(
    new URL("../web/app/components/annual-courses-admin-panel.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(panel, /enseignants non correspondants/);
});

test("2 — aucun état includeMismatched dans le composant", async () => {
  const panel = await readFile(
    new URL("../web/app/components/annual-courses-admin-panel.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(panel, /includeMismatched/);
  assert.doesNotMatch(panel, /setIncludeMismatched/);
});

test("3 — branche Technique → uniquement enseignants Technique", () => {
  const ids = listAssignmentCandidateTeachers(ALL, "TECHNICAL").map((entry) => entry.id);
  assert.deepEqual(ids, [TECHNICAL.id]);
  assert.equal(preferredTeachersForBranch(ALL, "TECHNICAL").some((entry) => entry.id === GENERAL.id), false);
});

test("4 — branche Générale → uniquement enseignants Branche générale", () => {
  const ids = listAssignmentCandidateTeachers(ALL, "GENERAL").map((entry) => entry.id);
  assert.deepEqual(ids, [GENERAL.id]);
});

test("5 — enseignant archivé → absent", () => {
  assert.equal(
    listAssignmentCandidateTeachers(ALL, "TECHNICAL").some((entry) => entry.id === ARCHIVED.id),
    false,
  );
});

test("6 — enseignant désactivé → absent", () => {
  assert.equal(
    listAssignmentCandidateTeachers(ALL, "TECHNICAL").some((entry) => entry.id === INACTIVE.id),
    false,
  );
});

test("7 — enseignant sans type → absent", () => {
  assert.equal(
    listAssignmentCandidateTeachers(ALL, "TECHNICAL").some((entry) => entry.id === UNTYPED.id),
    false,
  );
  assert.deepEqual(listAssignmentCandidateTeachers(ALL, null), []);
});

test("8 — aucun enseignant compatible → message clair", () => {
  const none = listAssignmentCandidateTeachers([GENERAL, ARCHIVED, INACTIVE, UNTYPED], "TECHNICAL");
  assert.deepEqual(none, []);
  assert.equal(NO_COMPATIBLE_TEACHER_MESSAGE, "Aucun enseignant compatible");
});

test("9 — attribution d’un enseignant compatible fonctionne toujours", async () => {
  resetMemorySchoolCatalogStore();
  resetMemoryAnnualCourseStore();
  resetMemoryPedagogicalPathStore();
  resetMemoryTeacherAccountStore();
  const catalog = getMemorySchoolCatalogStore();
  await catalog.ensureSeeded();
  const profession = await catalog.createProfession({ label: "Mécatronicien", durationYears: 4 });
  const moteur = (await catalog.listBranches()).find((entry) => entry.label === "Moteur")!;
  await catalog.updateBranch(moteur.id, { teachingType: "TECHNICAL" });
  const ctx = await catalog.createContext({
    professionId: profession.id,
    trainingYear: 1,
    branchId: moteur.id,
  });
  assert.equal(ctx.ok, true);
  if (!ctx.ok) return;
  const schoolClass = await catalog.createClass({
    code: "MMA1C",
    label: "MMA 1C",
    schoolYearId: "year-2027",
    schoolYearLabel: "2027-2028",
    professionId: profession.id,
    trainingYear: 1,
    parallelCode: "C",
  });
  const teachers = getMemoryTeacherAccountStore();
  const created = await teachers.createAccount({
    displayName: "François Compatible",
    initials: "FcC",
    teachingType: "TECHNICAL",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const accounts = await teachers.listAccounts();
  assert.ok(listAssignmentCandidateTeachers(accounts, "TECHNICAL").some((entry) => entry.id === created.account.id));
  const deps: AnnualCourseServiceDeps = {
    courses: new MemoryAnnualCourseStore(),
    catalog,
    years: yearsStub(),
    teachers,
    notes: getMemoryAnnualCourseNotesStore(),
  };
  const course = await createAnnualCourse(deps, {
    schoolYearId: "year-2027",
    classId: schoolClass.id,
    contextId: ctx.value.id,
  });
  assert.equal(course.ok, true);
  if (!course.ok) return;
  const assigned = await assignTeacherToCourse(deps, {
    annualCourseId: course.value.id,
    teacherId: created.account.id,
    role: "PRIMARY",
    createdByAdminId: "admin-1",
  });
  assert.equal(assigned.ok, true);
});

test("10 — logique métier de forçage existante non cassée", () => {
  const compatible = evaluateTeachingTypeGuard({
    branchType: "TECHNICAL",
    teacherType: "TECHNICAL",
  });
  assert.equal(compatible.ok, true);
  const mismatch = evaluateTeachingTypeGuard({
    branchType: "TECHNICAL",
    teacherType: "GENERAL",
  });
  assert.equal(mismatch.ok, false);
  const forced = evaluateTeachingTypeGuard({
    branchType: "TECHNICAL",
    teacherType: "GENERAL",
    forceIncompatible: true,
  });
  assert.equal(forced.ok, true);
  if (forced.ok) assert.ok(forced.value.warning);
});
