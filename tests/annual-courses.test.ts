import assert from "node:assert/strict";
import test from "node:test";

import {
  ASSIGNMENT_ROLES,
  MEMBERSHIP_IS_LEGACY_FALLBACK,
  TEACHER_SETUP_IS_NOT_AUTHORIZATION,
  ANNUAL_COURSE_SCHEDULE_DELETE_REASON,
  ANNUAL_COURSE_USED_DELETE_REASON,
  annualCourseDeleteBlockers,
  archiveAnnualCourse,
  assignTeacherToCourse,
  assignTemporaryReplacement,
  createAnnualCourse,
  deleteAnnualCourse,
  endTeacherAssignment,
  ensureAnnualCourse,
  evaluateTeachingTypeGuard,
  isAssignmentActiveAt,
  replaceTeacherDefinitively,
  resolveAnnualCourseForPublication,
  studentMayAccessCourseNotes,
  teacherCanAccessAnnualCourse,
  teacherIsAssignable,
  type AnnualCourseServiceDeps,
} from "../src/features/annual-courses/index.ts";
import { replaceTeacherMemberships } from "../src/features/memberships/replacement.ts";
import { isMembershipActiveAt } from "../src/features/memberships/validity.ts";
import { createAnnualCourseNote } from "../src/features/pedagogical-path/index.ts";
import { TEACHING_TYPES, isTeachingType } from "../src/features/teaching-types/index.ts";
import { isTeacherSetupPayload } from "../src/features/teacher-setup/index.ts";
import {
  MemoryAnnualCourseStore,
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
import { createNodeSqliteDatabase } from "../src/lib/persistence/sql/adapters.ts";
import { applyMigrations, splitSqlStatements } from "../src/lib/persistence/sql/migrate.ts";
import { SqlAnnualCourseStore } from "../src/lib/persistence/sql/sql-annual-course-store.ts";
import { SqlAnnualCourseNotesStore, SqlPedagogicalPathStore } from "../src/lib/persistence/sql/sql-pedagogical-path-store.ts";
import { SqlSchoolCatalogStore } from "../src/lib/persistence/sql/sql-school-catalog-store.ts";
import { SqlTeacherAccountStore } from "../src/lib/persistence/sql/sql-teacher-account-store.ts";
import type { SchoolYearStore } from "../src/lib/persistence/school-year-types.ts";

function yearsStub(id = "year-2027", label = "2027-2028"): SchoolYearStore {
  return {
    listSchoolYears: async () => [
      {
        id,
        label,
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

async function fixture() {
  resetMemorySchoolCatalogStore();
  resetMemoryAnnualCourseStore();
  resetMemoryPedagogicalPathStore();
  resetMemoryTeacherAccountStore();
  const catalog = getMemorySchoolCatalogStore();
  await catalog.ensureSeeded();
  const profession = await catalog.createProfession({ label: "Mécatronicien", durationYears: 4 });
  const branches = await catalog.listBranches();
  const moteur = branches.find((entry) => entry.label === "Moteur") ?? branches[0]!;
  const francais = branches.find((entry) => /fran/i.test(entry.label)) ?? branches[1] ?? moteur;
  await catalog.updateBranch(moteur.id, { teachingType: "TECHNICAL" });
  if (francais.id !== moteur.id) {
    await catalog.updateBranch(francais.id, { teachingType: "GENERAL" });
  }
  const ctx = await catalog.createContext({
    professionId: profession.id,
    trainingYear: 1,
    branchId: moteur.id,
  });
  assert.equal(ctx.ok, true);
  if (!ctx.ok) throw new Error(ctx.reason);
  const schoolClass = await catalog.createClass({
    code: "MMA1B",
    label: "MMA 1B",
    schoolYearId: "year-2027",
    schoolYearLabel: "2027-2028",
    professionId: profession.id,
    trainingYear: 1,
    parallelCode: "B",
  });
  const teachers = getMemoryTeacherAccountStore();
  const francois = await teachers.createAccount({
    displayName: "François Titulaire",
    initials: "TiF",
    teachingType: "TECHNICAL",
  });
  const paul = await teachers.createAccount({
    displayName: "Paul Coenseignant",
    initials: "CoP",
    teachingType: "TECHNICAL",
  });
  const sophie = await teachers.createAccount({
    displayName: "Sophie Generale",
    initials: "GeS",
    teachingType: "GENERAL",
  });
  assert.ok(francois.ok && paul.ok && sophie.ok);
  const deps: AnnualCourseServiceDeps = {
    courses: new MemoryAnnualCourseStore(),
    catalog,
    years: yearsStub(),
    teachers,
    notes: getMemoryAnnualCourseNotesStore(),
  };
  return {
    deps,
    catalog,
    profession,
    moteur,
    francais,
    context: ctx.value,
    schoolClass,
    francois: francois.ok ? francois.account : null!,
    paul: paul.ok ? paul.account : null!,
    sophie: sophie.ok ? sophie.account : null!,
    teachers,
  };
}

test("types — uniquement TECHNICAL et GENERAL, legacy null", () => {
  assert.deepEqual([...TEACHING_TYPES], ["TECHNICAL", "GENERAL"]);
  assert.equal(isTeachingType("TECHNICAL"), true);
  assert.equal(isTeachingType("GENERAL"), true);
  assert.equal(isTeachingType("BOTH"), false);
  assert.equal(isTeachingType(null), false);
  assert.deepEqual([...ASSIGNMENT_ROLES], ["PRIMARY", "CO_TEACHER", "REPLACEMENT"]);
  assert.equal(MEMBERSHIP_IS_LEGACY_FALLBACK, true);
  assert.equal(TEACHER_SETUP_IS_NOT_AUTHORIZATION, true);
});

test("AnnualCourse — création valide et unicité", async () => {
  const fx = await fixture();
  const created = await createAnnualCourse(fx.deps, {
    schoolYearId: "year-2027",
    classId: fx.schoolClass.id,
    contextId: fx.context.id,
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const duplicate = await createAnnualCourse(fx.deps, {
    schoolYearId: "year-2027",
    classId: fx.schoolClass.id,
    contextId: fx.context.id,
  });
  assert.equal(duplicate.ok, false);
});

test("AnnualCourse — validations catalogue", async () => {
  const fx = await fixture();
  const missingCtx = await createAnnualCourse(fx.deps, {
    schoolYearId: "year-2027",
    classId: fx.schoolClass.id,
    contextId: "missing-ctx",
  });
  assert.equal(missingCtx.ok, false);

  const otherProfession = await fx.catalog.createProfession({ label: "Automaticien", durationYears: 4 });
  const otherCtx = await fx.catalog.createContext({
    professionId: otherProfession.id,
    trainingYear: 1,
    branchId: fx.moteur.id,
  });
  assert.equal(otherCtx.ok, true);
  if (!otherCtx.ok) return;
  const professionMismatch = await createAnnualCourse(fx.deps, {
    schoolYearId: "year-2027",
    classId: fx.schoolClass.id,
    contextId: otherCtx.value.id,
  });
  assert.equal(professionMismatch.ok, false);

  const year2 = await fx.catalog.createContext({
    professionId: fx.profession.id,
    trainingYear: 2,
    branchId: fx.moteur.id,
  });
  assert.equal(year2.ok, true);
  if (!year2.ok) return;
  const yearMismatch = await createAnnualCourse(fx.deps, {
    schoolYearId: "year-2027",
    classId: fx.schoolClass.id,
    contextId: year2.value.id,
  });
  assert.equal(yearMismatch.ok, false);

  const wrongYear = await createAnnualCourse(fx.deps, {
    schoolYearId: "year-missing",
    classId: fx.schoolClass.id,
    contextId: fx.context.id,
  });
  assert.equal(wrongYear.ok, false);

  const otherClass = await fx.catalog.createClass({
    code: "MMA1C",
    label: "MMA 1C",
    schoolYearId: "year-other",
    schoolYearLabel: "2026-2027",
    professionId: fx.profession.id,
    trainingYear: 1,
  });
  const classYearMismatch = await createAnnualCourse(fx.deps, {
    schoolYearId: "year-2027",
    classId: otherClass.id,
    contextId: fx.context.id,
  });
  assert.equal(classYearMismatch.ok, false);
});

test("AnnualCourse — archivage et suppression utilisée refusée", async () => {
  const fx = await fixture();
  const created = await createAnnualCourse(fx.deps, {
    schoolYearId: "year-2027",
    classId: fx.schoolClass.id,
    contextId: fx.context.id,
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const unusedDelete = await deleteAnnualCourse(fx.deps, created.value.id);
  assert.equal(unusedDelete.ok, true);

  const again = await createAnnualCourse(fx.deps, {
    schoolYearId: "year-2027",
    classId: fx.schoolClass.id,
    contextId: fx.context.id,
  });
  assert.equal(again.ok, true);
  if (!again.ok) return;
  const assigned = await assignTeacherToCourse(fx.deps, {
    annualCourseId: again.value.id,
    teacherId: fx.francois.id,
    role: "PRIMARY",
    createdByAdminId: "admin-1",
  });
  assert.equal(assigned.ok, true);
  const usedDelete = await deleteAnnualCourse(fx.deps, again.value.id);
  assert.equal(usedDelete.ok, false);
  const archived = await fx.deps.courses.archiveCourse(again.value.id);
  assert.equal(archived?.isArchived, true);
});

test("AnnualCourse — blockers de suppression (attributions, notes, créneaux)", () => {
  assert.equal(annualCourseDeleteBlockers({ assignmentCount: 0, noteCount: 0 }), null);
  assert.equal(annualCourseDeleteBlockers({ assignmentCount: 0, noteCount: 0, scheduleSlotCount: 0 }), null);
  assert.equal(
    annualCourseDeleteBlockers({ assignmentCount: 1, noteCount: 0 }),
    ANNUAL_COURSE_USED_DELETE_REASON,
  );
  assert.equal(
    annualCourseDeleteBlockers({ assignmentCount: 0, noteCount: 1 }),
    ANNUAL_COURSE_USED_DELETE_REASON,
  );
  assert.equal(
    annualCourseDeleteBlockers({ assignmentCount: 0, noteCount: 0, scheduleSlotCount: 1 }),
    ANNUAL_COURSE_SCHEDULE_DELETE_REASON,
  );
});

test("enseignants — nouveau typé, legacy null non attribuable", async () => {
  const fx = await fixture();
  const created = await createAnnualCourse(fx.deps, {
    schoolYearId: "year-2027",
    classId: fx.schoolClass.id,
    contextId: fx.context.id,
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const unset = await fx.teachers.createAccount({
    displayName: "Sans Type",
    initials: "StX",
  });
  assert.equal(unset.ok, true);
  if (!unset.ok) return;
  assert.equal(unset.account.teachingType, null);
  assert.equal(teacherIsAssignable(unset.account).ok, false);

  const legacy = (await fx.teachers.listAccounts()).find((entry) => entry.teachingType === null);
  assert.ok(legacy);
  assert.equal(teacherIsAssignable(legacy).ok, false);

  const blocked = await assignTeacherToCourse(fx.deps, {
    annualCourseId: created.value.id,
    teacherId: legacy!.id,
    role: "PRIMARY",
    createdByAdminId: "admin-1",
  });
  assert.equal(blocked.ok, false);
});

test("attributions — titulaire, coenseignant, temporaire, définitif", async () => {
  const fx = await fixture();
  const course = await createAnnualCourse(fx.deps, {
    schoolYearId: "year-2027",
    classId: fx.schoolClass.id,
    contextId: fx.context.id,
  });
  assert.equal(course.ok, true);
  if (!course.ok) return;

  const primary = await assignTeacherToCourse(fx.deps, {
    annualCourseId: course.value.id,
    teacherId: fx.francois.id,
    role: "PRIMARY",
    createdByAdminId: "admin-1",
  });
  assert.equal(primary.ok, true);

  const secondPrimary = await assignTeacherToCourse(fx.deps, {
    annualCourseId: course.value.id,
    teacherId: fx.paul.id,
    role: "PRIMARY",
    createdByAdminId: "admin-1",
  });
  assert.equal(secondPrimary.ok, false);

  const co = await assignTeacherToCourse(fx.deps, {
    annualCourseId: course.value.id,
    teacherId: fx.paul.id,
    role: "CO_TEACHER",
    createdByAdminId: "admin-1",
  });
  assert.equal(co.ok, true);

  const duplicate = await assignTeacherToCourse(fx.deps, {
    annualCourseId: course.value.id,
    teacherId: fx.paul.id,
    role: "REPLACEMENT",
    createdByAdminId: "admin-1",
  });
  assert.equal(duplicate.ok, false);

  const classA = await fx.catalog.createClass({
    code: "MMA1A",
    label: "MMA 1A",
    schoolYearId: "year-2027",
    schoolYearLabel: "2027-2028",
    professionId: fx.profession.id,
    trainingYear: 1,
    parallelCode: "A",
  });
  const classC = await fx.catalog.createClass({
    code: "MMA1C",
    label: "MMA 1C",
    schoolYearId: "year-2027",
    schoolYearLabel: "2027-2028",
    professionId: fx.profession.id,
    trainingYear: 1,
    parallelCode: "C",
  });
  const courseA = await createAnnualCourse(fx.deps, {
    schoolYearId: "year-2027",
    classId: classA.id,
    contextId: fx.context.id,
  });
  const courseC = await createAnnualCourse(fx.deps, {
    schoolYearId: "year-2027",
    classId: classC.id,
    contextId: fx.context.id,
  });
  assert.equal(courseA.ok && courseC.ok, true);
  if (!courseA.ok || !courseC.ok) return;
  assert.equal(
    (await assignTeacherToCourse(fx.deps, {
      annualCourseId: courseA.value.id,
      teacherId: fx.francois.id,
      role: "PRIMARY",
      createdByAdminId: "admin-1",
    })).ok,
    true,
  );
  assert.equal(
    (await assignTeacherToCourse(fx.deps, {
      annualCourseId: courseC.value.id,
      teacherId: fx.francois.id,
      role: "PRIMARY",
      createdByAdminId: "admin-1",
    })).ok,
    true,
  );

  const marc = await fx.teachers.createAccount({
    displayName: "Marc Remplacant",
    initials: "ReM",
    teachingType: "TECHNICAL",
  });
  assert.equal(marc.ok, true);
  if (!marc.ok) return;
  const temp = await assignTemporaryReplacement(fx.deps, {
    annualCourseId: course.value.id,
    teacherId: marc.account.id,
    createdByAdminId: "admin-1",
    validFrom: "2027-11-03",
    validTo: "2027-11-20",
  });
  assert.equal(temp.ok, true);
  if (!temp.ok) return;
  assert.equal(temp.value.role, "REPLACEMENT");
  assert.equal(isAssignmentActiveAt(temp.value, "2027-11-10T12:00:00.000Z"), true);
  assert.equal(isAssignmentActiveAt(temp.value, "2027-11-21T00:00:00.000Z"), false);

  const replaced = await replaceTeacherDefinitively(fx.deps, {
    annualCourseId: course.value.id,
    outgoingTeacherId: fx.francois.id,
    incomingTeacherId: fx.paul.id,
    createdByAdminId: "admin-1",
    effectiveAt: "2027-11-15T00:00:00.000Z",
  });
  // Paul already CO_TEACHER overlapping — refuse duplicate
  assert.equal(replaced.ok, false);

  await endTeacherAssignment(fx.deps, (await fx.deps.courses.listAssignments(course.value.id))
    .find((entry) => entry.teacherId === fx.paul.id && entry.role === "CO_TEACHER")!.id, "admin-1", "2027-11-14T00:00:00.000Z");

  const replacedOk = await replaceTeacherDefinitively(fx.deps, {
    annualCourseId: course.value.id,
    outgoingTeacherId: fx.francois.id,
    incomingTeacherId: fx.paul.id,
    createdByAdminId: "admin-1",
    effectiveAt: "2027-11-15T00:00:00.000Z",
  });
  assert.equal(replacedOk.ok, true);
  if (!replacedOk.ok) return;
  assert.equal(replacedOk.value.created.annualCourseId, course.value.id);
  assert.equal(replacedOk.value.created.teacherId, fx.paul.id);
});

test("garde-fou type + override admin", () => {
  assert.equal(evaluateTeachingTypeGuard({
    branchType: "TECHNICAL",
    teacherType: "TECHNICAL",
  }).ok, true);
  assert.equal(evaluateTeachingTypeGuard({
    branchType: "GENERAL",
    teacherType: "GENERAL",
  }).ok, true);
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

test("sécurité — accès cours et notes élèves", async () => {
  const fx = await fixture();
  const course = await createAnnualCourse(fx.deps, {
    schoolYearId: "year-2027",
    classId: fx.schoolClass.id,
    contextId: fx.context.id,
  });
  assert.equal(course.ok, true);
  if (!course.ok) return;
  await assignTeacherToCourse(fx.deps, {
    annualCourseId: course.value.id,
    teacherId: fx.francois.id,
    role: "PRIMARY",
    createdByAdminId: "admin-1",
  });
  const assignments = await fx.deps.courses.listAssignments(course.value.id);
  assert.equal(
    teacherCanAccessAnnualCourse({
      teacher: fx.paul,
      course: course.value,
      assignments,
    }),
    false,
  );
  assert.equal(
    teacherCanAccessAnnualCourse({
      teacher: fx.francois,
      course: course.value,
      assignments,
    }),
    true,
  );
  const expired = await assignTemporaryReplacement(fx.deps, {
    annualCourseId: course.value.id,
    teacherId: fx.paul.id,
    createdByAdminId: "admin-1",
    validFrom: "2026-01-01",
    validTo: "2026-01-31",
  });
  assert.equal(expired.ok, true);
  const later = await fx.deps.courses.listAssignments(course.value.id);
  assert.equal(
    teacherCanAccessAnnualCourse({
      teacher: fx.paul,
      course: course.value,
      assignments: later,
      at: "2027-06-01T00:00:00.000Z",
    }),
    false,
  );

  const archived = await fx.teachers.updateAccount(fx.francois.id, { isArchived: true });
  assert.equal(archived.ok, true);
  if (!archived.ok) return;
  assert.equal(
    teacherCanAccessAnnualCourse({
      teacher: archived.account,
      course: course.value,
      assignments: later,
    }),
    false,
  );
  assert.equal(studentMayAccessCourseNotes(), false);
});

test("correction d'attribution — cours et notes inchangés", async () => {
  const fx = await fixture();
  const course = await createAnnualCourse(fx.deps, {
    schoolYearId: "year-2027",
    classId: fx.schoolClass.id,
    contextId: fx.context.id,
  });
  assert.equal(course.ok, true);
  if (!course.ok) return;
  await assignTeacherToCourse(fx.deps, {
    annualCourseId: course.value.id,
    teacherId: fx.paul.id,
    role: "PRIMARY",
    createdByAdminId: "admin-1",
  });
  const note = createAnnualCourseNote("note-1", {
    schoolYearId: "year-2027",
    classId: fx.schoolClass.id,
    contextId: fx.context.id,
    authorTeacherId: fx.paul.id,
    text: "Note moteur",
    annualCourseId: course.value.id,
  });
  assert.equal(note.ok, true);
  if (!note.ok) return;
  await fx.deps.notes.createNote(note.value.id, {
    schoolYearId: note.value.schoolYearId,
    classId: note.value.classId,
    contextId: note.value.contextId,
    authorTeacherId: note.value.authorTeacherId,
    text: note.value.text,
    annualCourseId: course.value.id,
  });

  const corrected = await replaceTeacherDefinitively(fx.deps, {
    annualCourseId: course.value.id,
    outgoingTeacherId: fx.paul.id,
    incomingTeacherId: fx.francois.id,
    createdByAdminId: "admin-1",
    effectiveAt: "2027-09-01T00:00:00.000Z",
  });
  assert.equal(corrected.ok, true);
  const same = await fx.deps.courses.getCourse(course.value.id);
  assert.equal(same?.id, course.value.id);
  const notes = await fx.deps.notes.listNotes({
    schoolYearId: "year-2027",
    classId: fx.schoolClass.id,
    contextId: fx.context.id,
  });
  assert.equal(notes.length, 1);
  assert.equal(notes[0]?.text, "Note moteur");
  assert.equal(notes[0]?.authorTeacherId, fx.paul.id);
});

test("CTX — suppression refusée si dépendances, archivage possible", async () => {
  const fx = await fixture();
  const unused = await fx.catalog.createContext({
    professionId: fx.profession.id,
    trainingYear: 3,
    branchId: fx.moteur.id,
  });
  assert.equal(unused.ok, true);
  if (!unused.ok) return;
  const deleted = await fx.catalog.deleteContext(unused.value.id);
  assert.equal(deleted.ok, true);

  await getMemoryPedagogicalPathStore().savePath({
    id: "path-1",
    contextId: fx.context.id,
    sessions: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  const blockedPath = await fx.catalog.deleteContext(fx.context.id);
  assert.equal(blockedPath.ok, false);
  await getMemoryPedagogicalPathStore().deletePathByContextId(fx.context.id);

  await createAnnualCourse(fx.deps, {
    schoolYearId: "year-2027",
    classId: fx.schoolClass.id,
    contextId: fx.context.id,
  });
  // Memory catalog looks at the singleton annual-course store, not fx.deps.courses.
  resetMemoryAnnualCourseStore();
  const { getMemoryAnnualCourseStore } = await import("../src/lib/persistence/memory-annual-course-store.ts");
  const singleton = getMemoryAnnualCourseStore();
  await singleton.createCourse({
    id: "ac-1",
    schoolYearId: "year-2027",
    classId: fx.schoolClass.id,
    contextId: fx.context.id,
    isArchived: false,
    archivedAt: null,
    createdAt: "2027-01-01T00:00:00.000Z",
    updatedAt: "2027-01-01T00:00:00.000Z",
  });
  const blockedCourse = await fx.catalog.deleteContext(fx.context.id);
  assert.equal(blockedCourse.ok, false);
  const archived = await fx.catalog.updateContext(fx.context.id, { isArchived: true });
  assert.equal(archived.ok, true);
  if (!archived.ok) return;
  assert.equal(archived.value.isArchived, true);
});

test("compat — membership et teacher-setup inchangés", () => {
  const at = "2027-11-15T00:00:00.000Z";
  const result = replaceTeacherMemberships(
    [
      {
        id: "m1",
        teacherId: "francois",
        classroomId: "classe-mma-1b",
        subjectIds: ["moteur"],
        validFrom: "2027-08-01T00:00:00.000Z",
        validTo: null,
      },
    ],
    {
      classroomId: "classe-mma-1b",
      outgoingTeacherId: "francois",
      incomingTeacherId: "paul",
      subjectIds: ["moteur"],
      effectiveAt: at,
    },
  );
  assert.ok("created" in result);
  if (!("created" in result)) return;
  assert.equal(result.created.teacherId, "paul");
  assert.equal(isMembershipActiveAt(result.created, at), true);
  assert.equal(
    isTeacherSetupPayload({
      version: 1,
      classes: [],
    }),
    true,
  );
});

test("Agenda — résolution AnnualCourse uniquement si correspondance stable", async () => {
  const fx = await fixture();
  const created = await createAnnualCourse(fx.deps, {
    schoolYearId: "year-2027",
    classId: fx.schoolClass.id,
    contextId: fx.context.id,
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const courses = await fx.deps.courses.listCourses();
  const resolved = resolveAnnualCourseForPublication({
    classroomName: "MMA 1B",
    subjectName: fx.moteur.label,
    classes: await fx.catalog.listClasses(),
    branches: await fx.catalog.listBranches(),
    contexts: await fx.catalog.listContexts(),
    courses,
  });
  assert.equal(resolved?.course.id, created.value.id);

  const legacy = resolveAnnualCourseForPublication({
    classroomName: "Classe inconnue",
    subjectName: "Moteur",
    classes: await fx.catalog.listClasses(),
    branches: await fx.catalog.listBranches(),
    contexts: await fx.catalog.listContexts(),
    courses,
  });
  assert.equal(legacy, null);
});

test("remplacements temporaires successifs — non chevauchants autorisés, chevauchement refusé", async () => {
  const fx = await fixture();
  const course = await createAnnualCourse(fx.deps, {
    schoolYearId: "year-2027",
    classId: fx.schoolClass.id,
    contextId: fx.context.id,
  });
  assert.equal(course.ok, true);
  if (!course.ok) return;
  await assignTeacherToCourse(fx.deps, {
    annualCourseId: course.value.id,
    teacherId: fx.francois.id,
    role: "PRIMARY",
    createdByAdminId: "admin-1",
  });

  const november = await assignTemporaryReplacement(fx.deps, {
    annualCourseId: course.value.id,
    teacherId: fx.paul.id,
    createdByAdminId: "admin-1",
    validFrom: "2027-11-03",
    validTo: "2027-11-20",
  });
  assert.equal(november.ok, true);
  if (!november.ok) return;
  assert.equal(november.value.endedAt, null);
  assert.equal(isAssignmentActiveAt(november.value, "2027-11-21T00:00:00.000Z"), false);

  const january = await assignTemporaryReplacement(fx.deps, {
    annualCourseId: course.value.id,
    teacherId: fx.paul.id,
    createdByAdminId: "admin-1",
    validFrom: "2028-01-10",
    validTo: "2028-01-20",
  });
  assert.equal(january.ok, true);
  if (!january.ok) return;
  assert.equal(january.value.endedAt, null);

  const overlap = await assignTemporaryReplacement(fx.deps, {
    annualCourseId: course.value.id,
    teacherId: fx.paul.id,
    createdByAdminId: "admin-1",
    validFrom: "2027-11-15",
    validTo: "2027-11-25",
  });
  assert.equal(overlap.ok, false);
});

test("PRIMARY successifs — périodes disjointes autorisées, chevauchement refusé", async () => {
  const fx = await fixture();
  const course = await createAnnualCourse(fx.deps, {
    schoolYearId: "year-2027",
    classId: fx.schoolClass.id,
    contextId: fx.context.id,
  });
  assert.equal(course.ok, true);
  if (!course.ok) return;

  const first = await assignTeacherToCourse(fx.deps, {
    annualCourseId: course.value.id,
    teacherId: fx.francois.id,
    role: "PRIMARY",
    createdByAdminId: "admin-1",
    validFrom: "2027-08-01",
    validTo: "2027-12-31",
  });
  assert.equal(first.ok, true);

  const second = await assignTeacherToCourse(fx.deps, {
    annualCourseId: course.value.id,
    teacherId: fx.paul.id,
    role: "PRIMARY",
    createdByAdminId: "admin-1",
    validFrom: "2028-01-01",
  });
  assert.equal(second.ok, true);

  const marc = await fx.teachers.createAccount({
    displayName: "Marc Chevauche",
    initials: "ChM",
    teachingType: "TECHNICAL",
  });
  assert.equal(marc.ok, true);
  if (!marc.ok) return;
  const overlap = await assignTeacherToCourse(fx.deps, {
    annualCourseId: course.value.id,
    teacherId: marc.account.id,
    role: "PRIMARY",
    createdByAdminId: "admin-1",
    validFrom: "2027-12-01",
  });
  assert.equal(overlap.ok, false);
});

test("cours archivé — aucune nouvelle attribution", async () => {
  const fx = await fixture();
  const course = await createAnnualCourse(fx.deps, {
    schoolYearId: "year-2027",
    classId: fx.schoolClass.id,
    contextId: fx.context.id,
  });
  assert.equal(course.ok, true);
  if (!course.ok) return;

  const tempOk = await assignTemporaryReplacement(fx.deps, {
    annualCourseId: course.value.id,
    teacherId: fx.paul.id,
    createdByAdminId: "admin-1",
    validFrom: "2027-11-03",
    validTo: "2027-11-20",
  });
  assert.equal(tempOk.ok, true);

  const archived = await archiveAnnualCourse(fx.deps, course.value.id);
  assert.equal(archived.ok, true);

  const primary = await assignTeacherToCourse(fx.deps, {
    annualCourseId: course.value.id,
    teacherId: fx.francois.id,
    role: "PRIMARY",
    createdByAdminId: "admin-1",
  });
  assert.equal(primary.ok, false);
  if (!primary.ok) assert.equal(primary.status, 409);

  const co = await assignTeacherToCourse(fx.deps, {
    annualCourseId: course.value.id,
    teacherId: fx.francois.id,
    role: "CO_TEACHER",
    createdByAdminId: "admin-1",
  });
  assert.equal(co.ok, false);

  const replacement = await assignTeacherToCourse(fx.deps, {
    annualCourseId: course.value.id,
    teacherId: fx.francois.id,
    role: "REPLACEMENT",
    createdByAdminId: "admin-1",
    validFrom: "2028-02-01",
    validTo: "2028-02-15",
  });
  assert.equal(replacement.ok, false);

  const definitive = await replaceTeacherDefinitively(fx.deps, {
    annualCourseId: course.value.id,
    outgoingTeacherId: fx.paul.id,
    incomingTeacherId: fx.francois.id,
    createdByAdminId: "admin-1",
  });
  assert.equal(definitive.ok, false);

  const tempBlocked = await assignTemporaryReplacement(fx.deps, {
    annualCourseId: course.value.id,
    teacherId: fx.francois.id,
    createdByAdminId: "admin-1",
    validFrom: "2028-01-10",
    validTo: "2028-01-20",
  });
  assert.equal(tempBlocked.ok, false);
  if (!tempBlocked.ok) {
    assert.equal(tempBlocked.reason, "Ce cours annuel est archivé.");
    assert.equal(tempBlocked.status, 409);
  }

  const ensured = await ensureAnnualCourse(fx.deps, {
    schoolYearId: "year-2027",
    classId: fx.schoolClass.id,
    contextId: fx.context.id,
  });
  assert.equal(ensured.ok, false);
  if (!ensured.ok) assert.equal(ensured.status, 409);
});

test("premier professeur incompatible — forçage PRIMARY, jamais CO_TEACHER", async () => {
  const fx = await fixture();
  const course = await createAnnualCourse(fx.deps, {
    schoolYearId: "year-2027",
    classId: fx.schoolClass.id,
    contextId: fx.context.id,
  });
  assert.equal(course.ok, true);
  if (!course.ok) return;

  const refused = await assignTeacherToCourse(fx.deps, {
    annualCourseId: course.value.id,
    teacherId: fx.sophie.id,
    role: "PRIMARY",
    createdByAdminId: "admin-1",
  });
  assert.equal(refused.ok, false);

  const forced = await assignTeacherToCourse(fx.deps, {
    annualCourseId: course.value.id,
    teacherId: fx.sophie.id,
    role: "PRIMARY",
    createdByAdminId: "admin-1",
    forceIncompatible: true,
    overrideReason: "Pénurie temporaire",
  });
  assert.equal(forced.ok, true);
  if (!forced.ok) return;
  assert.equal(forced.value.role, "PRIMARY");
  assert.notEqual(forced.value.role, "CO_TEACHER");
  assert.equal(forced.value.overrideReason, "Pénurie temporaire");
});

test("SQLite — 0018 puis 0019, périodes, archivage, trigger CTX", async () => {
  const db = createNodeSqliteDatabase(":memory:");
  await applyMigrations(db, { until: "0018_admin_referential_coherence.sql" });
  const before = await db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'annual_courses'")
    .bind()
    .all<{ name: string }>();
  assert.equal(before.results.length, 0);

  await applyMigrations(db, { until: "0019_annual_courses_teacher_assignments.sql" });
  await applyMigrations(db);
  const tables = await db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('annual_courses', 'teacher_course_assignments')")
    .bind()
    .all<{ name: string }>();
  assert.ok(tables.results.some((row) => row.name === "annual_courses"));
  assert.ok(tables.results.some((row) => row.name === "teacher_course_assignments"));

  const leftoverIndexes = await db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('idx_tca_open_teacher', 'idx_tca_open_primary')")
    .bind()
    .all<{ name: string }>();
  assert.equal(leftoverIndexes.results.length, 0);

  const catalog = new SqlSchoolCatalogStore(db);
  await catalog.ensureSeeded();
  const profession = await catalog.createProfession({ label: "Mécatronicien", durationYears: 4 });
  const branches = await catalog.listBranches();
  const branch = branches.find((entry) => entry.label === "Moteur") ?? branches[0]!;
  await catalog.updateBranch(branch.id, { teachingType: "TECHNICAL" });
  const ctx = await catalog.createContext({
    professionId: profession.id,
    trainingYear: 1,
    branchId: branch.id,
  });
  assert.equal(ctx.ok, true);
  if (!ctx.ok) return;

  const years = yearsStub("sy-sql");
  const schoolClass = await catalog.createClass({
    code: "MMA1B",
    label: "MMA 1B",
    schoolYearId: "sy-sql",
    schoolYearLabel: "2027-2028",
    professionId: profession.id,
    trainingYear: 1,
  });
  const teachers = new SqlTeacherAccountStore(db);
  const francois = await teachers.createAccount({
    displayName: "François SQL",
    initials: "SqF",
    teachingType: "TECHNICAL",
  });
  const paul = await teachers.createAccount({
    displayName: "Paul SQL",
    initials: "SqP",
    teachingType: "TECHNICAL",
  });
  assert.equal(francois.ok && paul.ok, true);
  if (!francois.ok || !paul.ok) return;

  const deps: AnnualCourseServiceDeps = {
    courses: new SqlAnnualCourseStore(db),
    catalog,
    years,
    teachers,
    notes: new SqlAnnualCourseNotesStore(db),
  };
  const course = await createAnnualCourse(deps, {
    schoolYearId: "sy-sql",
    classId: schoolClass.id,
    contextId: ctx.value.id,
  });
  assert.equal(course.ok, true);
  if (!course.ok) return;

  const firstPrimary = await assignTeacherToCourse(deps, {
    annualCourseId: course.value.id,
    teacherId: francois.account.id,
    role: "PRIMARY",
    createdByAdminId: "admin-sql",
    validFrom: "2027-08-01",
    validTo: "2027-12-31",
  });
  assert.equal(firstPrimary.ok, true);

  const november = await assignTemporaryReplacement(deps, {
    annualCourseId: course.value.id,
    teacherId: paul.account.id,
    createdByAdminId: "admin-sql",
    validFrom: "2027-11-03",
    validTo: "2027-11-20",
  });
  assert.equal(november.ok, true);
  if (!november.ok) return;
  assert.equal(november.value.endedAt, null);
  assert.equal(isAssignmentActiveAt(november.value, "2027-11-21T00:00:00.000Z"), false);

  const january = await assignTemporaryReplacement(deps, {
    annualCourseId: course.value.id,
    teacherId: paul.account.id,
    createdByAdminId: "admin-sql",
    validFrom: "2028-01-10",
    validTo: "2028-01-20",
  });
  assert.equal(january.ok, true);

  const overlapTemp = await assignTemporaryReplacement(deps, {
    annualCourseId: course.value.id,
    teacherId: paul.account.id,
    createdByAdminId: "admin-sql",
    validFrom: "2027-11-15",
    validTo: "2027-11-25",
  });
  assert.equal(overlapTemp.ok, false);

  const marc = await teachers.createAccount({
    displayName: "Marc SQL",
    initials: "SqM",
    teachingType: "TECHNICAL",
  });
  assert.equal(marc.ok, true);
  if (!marc.ok) return;
  const secondPrimary = await assignTeacherToCourse(deps, {
    annualCourseId: course.value.id,
    teacherId: marc.account.id,
    role: "PRIMARY",
    createdByAdminId: "admin-sql",
    validFrom: "2028-01-01",
  });
  assert.equal(secondPrimary.ok, true);

  const lea = await teachers.createAccount({
    displayName: "Léa SQL",
    initials: "SqL",
    teachingType: "TECHNICAL",
  });
  assert.equal(lea.ok, true);
  if (!lea.ok) return;
  const overlapPrimary = await assignTeacherToCourse(deps, {
    annualCourseId: course.value.id,
    teacherId: lea.account.id,
    role: "PRIMARY",
    createdByAdminId: "admin-sql",
    validFrom: "2027-12-01",
  });
  assert.equal(overlapPrimary.ok, false);

  await assert.rejects(
    () =>
      db
        .prepare(
          `INSERT INTO teacher_course_assignments
             (id, annual_course_id, teacher_id, role, valid_from, valid_to, created_by_admin_id, created_at, ended_at)
           VALUES (?, ?, ?, 'REPLACEMENT', ?, ?, 'admin-sql', datetime('now'), NULL)`,
        )
        .bind(
          "tca-overlap-raw",
          course.value.id,
          paul.account.id,
          "2027-11-15T00:00:00.000Z",
          "2027-11-25T23:59:59.999Z",
        )
        .run(),
    /period overlaps|ABORT/i,
  );

  const archived = await archiveAnnualCourse(deps, course.value.id);
  assert.equal(archived.ok, true);
  const archivedTemp = await assignTemporaryReplacement(deps, {
    annualCourseId: course.value.id,
    teacherId: marc.account.id,
    createdByAdminId: "admin-sql",
    validFrom: "2028-03-01",
    validTo: "2028-03-10",
  });
  assert.equal(archivedTemp.ok, false);

  const unused = await catalog.createContext({
    professionId: profession.id,
    trainingYear: 2,
    branchId: branch.id,
  });
  assert.equal(unused.ok, true);
  if (!unused.ok) return;
  const unusedDeleted = await catalog.deleteContext(unused.value.id);
  assert.equal(unusedDeleted.ok, true);

  const blocked = await catalog.deleteContext(ctx.value.id);
  assert.equal(blocked.ok, false);
  await assert.rejects(
    () => db.prepare("DELETE FROM pedagogical_contexts WHERE id = ?").bind(ctx.value.id).run(),
    /CTX used|archive instead|ABORT/i,
  );

  const triggerSql = splitSqlStatements(`
    CREATE TRIGGER IF NOT EXISTS t_demo BEFORE DELETE ON pedagogical_contexts FOR EACH ROW
    BEGIN SELECT RAISE(ABORT, 'x'); END;
  `);
  assert.equal(triggerSql.length, 1);

  db.close();
});
