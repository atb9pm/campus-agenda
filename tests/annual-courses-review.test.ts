import assert from "node:assert/strict";
import test from "node:test";

import {
  archiveAnnualCourse,
  assignmentLifecycle,
  assignTeacherToCourse,
  assignTemporaryReplacement,
  createAnnualCourse,
  decideAgendaPublishAccess,
  decideAssignmentDialogSubmit,
  effectiveAtForEndAssignment,
  endTeacherAssignment,
  evaluateTeachingTypeGuard,
  isAssignmentActiveAt,
  isClassEligibleForAssignment,
  parseAssignmentDate,
  replaceTeacherDefinitively,
  requireOverrideReason,
  resolveAnnualCourseForPublication,
  teacherCanAccessAnnualCourse,
  type AnnualCourseServiceDeps,
} from "../src/features/annual-courses/index.ts";
import { createAnnualCourseNote } from "../src/features/pedagogical-path/index.ts";
import {
  MemoryAnnualCourseStore,
  resetMemoryAnnualCourseStore,
} from "../src/lib/persistence/memory-annual-course-store.ts";
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
import { createNodeSqliteDatabase } from "../src/lib/persistence/sql/adapters.ts";
import { applyMigrations } from "../src/lib/persistence/sql/migrate.ts";
import { SqlAnnualCourseStore } from "../src/lib/persistence/sql/sql-annual-course-store.ts";
import { SqlAnnualCourseNotesStore } from "../src/lib/persistence/sql/sql-pedagogical-path-store.ts";
import { SqlSchoolCatalogStore } from "../src/lib/persistence/sql/sql-school-catalog-store.ts";
import { SqlTeacherAccountStore } from "../src/lib/persistence/sql/sql-teacher-account-store.ts";
import type { SchoolYearStore } from "../src/lib/persistence/school-year-types.ts";

function yearsStub(
  id = "year-2027",
  label = "2027-2028",
  status: "draft" | "active" | "archived" = "active",
): SchoolYearStore {
  return {
    listSchoolYears: async () => [
      {
        id,
        label,
        status,
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

async function fixture(yearStatus: "draft" | "active" | "archived" = "active") {
  resetMemorySchoolCatalogStore();
  resetMemoryAnnualCourseStore();
  resetMemoryPedagogicalPathStore();
  resetMemoryTeacherAccountStore();
  const catalog = getMemorySchoolCatalogStore();
  await catalog.ensureSeeded();
  const profession = await catalog.createProfession({ label: "Mécatronicien", durationYears: 4 });
  const branches = await catalog.listBranches();
  const moteur = branches.find((entry) => entry.label === "Moteur") ?? branches[0]!;
  await catalog.updateBranch(moteur.id, { teachingType: "TECHNICAL" });
  const ctx = await catalog.createContext({
    professionId: profession.id,
    trainingYear: 1,
    branchId: moteur.id,
  });
  assert.equal(ctx.ok, true);
  if (!ctx.ok) throw new Error(ctx.reason);
  const schoolClass = await catalog.createClass({
    code: "MMA1A",
    label: "MMA 1A",
    schoolYearId: "year-2027",
    schoolYearLabel: "2027-2028",
    professionId: profession.id,
    trainingYear: 1,
    parallelCode: "A",
  });
  const teachers = getMemoryTeacherAccountStore();
  const francois = await teachers.createAccount({
    displayName: "François Titulaire",
    initials: "RvF",
    teachingType: "TECHNICAL",
  });
  const paul = await teachers.createAccount({
    displayName: "Paul Coenseignant",
    initials: "RvP",
    teachingType: "TECHNICAL",
  });
  const marc = await teachers.createAccount({
    displayName: "Marc Remplacant",
    initials: "RvM",
    teachingType: "TECHNICAL",
  });
  const admin = await teachers.createAccount({
    displayName: "Admin Ecole",
    initials: "AdE",
    teachingType: "TECHNICAL",
    isAdmin: true,
  });
  assert.ok(francois.ok && paul.ok && marc.ok && admin.ok);
  const deps: AnnualCourseServiceDeps = {
    courses: new MemoryAnnualCourseStore(),
    catalog,
    years: yearsStub("year-2027", "2027-2028", yearStatus),
    teachers,
    notes: getMemoryAnnualCourseNotesStore(),
  };
  return {
    deps,
    catalog,
    profession,
    moteur,
    context: ctx.value,
    schoolClass,
    francois: francois.ok ? francois.account : null!,
    paul: paul.ok ? paul.account : null!,
    marc: marc.ok ? marc.account : null!,
    admin: admin.ok ? admin.account : null!,
    teachers,
  };
}

test("UI — premier professeur incompatible reste PRIMARY après forçage", () => {
  const forced = decideAssignmentDialogSubmit({
    existingCount: 0,
    conflictChoice: "CANCEL",
    forceStep: "confirm",
    tempFrom: "",
    tempTo: "",
    effectiveAt: "",
  });
  assert.deepEqual(forced, { type: "assign", role: "PRIMARY", force: true });

  const warn = decideAssignmentDialogSubmit({
    existingCount: 0,
    conflictChoice: "CANCEL",
    forceStep: "warn",
    tempFrom: "",
    tempTo: "",
    effectiveAt: "",
  });
  assert.equal(warn.type, "need-force-confirm");

  const cancelOnlyIfExisting = decideAssignmentDialogSubmit({
    existingCount: 1,
    conflictChoice: "CANCEL",
    forceStep: "none",
    tempFrom: "",
    tempTo: "",
    effectiveAt: "",
  });
  assert.equal(cancelOnlyIfExisting.type, "cancel");
});

test("dates — normalisation ISO et rejets", () => {
  const start = parseAssignmentDate("2027-11-15", "start");
  assert.equal(start.ok && start.value, "2027-11-15T00:00:00.000Z");
  const end = parseAssignmentDate("2027-11-15", "end");
  assert.equal(end.ok && end.value, "2027-11-15T23:59:59.999Z");
  const instant = parseAssignmentDate("2027-10-01", "instant");
  assert.equal(instant.ok && instant.value, "2027-10-01T00:00:00.000Z");
  assert.equal(parseAssignmentDate("2027-13-40", "start").ok, false);
  assert.equal(parseAssignmentDate("pas-une-date", "start").ok, false);
  assert.equal(requireOverrideReason(true, "   ").ok, false);
  assert.equal(requireOverrideReason(true, "Pénurie").ok, true);
});

test("A — remplacement futur : titulaire jusqu'à T, successeur à partir de T", async () => {
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
    validFrom: "2027-08-01",
  });
  assert.equal(primary.ok, true);

  const replaced = await replaceTeacherDefinitively(fx.deps, {
    annualCourseId: course.value.id,
    outgoingTeacherId: fx.francois.id,
    incomingTeacherId: fx.paul.id,
    createdByAdminId: "admin-1",
    effectiveAt: "2027-10-01",
  });
  assert.equal(replaced.ok, true);
  if (!replaced.ok || !primary.ok) return;
  assert.equal(replaced.value.created.createdAt !== replaced.value.created.validFrom, true);
  assert.equal(replaced.value.created.validFrom, "2027-10-01T00:00:00.000Z");
  assert.equal(replaced.value.created.createdAt.startsWith("2027-10-01"), false);

  const assignments = await fx.deps.courses.listAssignments(course.value.id);
  const francois = assignments.find((entry) => entry.teacherId === fx.francois.id)!;
  const paul = assignments.find((entry) => entry.teacherId === fx.paul.id)!;
  assert.equal(isAssignmentActiveAt(francois, "2027-09-15T12:00:00.000Z"), true);
  assert.equal(isAssignmentActiveAt(paul, "2027-09-15T12:00:00.000Z"), false);
  assert.equal(isAssignmentActiveAt(francois, "2027-09-30T23:59:59.999Z"), true);
  assert.equal(isAssignmentActiveAt(francois, "2027-10-01T00:00:00.000Z"), false);
  assert.equal(isAssignmentActiveAt(paul, "2027-10-01T00:00:00.000Z"), true);
  assert.equal(assignmentLifecycle(paul, "2027-09-15T12:00:00.000Z"), "upcoming");
  assert.equal(assignmentLifecycle(francois, "2027-10-01T00:00:00.000Z"), "ended");
});

test("B — l'historique du titulaire bloque un PRIMARY rétroactif", async () => {
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
    validFrom: "2027-08-01",
  });
  const replaced = await replaceTeacherDefinitively(fx.deps, {
    annualCourseId: course.value.id,
    outgoingTeacherId: fx.francois.id,
    incomingTeacherId: fx.paul.id,
    createdByAdminId: "admin-1",
    effectiveAt: "2027-10-01",
  });
  assert.equal(replaced.ok, true);
  const retro = await assignTeacherToCourse(fx.deps, {
    annualCourseId: course.value.id,
    teacherId: fx.marc.id,
    role: "PRIMARY",
    createdByAdminId: "admin-1",
    validFrom: "2027-09-15",
    validTo: "2027-09-20",
  });
  assert.equal(retro.ok, false);
});

test("C — PRIMARY futur : remplacement chevauchant refusé avant mutation", async () => {
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
  const second = await assignTeacherToCourse(fx.deps, {
    annualCourseId: course.value.id,
    teacherId: fx.paul.id,
    role: "PRIMARY",
    createdByAdminId: "admin-1",
    validFrom: "2028-01-01",
  });
  assert.equal(first.ok && second.ok, true);
  const before = await fx.deps.courses.listAssignments(course.value.id);
  const refused = await replaceTeacherDefinitively(fx.deps, {
    annualCourseId: course.value.id,
    outgoingTeacherId: fx.francois.id,
    incomingTeacherId: fx.marc.id,
    createdByAdminId: "admin-1",
    effectiveAt: "2027-12-01",
  });
  assert.equal(refused.ok, false);
  const after = await fx.deps.courses.listAssignments(course.value.id);
  assert.deepEqual(
    after.map((entry) => ({ id: entry.id, endedAt: entry.endedAt, teacherId: entry.teacherId })),
    before.map((entry) => ({ id: entry.id, endedAt: entry.endedAt, teacherId: entry.teacherId })),
  );
});

test("D/E — remplacements temporaires successifs et chevauchement", async () => {
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
  const first = await assignTemporaryReplacement(fx.deps, {
    annualCourseId: course.value.id,
    teacherId: fx.paul.id,
    createdByAdminId: "admin-1",
    validFrom: "2027-11-03",
    validTo: "2027-11-20",
  });
  const second = await assignTemporaryReplacement(fx.deps, {
    annualCourseId: course.value.id,
    teacherId: fx.paul.id,
    createdByAdminId: "admin-1",
    validFrom: "2028-01-10",
    validTo: "2028-01-20",
  });
  assert.equal(first.ok && second.ok, true);
  const overlap = await assignTemporaryReplacement(fx.deps, {
    annualCourseId: course.value.id,
    teacherId: fx.paul.id,
    createdByAdminId: "admin-1",
    validFrom: "2027-11-15",
    validTo: "2027-11-25",
  });
  assert.equal(overlap.ok, false);
});

test("API/service — validations d'attribution", async () => {
  const fx = await fixture();
  const course = await createAnnualCourse(fx.deps, {
    schoolYearId: "year-2027",
    classId: fx.schoolClass.id,
    contextId: fx.context.id,
  });
  assert.equal(course.ok, true);
  if (!course.ok) return;

  assert.equal((await assignTeacherToCourse(fx.deps, {
    annualCourseId: course.value.id,
    teacherId: fx.francois.id,
    role: "REPLACEMENT",
    createdByAdminId: "admin-1",
  })).ok, false);
  assert.equal((await assignTemporaryReplacement(fx.deps, {
    annualCourseId: course.value.id,
    teacherId: fx.paul.id,
    createdByAdminId: "admin-1",
    validFrom: "",
    validTo: "2027-11-20",
  })).ok, false);
  assert.equal((await assignTemporaryReplacement(fx.deps, {
    annualCourseId: course.value.id,
    teacherId: fx.paul.id,
    createdByAdminId: "admin-1",
    validFrom: "2027-11-03",
    validTo: "",
  })).ok, false);
  assert.equal((await assignTemporaryReplacement(fx.deps, {
    annualCourseId: course.value.id,
    teacherId: fx.paul.id,
    createdByAdminId: "admin-1",
    validFrom: "2027-11-20",
    validTo: "2027-11-03",
  })).ok, false);
  assert.equal((await assignTeacherToCourse(fx.deps, {
    annualCourseId: course.value.id,
    teacherId: fx.francois.id,
    role: "PRIMARY",
    createdByAdminId: "admin-1",
    validFrom: "pas-une-date",
  })).ok, false);

  const sophie = await fx.teachers.createAccount({
    displayName: "Sophie Generale",
    initials: "RvS",
    teachingType: "GENERAL",
  });
  assert.equal(sophie.ok, true);
  if (!sophie.ok) return;
  assert.equal((await assignTeacherToCourse(fx.deps, {
    annualCourseId: course.value.id,
    teacherId: sophie.account.id,
    role: "PRIMARY",
    createdByAdminId: "admin-1",
    forceIncompatible: true,
    overrideReason: "   ",
  })).ok, false);
  const forced = await assignTeacherToCourse(fx.deps, {
    annualCourseId: course.value.id,
    teacherId: sophie.account.id,
    role: "PRIMARY",
    createdByAdminId: "admin-1",
    forceIncompatible: true,
    overrideReason: "Pénurie temporaire",
  });
  assert.equal(forced.ok, true);
  if (!forced.ok) return;
  assert.equal(forced.value.role, "PRIMARY");
  const events = await fx.deps.courses.listEvents(course.value.id);
  assert.ok(events.some((entry) => entry.kind === "OVERRIDE" && entry.detail === "Pénurie temporaire"));
});

test("référentiel — branche/enseignant/classe/année/profession/CTX bloqués", async () => {
  assert.equal(evaluateTeachingTypeGuard({ branchType: null, teacherType: "TECHNICAL" }).ok, false);
  const fx = await fixture();
  const course = await createAnnualCourse(fx.deps, {
    schoolYearId: "year-2027",
    classId: fx.schoolClass.id,
    contextId: fx.context.id,
  });
  assert.equal(course.ok, true);
  if (!course.ok) return;

  const unset = await fx.teachers.createAccount({ displayName: "Sans Type", initials: "StR" });
  assert.equal(unset.ok, true);
  if (!unset.ok) return;
  assert.equal((await assignTeacherToCourse(fx.deps, {
    annualCourseId: course.value.id,
    teacherId: unset.account.id,
    role: "PRIMARY",
    createdByAdminId: "admin-1",
  })).ok, false);

  await fx.catalog.updateClass(fx.schoolClass.id, { isActive: false });
  assert.equal((await assignTeacherToCourse(fx.deps, {
    annualCourseId: course.value.id,
    teacherId: fx.francois.id,
    role: "PRIMARY",
    createdByAdminId: "admin-1",
  })).ok, false);
  await fx.catalog.updateClass(fx.schoolClass.id, { isActive: true });

  await fx.catalog.updateProfession(fx.profession.id, { isArchived: true });
  assert.equal((await assignTeacherToCourse(fx.deps, {
    annualCourseId: course.value.id,
    teacherId: fx.francois.id,
    role: "PRIMARY",
    createdByAdminId: "admin-1",
  })).ok, false);
  await fx.catalog.updateProfession(fx.profession.id, { isArchived: false });

  await fx.catalog.updateContext(fx.context.id, { isArchived: true });
  assert.equal((await assignTeacherToCourse(fx.deps, {
    annualCourseId: course.value.id,
    teacherId: fx.francois.id,
    role: "PRIMARY",
    createdByAdminId: "admin-1",
  })).ok, false);
  await fx.catalog.updateContext(fx.context.id, { isArchived: false });

  await fx.catalog.updateBranch(fx.moteur.id, { isArchived: true });
  assert.equal((await assignTeacherToCourse(fx.deps, {
    annualCourseId: course.value.id,
    teacherId: fx.francois.id,
    role: "PRIMARY",
    createdByAdminId: "admin-1",
  })).ok, false);
  await fx.catalog.updateBranch(fx.moteur.id, { isArchived: false, teachingType: "TECHNICAL" });

  await fx.catalog.updateBranch(fx.moteur.id, { teachingType: null });
  assert.equal((await assignTeacherToCourse(fx.deps, {
    annualCourseId: course.value.id,
    teacherId: fx.francois.id,
    role: "PRIMARY",
    createdByAdminId: "admin-1",
  })).ok, false);

  const archivedYear = await fixture("archived");
  const archivedCourse = await createAnnualCourse(archivedYear.deps, {
    schoolYearId: "year-2027",
    classId: archivedYear.schoolClass.id,
    contextId: archivedYear.context.id,
  });
  assert.equal(archivedCourse.ok, false);

  assert.equal(isClassEligibleForAssignment({
    isActive: true,
    schoolYearId: "year-2027",
    professionId: "p1",
    trainingYear: 1,
    yearStatus: "archived",
  }), false);
});

test("correction — retirer le CO_TEACHER sans toucher au cours ni aux notes", async () => {
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
  const co = await assignTeacherToCourse(fx.deps, {
    annualCourseId: course.value.id,
    teacherId: fx.paul.id,
    role: "CO_TEACHER",
    createdByAdminId: "admin-1",
  });
  assert.equal(co.ok, true);
  if (!co.ok) return;
  const note = createAnnualCourseNote("note-rev-1", {
    schoolYearId: "year-2027",
    classId: fx.schoolClass.id,
    contextId: fx.context.id,
    authorTeacherId: fx.francois.id,
    text: "Note conservée",
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

  const ended = await endTeacherAssignment(fx.deps, co.value.id, "admin-1");
  assert.equal(ended.ok, true);
  const again = await endTeacherAssignment(fx.deps, co.value.id, "admin-1", "2027-12-01");
  assert.equal(again.ok, false);

  const assignments = await fx.deps.courses.listAssignments(course.value.id);
  const primary = assignments.find((entry) => entry.role === "PRIMARY")!;
  const closed = assignments.find((entry) => entry.id === co.value.id)!;
  assert.equal(isAssignmentActiveAt(primary), true);
  assert.ok(closed.endedAt);
  assert.equal((await fx.deps.courses.getCourse(course.value.id))?.id, course.value.id);
  const notes = await fx.deps.notes.listNotes({
    schoolYearId: "year-2027",
    classId: fx.schoolClass.id,
    contextId: fx.context.id,
  });
  assert.equal(notes[0]?.text, "Note conservée");
});

test("retrait — attribution future à validFrom, active maintenant, déjà terminée refusée", async () => {
  const fx = await fixture();
  const course = await createAnnualCourse(fx.deps, {
    schoolYearId: "year-2027",
    classId: fx.schoolClass.id,
    contextId: fx.context.id,
  });
  assert.equal(course.ok, true);
  if (!course.ok) return;

  const upcoming = await assignTeacherToCourse(fx.deps, {
    annualCourseId: course.value.id,
    teacherId: fx.francois.id,
    role: "PRIMARY",
    createdByAdminId: "admin-1",
    validFrom: "2027-10-01",
  });
  assert.equal(upcoming.ok, true);
  if (!upcoming.ok) return;
  assert.equal(assignmentLifecycle(upcoming.value, "2026-08-30T18:00:00.000Z"), "upcoming");
  assert.equal(effectiveAtForEndAssignment(upcoming.value, "2026-08-30T18:00:00.000Z"), upcoming.value.validFrom);

  const cancelled = await endTeacherAssignment(fx.deps, upcoming.value.id, "admin-1", upcoming.value.validFrom);
  assert.equal(cancelled.ok, true);
  if (!cancelled.ok) return;
  assert.equal(cancelled.value.validFrom, "2027-10-01T00:00:00.000Z");
  assert.equal(cancelled.value.endedAt, cancelled.value.validFrom);
  assert.equal(isAssignmentActiveAt(cancelled.value, "2027-09-30T23:59:59.999Z"), false);
  assert.equal(isAssignmentActiveAt(cancelled.value, "2027-10-01T00:00:00.000Z"), false);
  assert.equal(isAssignmentActiveAt(cancelled.value, "2027-10-02T00:00:00.000Z"), false);
  const events = await fx.deps.courses.listEvents(course.value.id);
  assert.ok(events.some((entry) => entry.kind === "ENDED" && entry.assignmentId === upcoming.value.id));
  assert.equal((await fx.deps.courses.listAssignments(course.value.id)).length, 1);

  const stillThere = await fx.deps.courses.getAssignment(upcoming.value.id);
  assert.ok(stillThere);
  const second = await endTeacherAssignment(fx.deps, upcoming.value.id, "admin-1", "2027-10-01");
  assert.equal(second.ok, false);
  if (!second.ok) assert.equal(second.status, 409);

  const otherClass = await fx.catalog.createClass({
    code: "MMA1C",
    label: "MMA 1C",
    schoolYearId: "year-2027",
    schoolYearLabel: "2027-2028",
    professionId: fx.profession.id,
    trainingYear: 1,
    parallelCode: "C",
  });
  const otherCourse = await createAnnualCourse(fx.deps, {
    schoolYearId: "year-2027",
    classId: otherClass.id,
    contextId: fx.context.id,
  });
  assert.equal(otherCourse.ok, true);
  if (!otherCourse.ok) return;
  const active = await assignTeacherToCourse(fx.deps, {
    annualCourseId: otherCourse.value.id,
    teacherId: fx.paul.id,
    role: "PRIMARY",
    createdByAdminId: "admin-1",
    validFrom: "2026-01-01",
  });
  assert.equal(active.ok, true);
  if (!active.ok) return;
  assert.equal(assignmentLifecycle(active.value), "active");
  assert.equal(effectiveAtForEndAssignment(active.value), undefined);
  const endedNow = await endTeacherAssignment(fx.deps, active.value.id, "admin-1");
  assert.equal(endedNow.ok, true);
  if (!endedNow.ok) return;
  assert.ok(endedNow.value.endedAt);
  assert.equal(isAssignmentActiveAt(endedNow.value), false);
  const againActive = await endTeacherAssignment(fx.deps, active.value.id, "admin-1");
  assert.equal(againActive.ok, false);
  if (!againActive.ok) assert.equal(againActive.status, 409);
});

test("Agenda — accès, fallback, archivé, admin, homonymes", async () => {
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
  const resolved = resolveAnnualCourseForPublication({
    classroomName: "MMA 1A",
    subjectName: fx.moteur.label,
    classes: await fx.catalog.listClasses(),
    branches: await fx.catalog.listBranches(),
    contexts: await fx.catalog.listContexts(),
    courses: await fx.deps.courses.listCourses(),
  });
  assert.ok(resolved);

  assert.equal(decideAgendaPublishAccess({
    resolved,
    teacher: fx.francois,
    assignments,
    legacyMembershipAllows: false,
  }), true);
  assert.equal(decideAgendaPublishAccess({
    resolved,
    teacher: fx.paul,
    assignments,
    legacyMembershipAllows: true,
  }), false);
  assert.equal(decideAgendaPublishAccess({
    resolved: null,
    teacher: fx.paul,
    assignments,
    legacyMembershipAllows: true,
  }), true);

  await archiveAnnualCourse(fx.deps, course.value.id);
  const archivedResolved = resolveAnnualCourseForPublication({
    classroomName: "MMA 1A",
    subjectName: fx.moteur.label,
    classes: await fx.catalog.listClasses(),
    branches: await fx.catalog.listBranches(),
    contexts: await fx.catalog.listContexts(),
    courses: await fx.deps.courses.listCourses(),
  });
  assert.equal(archivedResolved?.course.isArchived, true);
  assert.equal(decideAgendaPublishAccess({
    resolved: archivedResolved,
    teacher: fx.francois,
    assignments,
    legacyMembershipAllows: true,
  }), false);

  assert.equal(teacherCanAccessAnnualCourse({
    teacher: fx.admin,
    course: archivedResolved!.course,
    assignments,
    isAdmin: true,
  }), true);
  const disabledAdmin = { ...fx.admin, isActive: false };
  assert.equal(teacherCanAccessAnnualCourse({
    teacher: disabledAdmin,
    course: archivedResolved!.course,
    assignments,
    isAdmin: true,
  }), false);
  const archivedAdmin = { ...fx.admin, isArchived: true };
  assert.equal(teacherCanAccessAnnualCourse({
    teacher: archivedAdmin,
    course: course.value,
    assignments,
    isAdmin: true,
  }), false);

  await fx.catalog.createBranch({
    code: "HYD1",
    label: "Hydraulique",
    teachingType: "TECHNICAL",
  });
  await fx.catalog.createBranch({
    code: "HYD2",
    label: "Hydraulique",
    teachingType: "TECHNICAL",
  });
  const ambiguous = resolveAnnualCourseForPublication({
    classroomName: "MMA 1A",
    subjectName: "Hydraulique",
    classes: await fx.catalog.listClasses(),
    branches: await fx.catalog.listBranches(),
    contexts: await fx.catalog.listContexts(),
    courses: await fx.deps.courses.listCourses(),
  });
  assert.equal(ambiguous, null);
});

test("SQLite — 0018 puis 0019 rejouée, remplacement futur, historique", async () => {
  const db = createNodeSqliteDatabase(":memory:");
  await applyMigrations(db, { until: "0018_admin_referential_coherence.sql" });
  await applyMigrations(db, { until: "0019_annual_courses_teacher_assignments.sql" });
  await applyMigrations(db);

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
  const schoolClass = await catalog.createClass({
    code: "MMA1A",
    label: "MMA 1A",
    schoolYearId: "sy-sql",
    schoolYearLabel: "2027-2028",
    professionId: profession.id,
    trainingYear: 1,
  });
  const teachers = new SqlTeacherAccountStore(db);
  const francois = await teachers.createAccount({
    displayName: "François SQL",
    initials: "RfS",
    teachingType: "TECHNICAL",
  });
  const paul = await teachers.createAccount({
    displayName: "Paul SQL",
    initials: "RpS",
    teachingType: "TECHNICAL",
  });
  const marc = await teachers.createAccount({
    displayName: "Marc SQL",
    initials: "RmS",
    teachingType: "TECHNICAL",
  });
  assert.equal(francois.ok && paul.ok && marc.ok, true);
  if (!francois.ok || !paul.ok || !marc.ok) return;

  const deps: AnnualCourseServiceDeps = {
    courses: new SqlAnnualCourseStore(db),
    catalog,
    years: yearsStub("sy-sql"),
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
  await assignTeacherToCourse(deps, {
    annualCourseId: course.value.id,
    teacherId: francois.account.id,
    role: "PRIMARY",
    createdByAdminId: "admin-sql",
    validFrom: "2027-08-01",
  });
  const replaced = await replaceTeacherDefinitively(deps, {
    annualCourseId: course.value.id,
    outgoingTeacherId: francois.account.id,
    incomingTeacherId: paul.account.id,
    createdByAdminId: "admin-sql",
    effectiveAt: "2027-10-01",
  });
  assert.equal(replaced.ok, true);
  const assignments = await deps.courses.listAssignments(course.value.id);
  const out = assignments.find((entry) => entry.teacherId === francois.account.id)!;
  const incoming = assignments.find((entry) => entry.teacherId === paul.account.id)!;
  assert.equal(isAssignmentActiveAt(out, "2027-09-15T12:00:00.000Z"), true);
  assert.equal(isAssignmentActiveAt(incoming, "2027-09-15T12:00:00.000Z"), false);
  assert.equal(isAssignmentActiveAt(out, "2027-10-01T00:00:00.000Z"), false);
  assert.equal(isAssignmentActiveAt(incoming, "2027-10-01T00:00:00.000Z"), true);

  const retro = await assignTeacherToCourse(deps, {
    annualCourseId: course.value.id,
    teacherId: marc.account.id,
    role: "PRIMARY",
    createdByAdminId: "admin-sql",
    validFrom: "2027-09-15",
    validTo: "2027-09-20",
  });
  assert.equal(retro.ok, false);

  const nov = await assignTemporaryReplacement(deps, {
    annualCourseId: course.value.id,
    teacherId: marc.account.id,
    createdByAdminId: "admin-sql",
    validFrom: "2027-11-03",
    validTo: "2027-11-20",
  });
  const jan = await assignTemporaryReplacement(deps, {
    annualCourseId: course.value.id,
    teacherId: marc.account.id,
    createdByAdminId: "admin-sql",
    validFrom: "2028-01-10",
    validTo: "2028-01-20",
  });
  assert.equal(nov.ok && jan.ok, true);

  db.close();
});
