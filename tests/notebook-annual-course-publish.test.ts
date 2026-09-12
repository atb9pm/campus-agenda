import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { PrototypeAgendaItem } from "../src/features/agenda/demo-items.ts";
import { isStructuredAgendaPublication } from "../src/features/agenda/publications.ts";
import {
  archiveAnnualCourse,
  assignTeacherToCourse,
  createAnnualCourse,
  endTeacherAssignment,
  type AnnualCourseServiceDeps,
} from "../src/features/annual-courses/index.ts";
import { runtimeClassroomIdForSchoolClass, runtimeSubjectIdForAnnualCourse } from "../src/features/agenda-bridge/index.ts";
import {
  NOTEBOOK_PUBLISH_ARCHIVED,
  NOTEBOOK_PUBLISH_CLASS_UNAVAILABLE,
  NOTEBOOK_PUBLISH_FUTURE,
  NOTEBOOK_PUBLISH_NOT_ASSIGNED,
  NOTEBOOK_PUBLISH_YEAR_INACTIVE,
  authorizeNotebookOwnedItemMutation,
  createNotebookPublication,
  evaluateNotebookPublishAccess,
  filterNotebookItemsForSubject,
  implicitNotebookPublishCourse,
  isCarnetOwnedPublication,
  notebookPublishBlockedReason,
  planCarnetWeekPublicationSave,
  resolveNotebookClassroomId,
  sanitizeRichDoc,
  workspaceAllowsNotebookPublish,
  type NotebookPublicationDeps,
} from "../src/features/class-notebook/index.ts";
import { APP_VERSION } from "../src/lib/app-version.ts";
import { createNodeSqliteDatabase } from "../src/lib/persistence/sql/adapters.ts";
import { applyMigrations, SQL_MIGRATION_FILES } from "../src/lib/persistence/sql/migrate.ts";
import { SqlAgendaStore } from "../src/lib/persistence/sql/sql-agenda-store.ts";
import { SqlAnnualCourseStore } from "../src/lib/persistence/sql/sql-annual-course-store.ts";
import { SqlCourseScheduleStore } from "../src/lib/persistence/sql/sql-course-schedule-store.ts";
import { SqlAnnualCourseNotesStore } from "../src/lib/persistence/sql/sql-pedagogical-path-store.ts";
import { SqlRuntimeAgendaAdapterStore } from "../src/lib/persistence/sql/sql-runtime-adapter-store.ts";
import { SqlSchoolCatalogStore } from "../src/lib/persistence/sql/sql-school-catalog-store.ts";
import { SqlTeacherAccountStore } from "../src/lib/persistence/sql/sql-teacher-account-store.ts";
import type { SchoolYearStore } from "../src/lib/persistence/school-year-types.ts";
import type { SchoolYearRecord } from "../src/features/school-year/types.ts";
import type { TeacherCourseAssignment } from "../src/features/annual-courses/types.ts";

const ACTIVE_ID = "year-2026";
const DRAFT_ID = "year-2028";
const AT = "2026-09-11T12:00:00.000Z";
const BRANCH_LABEL = "CP Léger Injection, dépollution";

function assignment(
  patch: Pick<TeacherCourseAssignment, "id" | "annualCourseId" | "teacherId"> &
    Partial<TeacherCourseAssignment>,
): TeacherCourseAssignment {
  return {
    role: "PRIMARY",
    validFrom: "2026-08-01T00:00:00.000Z",
    validTo: null,
    createdByAdminId: "admin-1",
    createdAt: "2026-08-01T00:00:00.000Z",
    endedAt: null,
    overrideReason: null,
    overrideByAdminId: null,
    ...patch,
  };
}

function yearsStub(): SchoolYearStore {
  const active: SchoolYearRecord = {
    id: ACTIVE_ID,
    label: "2026-2027",
    status: "active",
    startsOn: "2026-08-01",
    endsOn: "2027-07-31",
    sourceFilename: null,
    importedAt: null,
    activatedAt: "2026-08-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  const draft: SchoolYearRecord = {
    id: DRAFT_ID,
    label: "2028-2029",
    status: "draft",
    startsOn: "2028-08-01",
    endsOn: "2029-07-31",
    sourceFilename: null,
    importedAt: null,
    activatedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  return {
    listSchoolYears: async () => [active, draft],
    getActiveSchoolYear: async () => ({ ...active, weeks: [] }),
    getSchoolYearById: async (id: string) => {
      if (id === ACTIVE_ID) return { ...active, weeks: [] };
      if (id === DRAFT_ID) return { ...draft, weeks: [] };
      return null;
    },
  } as SchoolYearStore;
}

interface World {
  adapters: SqlRuntimeAgendaAdapterStore;
  agenda: SqlAgendaStore;
  catalog: SqlSchoolCatalogStore;
  courses: SqlAnnualCourseStore;
  years: SchoolYearStore;
  teachers: SqlTeacherAccountStore;
  courseDeps: AnnualCourseServiceDeps;
  publishDeps: NotebookPublicationDeps;
  close: () => void;
}

async function sqliteWorld(): Promise<World> {
  const db = createNodeSqliteDatabase(":memory:");
  await applyMigrations(db);
  await db.exec(
    `INSERT OR IGNORE INTO school_years (id, label, status, starts_on, ends_on, created_at)
     VALUES
       ('${ACTIVE_ID}', '2026-2027', 'active', '2026-08-01', '2027-07-31', datetime('now')),
       ('${DRAFT_ID}', '2028-2029', 'draft', '2028-08-01', '2029-07-31', datetime('now'))`,
  );
  const catalog = new SqlSchoolCatalogStore(db);
  await catalog.ensureSeeded();
  const adapters = new SqlRuntimeAgendaAdapterStore(db);
  const agenda = new SqlAgendaStore(db);
  const courses = new SqlAnnualCourseStore(db);
  const years = yearsStub();
  const teachers = new SqlTeacherAccountStore(db);
  const schedules = new SqlCourseScheduleStore(db);
  const notes = new SqlAnnualCourseNotesStore(db);
  const courseDeps: AnnualCourseServiceDeps = {
    courses,
    catalog,
    years,
    teachers,
    notes,
    schedules,
    agenda,
  };
  const publishDeps: NotebookPublicationDeps = {
    courses,
    catalog,
    years,
    adapters,
    agenda,
  };
  return {
    adapters,
    agenda,
    catalog,
    courses,
    years,
    teachers,
    courseDeps,
    publishDeps,
    close: () => db.close(),
  };
}

async function seedMecauto(world: World) {
  const profession = await world.catalog.createProfession({
    label: "Mécanicien automobiles",
    durationYears: 4,
  });
  const branch = await world.catalog.createBranch({
    code: `CPL-${Math.random().toString(36).slice(2, 6)}`,
    label: BRANCH_LABEL,
    teachingType: "TECHNICAL",
  });
  const ctx = await world.catalog.createContext({
    professionId: profession.id,
    trainingYear: 3,
    branchId: branch.id,
  });
  assert.equal(ctx.ok, true);
  if (!ctx.ok) throw new Error(ctx.reason);

  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  const classA = await world.catalog.createClass({
    code: `MECAUTO3A-${suffix}`,
    label: "MECAUTO3A",
    schoolYearId: ACTIVE_ID,
    schoolYearLabel: "2026-2027",
    professionId: profession.id,
    trainingYear: 3,
    parallelCode: "A",
  });
  const classB = await world.catalog.createClass({
    code: `MECAUTO3B-${suffix}`,
    label: "MECAUTO3B",
    schoolYearId: ACTIVE_ID,
    schoolYearLabel: "2026-2027",
    professionId: profession.id,
    trainingYear: 3,
    parallelCode: "B",
  });

  const francois = await world.teachers.createAccount({
    displayName: "François Cheseaux",
    initials: `FC${Math.random().toString(36).slice(2, 4)}`,
    teachingType: "TECHNICAL",
  });
  const patrick = await world.teachers.createAccount({
    displayName: "Patrick",
    initials: `PA${Math.random().toString(36).slice(2, 4)}`,
    teachingType: "TECHNICAL",
  });
  const admin = await world.teachers.createAccount({
    displayName: "Admin",
    initials: `AD${Math.random().toString(36).slice(2, 4)}`,
    teachingType: "TECHNICAL",
    isAdmin: true,
  });
  assert.equal(francois.ok && patrick.ok && admin.ok, true);
  if (!francois.ok || !patrick.ok || !admin.ok) throw new Error("enseignants");

  const courseA = await createAnnualCourse(world.courseDeps, {
    schoolYearId: ACTIVE_ID,
    classId: classA.id,
    contextId: ctx.value.id,
  });
  const courseB = await createAnnualCourse(world.courseDeps, {
    schoolYearId: ACTIVE_ID,
    classId: classB.id,
    contextId: ctx.value.id,
  });
  assert.equal(courseA.ok && courseB.ok, true);
  if (!courseA.ok || !courseB.ok) throw new Error("cours");

  await assignTeacherToCourse(world.courseDeps, {
    annualCourseId: courseA.value.id,
    teacherId: francois.account.id,
    role: "PRIMARY",
    createdByAdminId: admin.account.id,
    validFrom: "2026-08-01",
  });
  await assignTeacherToCourse(world.courseDeps, {
    annualCourseId: courseB.value.id,
    teacherId: francois.account.id,
    role: "PRIMARY",
    createdByAdminId: admin.account.id,
    validFrom: "2026-08-01",
  });

  return {
    classA,
    classB,
    courseA: courseA.value,
    courseB: courseB.value,
    francois: francois.account,
    patrick: patrick.account,
    admin: admin.account,
    branch,
  };
}

async function assertNoRuntimeSubject(world: World, annualCourseId: string) {
  assert.equal(await world.adapters.findSubjectByAnnualCourseId(annualCourseId), null);
}

test("version 2.52.2 — AnnualCourse attribué suffit pour publier, sans migration", async () => {
  assert.equal(APP_VERSION, "2.53.1");
  assert.equal(SQL_MIGRATION_FILES.at(-1), "0029_admin_mfa.sql");
  const [page, resolveSource, notesApi, notesStorage, controlsPanel, agendaIdRoute] = await Promise.all([
    readFile(new URL("../web/app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/class-notebook/resolve.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/app/api/teacher/notes/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/class-notebook/notes-storage.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/app/components/class-notebook-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/api/agenda/[id]/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /createNotebookPublicationApi/);
  assert.match(page, /workspaceAllowsNotebookPublish/);
  assert.match(page, /notebookPublishAnnualCourseId/);
  assert.doesNotMatch(page, /notebookCanPublish = Boolean\(notebookClassroomId && notebookSubjectId\)/);
  assert.doesNotMatch(page, /notebookUnlinkedCourseReason/);
  assert.match(resolveSource, /runtimeClassroomIdForSchoolClass/);
  assert.match(notesApi, /requireTeacherSession/);
  assert.doesNotMatch(notesStorage, /subjectId/);
  assert.match(controlsPanel, /Contrôles/);
  assert.match(controlsPanel, /onSaveControl/);
  assert.match(agendaIdRoute, /export async function DELETE/);
  assert.match(agendaIdRoute, /authorizeNotebookOwnedItemMutation/);
  const deleteFn = agendaIdRoute.slice(agendaIdRoute.indexOf("export async function DELETE"));
  assert.match(deleteFn, /authorizeNotebookOwnedItemMutation/);
});

test("droit de publication — AnnualCourse attribué, sans Subject runtime", () => {
  const course = {
    id: "ac-3a",
    schoolYearId: ACTIVE_ID,
    classId: "sc-3a",
    isArchived: false,
  };
  const schoolClass = {
    id: "sc-3a",
    isActive: true,
    isArchived: false,
    schoolYearId: ACTIVE_ID,
  };
  const activeYear = { id: ACTIVE_ID, status: "active" as const };
  const allowed = evaluateNotebookPublishAccess({
    teacherId: "teacher-francois",
    annualCourse: course,
    schoolClass,
    activeYear,
    assignments: [assignment({ id: "a1", annualCourseId: "ac-3a", teacherId: "teacher-francois" })],
    at: AT,
  });
  assert.equal(allowed.canPublish, true);

  assert.equal(
    evaluateNotebookPublishAccess({
      teacherId: "teacher-patrick",
      annualCourse: course,
      schoolClass,
      activeYear,
      assignments: [assignment({ id: "a1", annualCourseId: "ac-3a", teacherId: "teacher-francois" })],
      at: AT,
    }).canPublish,
    false,
  );

  const future = evaluateNotebookPublishAccess({
    teacherId: "teacher-francois",
    annualCourse: course,
    schoolClass,
    activeYear,
    assignments: [
      assignment({
        id: "a-future",
        annualCourseId: "ac-3a",
        teacherId: "teacher-francois",
        validFrom: "2026-10-01T00:00:00.000Z",
      }),
    ],
    at: AT,
  });
  assert.deepEqual(future, { canPublish: false, reason: NOTEBOOK_PUBLISH_FUTURE });

  const ended = evaluateNotebookPublishAccess({
    teacherId: "teacher-francois",
    annualCourse: course,
    schoolClass,
    activeYear,
    assignments: [
      assignment({
        id: "a-ended",
        annualCourseId: "ac-3a",
        teacherId: "teacher-francois",
        endedAt: "2026-09-01T00:00:00.000Z",
        validTo: "2026-09-01T00:00:00.000Z",
      }),
    ],
    at: AT,
  });
  assert.equal(ended.canPublish, false);
  assert.equal(ended.reason, NOTEBOOK_PUBLISH_NOT_ASSIGNED);

  assert.deepEqual(
    evaluateNotebookPublishAccess({
      teacherId: "teacher-francois",
      annualCourse: { ...course, isArchived: true },
      schoolClass,
      activeYear,
      assignments: [assignment({ id: "a1", annualCourseId: "ac-3a", teacherId: "teacher-francois" })],
      at: AT,
    }),
    { canPublish: false, reason: NOTEBOOK_PUBLISH_ARCHIVED },
  );

  assert.deepEqual(
    evaluateNotebookPublishAccess({
      teacherId: "teacher-francois",
      annualCourse: { ...course, schoolYearId: DRAFT_ID },
      schoolClass: { ...schoolClass, schoolYearId: DRAFT_ID },
      activeYear,
      assignments: [assignment({ id: "a1", annualCourseId: "ac-3a", teacherId: "teacher-francois" })],
      at: AT,
    }),
    { canPublish: false, reason: NOTEBOOK_PUBLISH_YEAR_INACTIVE },
  );

  assert.deepEqual(
    evaluateNotebookPublishAccess({
      teacherId: "teacher-francois",
      annualCourse: course,
      schoolClass: { ...schoolClass, isActive: false },
      activeYear,
      assignments: [assignment({ id: "a1", annualCourseId: "ac-3a", teacherId: "teacher-francois" })],
      at: AT,
    }),
    { canPublish: false, reason: NOTEBOOK_PUBLISH_CLASS_UNAVAILABLE },
  );
});

test("UI — un AnnualCourse ouvert n’affiche jamais « aucune branche enseignée »", () => {
  assert.equal(
    notebookPublishBlockedReason({
      hasOpenClass: true,
      annualCourseId: "ac-3a",
      assignedToCourse: true,
      classroomId: null,
      subjectId: null,
    }),
    undefined,
  );
  assert.equal(
    notebookPublishBlockedReason({
      hasOpenClass: true,
      annualCourseId: "ac-3a",
      assignedToCourse: false,
      classroomId: null,
      subjectId: null,
    }),
    NOTEBOOK_PUBLISH_NOT_ASSIGNED,
  );
  assert.match(
    notebookPublishBlockedReason({
      hasOpenClass: true,
      annualCourseId: null,
      assignedToCourse: false,
      classroomId: "rt-1",
      subjectId: null,
    }) ?? "",
    /Aucune branche enseignée/,
  );
  assert.equal(workspaceAllowsNotebookPublish([{ annualCourseId: "ac-3a" }], "ac-3a"), true);
  assert.equal(workspaceAllowsNotebookPublish([{ annualCourseId: "ac-3a" }], "ac-3b"), false);
  assert.equal(
    implicitNotebookPublishCourse(
      [
        { classId: "sc-3a", annualCourseId: "ac-3a" },
        { classId: "sc-3b", annualCourseId: "ac-3b" },
      ],
      "sc-3b",
    )?.annualCourseId,
    "ac-3b",
  );
});

test("filtre — annualCourseId sépare 3A / 3B ; legacy subjectId reste lisible", () => {
  const items: PrototypeAgendaItem[] = [
    {
      id: 1,
      classroomId: "rt-3a",
      subjectId: "legacy-subj",
      authorTeacherId: "teacher-francois",
      day: 0,
      hour: 8,
      weekOffset: 0,
      schoolWeekNumber: 4,
      type: "HOMEWORK",
      title: "Legacy 3A",
      detail: "",
    },
    {
      id: 2,
      classroomId: "rt-3a",
      subjectId: "subject-course-ac-3a",
      authorTeacherId: "teacher-francois",
      day: 0,
      hour: 8,
      weekOffset: 0,
      schoolWeekNumber: 4,
      type: "HOMEWORK",
      title: "Structurée 3A",
      detail: "",
      annualCourseId: "ac-3a",
    },
    {
      id: 3,
      classroomId: "rt-3b",
      subjectId: "subject-course-ac-3b",
      authorTeacherId: "teacher-francois",
      day: 0,
      hour: 8,
      weekOffset: 0,
      schoolWeekNumber: 4,
      type: "HOMEWORK",
      title: "Structurée 3B",
      detail: "",
      annualCourseId: "ac-3b",
    },
  ];

  const for3a = filterNotebookItemsForSubject(items, {
    classroomId: "rt-3a",
    teacherId: "teacher-francois",
    subjectId: "legacy-subj",
    annualCourseId: "ac-3a",
    restrictToSubject: true,
  });
  assert.deepEqual(
    for3a.map((entry) => entry.title),
    ["Legacy 3A", "Structurée 3A"],
  );

  const for3b = filterNotebookItemsForSubject(items, {
    classroomId: "rt-3b",
    teacherId: "teacher-francois",
    subjectId: null,
    annualCourseId: "ac-3b",
    restrictToSubject: true,
  });
  assert.deepEqual(
    for3b.map((entry) => entry.title),
    ["Structurée 3B"],
  );
});

test("classroom runtime — pont déterministe si aucune salle préexistante", () => {
  const classroomId = resolveNotebookClassroomId(
    { id: "sc-mecauto3b", name: "MECAUTO3B" },
    [],
    { classrooms: [], subjects: [], memberships: [], teachers: [] },
    "sc-mecauto3b",
  );
  assert.equal(classroomId, runtimeClassroomIdForSchoolClass("sc-mecauto3b"));
});

test("MECAUTO3A — publication sans Subject runtime, annualCourseId conservé", async () => {
  const world = await sqliteWorld();
  try {
    const seeded = await seedMecauto(world);
    await assertNoRuntimeSubject(world, seeded.courseA.id);

    const created = await createNotebookPublication(world.publishDeps, {
      teacherId: seeded.francois.id,
      annualCourseId: seeded.courseA.id,
      schoolWeekNumber: 4,
      day: 0,
      type: "HOMEWORK",
      title: "Injection semaine 4",
      detail: "",
      at: AT,
    });
    assert.equal(created.ok, true);
    if (!created.ok) throw new Error(created.reason);
    assert.equal(created.value.annualCourseId, seeded.courseA.id);
    assert.equal(created.value.schoolYearId, ACTIVE_ID);
    assert.equal(created.value.classroomId, runtimeClassroomIdForSchoolClass(seeded.classA.id));
    assert.equal(created.value.subjectId, runtimeSubjectIdForAnnualCourse(seeded.courseA.id));
    assert.equal(created.value.authorTeacherId, seeded.francois.id);
    assert.equal(created.value.schoolWeekNumber, 4);
    assert.equal(created.value.courseSessionKey ?? null, null);
    assert.equal(isCarnetOwnedPublication(created.value), true);
    assert.equal(isStructuredAgendaPublication(created.value), false);

    const reloaded = await world.agenda.findAgendaItem(created.value.id);
    assert.equal(reloaded?.annualCourseId, seeded.courseA.id);
    assert.equal(reloaded?.title, "Injection semaine 4");
  } finally {
    world.close();
  }
});

test("MECAUTO3B — sans classroom runtime préexistant, pont déterministe", async () => {
  const world = await sqliteWorld();
  try {
    const seeded = await seedMecauto(world);
    assert.equal(await world.adapters.findClassroomBySchoolClassId(seeded.classB.id), null);
    await assertNoRuntimeSubject(world, seeded.courseB.id);

    const created = await createNotebookPublication(world.publishDeps, {
      teacherId: seeded.francois.id,
      annualCourseId: seeded.courseB.id,
      schoolWeekNumber: 5,
      day: 1,
      type: "HOMEWORK",
      title: "Dépollution 3B",
      detail: "",
      at: AT,
    });
    assert.equal(created.ok, true);
    if (!created.ok) throw new Error(created.reason);
    assert.equal(created.value.annualCourseId, seeded.courseB.id);
    assert.equal(created.value.classroomId, runtimeClassroomIdForSchoolClass(seeded.classB.id));
    assert.notEqual(created.value.annualCourseId, seeded.courseA.id);
  } finally {
    world.close();
  }
});

test("séparation MECAUTO3A / MECAUTO3B — même libellé, AnnualCourse.id distincts", async () => {
  const world = await sqliteWorld();
  try {
    const seeded = await seedMecauto(world);
    const pubA = await createNotebookPublication(world.publishDeps, {
      teacherId: seeded.francois.id,
      annualCourseId: seeded.courseA.id,
      schoolWeekNumber: 6,
      day: 0,
      type: "HOMEWORK",
      title: "Pub 3A",
      detail: "",
      at: AT,
    });
    const pubB = await createNotebookPublication(world.publishDeps, {
      teacherId: seeded.francois.id,
      annualCourseId: seeded.courseB.id,
      schoolWeekNumber: 6,
      day: 0,
      type: "HOMEWORK",
      title: "Pub 3B",
      detail: "",
      at: AT,
    });
    assert.equal(pubA.ok && pubB.ok, true);
    if (!pubA.ok || !pubB.ok) throw new Error("pubs");
    assert.notEqual(pubA.value.annualCourseId, pubB.value.annualCourseId);
    assert.notEqual(pubA.value.classroomId, pubB.value.classroomId);
    assert.equal(pubA.value.annualCourseId, seeded.courseA.id);
    assert.equal(pubB.value.annualCourseId, seeded.courseB.id);

    const listedA = await world.agenda.listAgendaItems(pubA.value.classroomId);
    const listedB = await world.agenda.listAgendaItems(pubB.value.classroomId);
    assert.equal(listedA.some((item) => item.title === "Pub 3B"), false);
    assert.equal(listedB.some((item) => item.title === "Pub 3A"), false);
  } finally {
    world.close();
  }
});

test("Patrick non attribué — publication interdite", async () => {
  const world = await sqliteWorld();
  try {
    const seeded = await seedMecauto(world);
    const denied = await createNotebookPublication(world.publishDeps, {
      teacherId: seeded.patrick.id,
      annualCourseId: seeded.courseA.id,
      schoolWeekNumber: 4,
      day: 0,
      type: "HOMEWORK",
      title: "Tentative Patrick",
      detail: "",
      at: AT,
    });
    assert.equal(denied.ok, false);
    if (denied.ok) throw new Error("devrait refuser");
    assert.equal(denied.reason, NOTEBOOK_PUBLISH_NOT_ASSIGNED);
    assert.equal(denied.status, 403);
  } finally {
    world.close();
  }
});

test("attribution future / terminée / active", async () => {
  const world = await sqliteWorld();
  try {
    const seeded = await seedMecauto(world);
    const existing = await world.courses.listAssignments(seeded.courseA.id);
    const current = existing.find((entry) => entry.teacherId === seeded.francois.id);
    assert.ok(current);
    await endTeacherAssignment(world.courseDeps, current!.id, seeded.admin.id, "2026-09-01T00:00:00.000Z");

    const ended = await createNotebookPublication(world.publishDeps, {
      teacherId: seeded.francois.id,
      annualCourseId: seeded.courseA.id,
      schoolWeekNumber: 4,
      day: 0,
      type: "HOMEWORK",
      title: "Après fin",
      detail: "",
      at: AT,
    });
    assert.equal(ended.ok, false);
    if (ended.ok) throw new Error("ended");
    assert.equal(ended.reason, NOTEBOOK_PUBLISH_NOT_ASSIGNED);

    await assignTeacherToCourse(world.courseDeps, {
      annualCourseId: seeded.courseA.id,
      teacherId: seeded.francois.id,
      role: "PRIMARY",
      createdByAdminId: seeded.admin.id,
      validFrom: "2026-10-01",
    });
    const future = await createNotebookPublication(world.publishDeps, {
      teacherId: seeded.francois.id,
      annualCourseId: seeded.courseA.id,
      schoolWeekNumber: 4,
      day: 0,
      type: "HOMEWORK",
      title: "Avant validFrom",
      detail: "",
      at: AT,
    });
    assert.equal(future.ok, false);
    if (future.ok) throw new Error("future");
    assert.equal(future.reason, NOTEBOOK_PUBLISH_FUTURE);

    const active = await createNotebookPublication(world.publishDeps, {
      teacherId: seeded.francois.id,
      annualCourseId: seeded.courseA.id,
      schoolWeekNumber: 4,
      day: 0,
      type: "HOMEWORK",
      title: "Dès maintenant",
      detail: "",
      at: "2026-10-01T00:00:00.000Z",
    });
    assert.equal(active.ok, true);
  } finally {
    world.close();
  }
});

test("DRAFT 2028–2029 — non publiable dans l’espace enseignant", async () => {
  const world = await sqliteWorld();
  try {
    const seeded = await seedMecauto(world);
    const draftClass = await world.catalog.createClass({
      code: `MECAUTO3A-28-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      label: "MECAUTO3A",
      schoolYearId: DRAFT_ID,
      schoolYearLabel: "2028-2029",
      professionId: seeded.classA.professionId,
      trainingYear: 3,
      parallelCode: "A",
    });
    const draftCourse = await world.courses.createCourse({
      id: "ac-draft-3a",
      schoolYearId: DRAFT_ID,
      classId: draftClass.id,
      contextId: seeded.courseA.contextId,
      isArchived: false,
      archivedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await world.courses.createAssignment({
      id: "as-draft",
      annualCourseId: draftCourse.id,
      teacherId: seeded.francois.id,
      role: "PRIMARY",
      validFrom: "2028-08-01T00:00:00.000Z",
      validTo: null,
      createdByAdminId: seeded.admin.id,
      createdAt: "2026-01-01T00:00:00.000Z",
      endedAt: null,
      overrideReason: null,
      overrideByAdminId: null,
    });
    const denied = await createNotebookPublication(world.publishDeps, {
      teacherId: seeded.francois.id,
      annualCourseId: draftCourse.id,
      schoolWeekNumber: 1,
      day: 0,
      type: "HOMEWORK",
      title: "Brouillon",
      detail: "",
      at: AT,
    });
    assert.equal(denied.ok, false);
    if (denied.ok) throw new Error("draft");
    assert.equal(denied.reason, NOTEBOOK_PUBLISH_YEAR_INACTIVE);
  } finally {
    world.close();
  }
});

test("publication riche PR #91 — sauvegarde / reload carnet-owned", async () => {
  const world = await sqliteWorld();
  try {
    const seeded = await seedMecauto(world);
    const doc = sanitizeRichDoc({
      format: "campus-rich-v1",
      blocks: [{ type: "heading", inlines: [{ text: "Injection", marks: { bold: true } }] }],
    });
    const plan = planCarnetWeekPublicationSave([], doc);
    assert.equal(plan.action, "create");
    if (plan.action !== "create") throw new Error("plan");

    const created = await createNotebookPublication(world.publishDeps, {
      teacherId: seeded.francois.id,
      annualCourseId: seeded.courseA.id,
      schoolWeekNumber: 7,
      day: 0,
      type: "HOMEWORK",
      title: plan.payload.title,
      detail: plan.payload.detail,
      at: AT,
    });
    assert.equal(created.ok, true);
    if (!created.ok) throw new Error(created.reason);
    assert.equal(isCarnetOwnedPublication(created.value), true);
    assert.equal(created.value.courseSessionKey ?? null, null);

    const weekItems = [created.value];
    const again = planCarnetWeekPublicationSave(weekItems, doc);
    assert.equal(again.action, "update");
    if (again.action !== "update") throw new Error("update plan");
    assert.equal(again.updateId, created.value.id);
  } finally {
    world.close();
  }
});

test("cours archivé — publication interdite", async () => {
  const world = await sqliteWorld();
  try {
    const seeded = await seedMecauto(world);
    const archived = await archiveAnnualCourse(world.courseDeps, seeded.courseA.id);
    assert.equal(archived.ok, true);
    const denied = await createNotebookPublication(world.publishDeps, {
      teacherId: seeded.francois.id,
      annualCourseId: seeded.courseA.id,
      schoolWeekNumber: 4,
      day: 0,
      type: "HOMEWORK",
      title: "Archivé",
      detail: "",
      at: AT,
    });
    assert.equal(denied.ok, false);
    if (denied.ok) throw new Error("archived");
    assert.equal(denied.reason, NOTEBOOK_PUBLISH_ARCHIVED);
  } finally {
    world.close();
  }
});

/** Même porte que DELETE /api/agenda/[id] pour une publication Carnet. */
async function deleteAgendaItemWithNotebookGate(
  world: World,
  teacherId: string,
  item: PrototypeAgendaItem,
  at = AT,
): Promise<{ ok: true } | { ok: false; reason: string; status: number }> {
  const notebookOwned = await authorizeNotebookOwnedItemMutation(world.publishDeps, {
    teacherId,
    item,
    at,
  });
  if (notebookOwned && !notebookOwned.ok) {
    return notebookOwned;
  }
  const result = await world.agenda.deleteAgendaItem(item.id, teacherId);
  if (!result.ok) {
    return { ok: false, reason: result.reason, status: result.status };
  }
  return { ok: true };
}

test("DELETE Carnet — affectation active autorise la suppression", async () => {
  const world = await sqliteWorld();
  try {
    const seeded = await seedMecauto(world);
    const created = await createNotebookPublication(world.publishDeps, {
      teacherId: seeded.francois.id,
      annualCourseId: seeded.courseA.id,
      schoolWeekNumber: 8,
      day: 0,
      type: "HOMEWORK",
      title: "À retirer",
      detail: "",
      at: AT,
    });
    assert.equal(created.ok, true);
    if (!created.ok) throw new Error(created.reason);

    const deleted = await deleteAgendaItemWithNotebookGate(world, seeded.francois.id, created.value);
    assert.equal(deleted.ok, true);
    assert.equal(await world.agenda.findAgendaItem(created.value.id), undefined);
  } finally {
    world.close();
  }
});

test("DELETE Carnet — attribution terminée → 403", async () => {
  const world = await sqliteWorld();
  try {
    const seeded = await seedMecauto(world);
    const created = await createNotebookPublication(world.publishDeps, {
      teacherId: seeded.francois.id,
      annualCourseId: seeded.courseA.id,
      schoolWeekNumber: 8,
      day: 0,
      type: "HOMEWORK",
      title: "Après fin d’attribution",
      detail: "",
      at: AT,
    });
    assert.equal(created.ok, true);
    if (!created.ok) throw new Error(created.reason);

    const current = (await world.courses.listAssignments(seeded.courseA.id)).find(
      (entry) => entry.teacherId === seeded.francois.id,
    );
    assert.ok(current);
    await endTeacherAssignment(world.courseDeps, current!.id, seeded.admin.id, "2026-09-10T00:00:00.000Z");

    const denied = await deleteAgendaItemWithNotebookGate(world, seeded.francois.id, created.value);
    assert.equal(denied.ok, false);
    if (denied.ok) throw new Error("devrait refuser");
    assert.equal(denied.status, 403);
    assert.equal(denied.reason, NOTEBOOK_PUBLISH_NOT_ASSIGNED);
    assert.ok(await world.agenda.findAgendaItem(created.value.id));
  } finally {
    world.close();
  }
});

test("DELETE Carnet — autre enseignant refusé", async () => {
  const world = await sqliteWorld();
  try {
    const seeded = await seedMecauto(world);
    const created = await createNotebookPublication(world.publishDeps, {
      teacherId: seeded.francois.id,
      annualCourseId: seeded.courseA.id,
      schoolWeekNumber: 8,
      day: 0,
      type: "HOMEWORK",
      title: "Pub François",
      detail: "",
      at: AT,
    });
    assert.equal(created.ok, true);
    if (!created.ok) throw new Error(created.reason);

    const denied = await deleteAgendaItemWithNotebookGate(world, seeded.patrick.id, created.value);
    assert.equal(denied.ok, false);
    if (denied.ok) throw new Error("devrait refuser");
    assert.equal(denied.status, 403);
    assert.equal(denied.reason, NOTEBOOK_PUBLISH_NOT_ASSIGNED);
    assert.ok(await world.agenda.findAgendaItem(created.value.id));
  } finally {
    world.close();
  }
});

test("DELETE Carnet — AnnualCourse archivé refusé", async () => {
  const world = await sqliteWorld();
  try {
    const seeded = await seedMecauto(world);
    const created = await createNotebookPublication(world.publishDeps, {
      teacherId: seeded.francois.id,
      annualCourseId: seeded.courseA.id,
      schoolWeekNumber: 8,
      day: 0,
      type: "HOMEWORK",
      title: "Avant archive",
      detail: "",
      at: AT,
    });
    assert.equal(created.ok, true);
    if (!created.ok) throw new Error(created.reason);

    const archived = await archiveAnnualCourse(world.courseDeps, seeded.courseA.id);
    assert.equal(archived.ok, true);

    const denied = await deleteAgendaItemWithNotebookGate(world, seeded.francois.id, created.value);
    assert.equal(denied.ok, false);
    if (denied.ok) throw new Error("devrait refuser");
    assert.equal(denied.status, 403);
    assert.equal(denied.reason, NOTEBOOK_PUBLISH_ARCHIVED);
    assert.ok(await world.agenda.findAgendaItem(created.value.id));
  } finally {
    world.close();
  }
});

test("DELETE legacy — publication sans annualCourseId conserve l’auteur", async () => {
  const world = await sqliteWorld();
  try {
    const seeded = await seedMecauto(world);
    await world.adapters.upsertClassroom({
      id: "classroom-legacy",
      name: "LEGACY",
      programLabel: "",
      accessCodeHint: "",
    });
    await world.adapters.upsertSubject({
      id: "subject-legacy",
      classroomId: "classroom-legacy",
      name: "Matière legacy",
    });
    const legacy = await world.agenda.createAgendaItem({
      classroomId: "classroom-legacy",
      subjectId: "subject-legacy",
      authorTeacherId: seeded.francois.id,
      day: 0,
      hour: 8,
      weekOffset: 0,
      schoolWeekNumber: 3,
      type: "HOMEWORK",
      title: "Ancienne publication",
      detail: "",
    });
    assert.equal(legacy.annualCourseId ?? null, null);
    assert.equal(isCarnetOwnedPublication(legacy), true);

    const gate = await authorizeNotebookOwnedItemMutation(world.publishDeps, {
      teacherId: seeded.francois.id,
      item: legacy,
      at: AT,
    });
    assert.equal(gate, null);

    const stolen = await deleteAgendaItemWithNotebookGate(world, seeded.patrick.id, legacy);
    assert.equal(stolen.ok, false);
    if (stolen.ok) throw new Error("legacy autre auteur");
    assert.equal(stolen.status, 403);
    assert.ok(await world.agenda.findAgendaItem(legacy.id));

    const own = await deleteAgendaItemWithNotebookGate(world, seeded.francois.id, legacy);
    assert.equal(own.ok, true);
    assert.equal(await world.agenda.findAgendaItem(legacy.id), undefined);
  } finally {
    world.close();
  }
});
