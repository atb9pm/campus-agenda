import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assignmentDisplayLabel,
  assignmentDisplayStatus,
  assignmentLifecycle,
  assignTeacherToCourse,
  createAnnualCourse,
  lifecycleLabel,
  type AnnualCourseServiceDeps,
} from "../src/features/annual-courses/index.ts";
import type { AnnualCourse, TeacherCourseAssignment } from "../src/features/annual-courses/types.ts";
import {
  getControlPlanning,
  listAssignedStructuredPlanningClassrooms,
  listControlPlacementOptions,
  type ControlPlanningServiceDeps,
} from "../src/features/control-planning/index.ts";
import {
  STRUCTURED_PUBLISH_CLASS_ARCHIVED_REASON,
  STRUCTURED_PUBLISH_CLASS_INACTIVE_REASON,
  moveStructuredControlToCourseSession,
  publishManualControlToAgenda,
  type StructuredPublishDeps,
} from "../src/features/course-publications/index.ts";
import { computeCourseSessions, listComputedCourseSessions } from "../src/features/course-sessions/index.ts";
import type { CourseScheduleSlot } from "../src/features/course-schedule/types.ts";
import type { PedagogicalContextRecord } from "../src/features/school-catalog/profession-types.ts";
import { isOperationalSchoolClass } from "../src/features/school-catalog/class-lifecycle.ts";
import type { SchoolBranchRecord, SchoolClassRecord } from "../src/features/school-catalog/types.ts";
import type { SchoolYearWithWeeks } from "../src/features/school-year/types.ts";
import {
  assignedSchoolClassIdsFromTeacherCourses,
  buildTeacherCourseWorkspace,
} from "../src/features/teacher-workspace/index.ts";
import { APP_VERSION } from "../src/lib/app-version.ts";
import { createNodeSqliteDatabase } from "../src/lib/persistence/sql/adapters.ts";
import { applyMigrations, SQL_MIGRATION_FILES } from "../src/lib/persistence/sql/migrate.ts";
import { SqlAgendaStore } from "../src/lib/persistence/sql/sql-agenda-store.ts";
import { SqlAnnualCourseStore } from "../src/lib/persistence/sql/sql-annual-course-store.ts";
import { SqlCourseScheduleStore } from "../src/lib/persistence/sql/sql-course-schedule-store.ts";
import { SqlAnnualCourseNotesStore, SqlPedagogicalPathStore } from "../src/lib/persistence/sql/sql-pedagogical-path-store.ts";
import { SqlRuntimeAgendaAdapterStore } from "../src/lib/persistence/sql/sql-runtime-adapter-store.ts";
import { SqlSchoolCatalogStore } from "../src/lib/persistence/sql/sql-school-catalog-store.ts";
import { SqlTeacherAccountStore } from "../src/lib/persistence/sql/sql-teacher-account-store.ts";
import type { SchoolYearStore } from "../src/lib/persistence/school-year-types.ts";
import type { SchoolYearRecord } from "../src/features/school-year/types.ts";

const TEACHER_ID = "teacher-ma3a";
const YEAR_ID = "year-2026";
const AT = "2026-09-15T12:00:00.000Z";
const TODAY = "2026-09-15";

function mondayWeeks(startMonday: string, count: number) {
  const weeks: Array<{ number: number; kind: "A" | "B"; monday: string }> = [];
  const [year, month, day] = startMonday.split("-").map(Number);
  const cursor = new Date(year!, month! - 1, day, 12);
  for (let number = 1; number <= count; number += 1) {
    const iso = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
    weeks.push({ number, kind: number % 2 === 1 ? "A" : "B", monday: iso });
    cursor.setDate(cursor.getDate() + 7);
  }
  return weeks;
}

const WEEKS = mondayWeeks("2026-08-17", 8);

function yearRecord(id: string, label: string, status: SchoolYearWithWeeks["status"]): SchoolYearWithWeeks {
  return {
    id,
    label,
    status,
    startsOn: `${label.slice(0, 4)}-08-17`,
    endsOn: `${label.slice(5)}-07-02`,
    sourceFilename: "seed",
    importedAt: "2026-08-01T00:00:00.000Z",
    activatedAt: status === "active" ? "2026-08-01T00:00:00.000Z" : null,
    createdAt: "2026-08-01T00:00:00.000Z",
    weeks: WEEKS,
  };
}

function schoolClass(
  id: string,
  code: string,
  patch: Partial<SchoolClassRecord> = {},
): SchoolClassRecord {
  return {
    id,
    code,
    label: code,
    sortOrder: 1,
    isActive: true,
    schoolYearId: YEAR_ID,
    schoolYearLabel: "2026-2027",
    professionId: "prof-mma",
    trainingYear: 3,
    parallelCode: "A",
    isArchived: false,
    archivedAt: null,
    ...patch,
  };
}

function course(id: string, classId: string, contextId = "ctx-moteur"): AnnualCourse {
  return {
    id,
    schoolYearId: YEAR_ID,
    classId,
    contextId,
    isArchived: false,
    archivedAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

function tca(id: string, annualCourseId: string, teacherId = TEACHER_ID): TeacherCourseAssignment {
  return {
    id,
    annualCourseId,
    teacherId,
    role: "PRIMARY",
    validFrom: "2026-08-01T00:00:00.000Z",
    validTo: null,
    createdByAdminId: "admin-1",
    createdAt: "2026-08-01T00:00:00.000Z",
    endedAt: null,
    overrideReason: null,
    overrideByAdminId: null,
  };
}

const branches: SchoolBranchRecord[] = [
  {
    id: "br-moteur",
    code: "MOT",
    label: "Moteur VL",
    sortOrder: 1,
    isActive: true,
    adminCode: "BR-0001",
    isArchived: false,
    archivedAt: null,
    teachingType: "TECHNICAL",
  },
];

const contexts: PedagogicalContextRecord[] = [
  {
    id: "ctx-moteur",
    adminCode: "CTX-0001",
    professionId: "prof-mma",
    trainingYear: 3,
    branchId: "br-moteur",
    isActive: true,
    isArchived: false,
    archivedAt: null,
  },
];

function slotFor(courseId: string, patch: Partial<CourseScheduleSlot> & { id: string }): CourseScheduleSlot {
  return {
    annualCourseId: courseId,
    dayOfWeek: 1,
    periodStart: 4,
    periodEnd: 4,
    weekKind: "all",
    validFrom: null,
    validTo: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...patch,
  };
}

const YEAR = yearRecord(YEAR_ID, "2026-2027", "active");
const MA3A = schoolClass("sc-ma3a", "MA3A");
const AC_MA3A = course("ac-ma3a-moteur", MA3A.id);
const TCA_MA3A = tca("a-ma3a", AC_MA3A.id);
const ROOM_MA3A = { id: "rt-ma3a", name: "MA3A", schoolClassId: MA3A.id };

function mesCours(classes: SchoolClassRecord[]) {
  return buildTeacherCourseWorkspace({
    teacherId: TEACHER_ID,
    schoolYearId: YEAR_ID,
    at: AT,
    assignments: [TCA_MA3A],
    courses: [AC_MA3A],
    classes,
    contexts,
    branches,
    years: [YEAR],
  });
}

function controles(classes: SchoolClassRecord[]) {
  return listAssignedStructuredPlanningClassrooms({
    teacherId: TEACHER_ID,
    classrooms: [ROOM_MA3A],
    classes,
    courses: [AC_MA3A],
    assignments: [TCA_MA3A],
    years: [YEAR],
    contexts,
    branches,
    schoolYearId: YEAR_ID,
    at: AT,
  });
}

function planningDeps(classes: SchoolClassRecord[]): ControlPlanningServiceDeps {
  return {
    agenda: {
      listAgendaItems: async () => [],
      teacherCanAccessClassroom: async () => false,
    },
    adapters: {
      listClassrooms: async () => [ROOM_MA3A],
      listSubjects: async () => [{ id: "subject-moteur", name: "Moteur VL" }],
    },
    catalog: {
      ensureSeeded: async () => undefined,
      listClasses: async () => classes,
      listContexts: async () => contexts,
      listBranches: async () => branches,
    },
    courses: {
      listCourses: async () => [AC_MA3A],
      listAssignments: async () => [TCA_MA3A],
    },
    years: {
      listSchoolYears: async () => [YEAR],
      getActiveSchoolYear: async () => YEAR,
      getSchoolYearById: async (id: string) => (id === YEAR_ID ? YEAR : null),
      listDayExceptions: async () => [],
    },
    teachers: {
      listAccounts: async () => [{ id: TEACHER_ID, displayName: "François Martin", initials: "FM" }],
    },
    schedules: { listSlots: async () => [slotFor(AC_MA3A.id, { id: "s-ma3a", dayOfWeek: 1 })] },
  } as unknown as ControlPlanningServiceDeps;
}

function placementFor(classes: SchoolClassRecord[]) {
  const sessions = computeCourseSessions({
    schoolYearId: YEAR_ID,
    courses: [{ id: AC_MA3A.id, classId: MA3A.id, contextId: "ctx-moteur" }],
    slots: [slotFor(AC_MA3A.id, { id: "s-ma3a", dayOfWeek: 1 })],
    weeks: WEEKS,
  });
  return listControlPlacementOptions({
    sessions,
    assignments: [TCA_MA3A],
    teacherId: TEACHER_ID,
    schoolWeekNumber: null,
    branchByCourseId: new Map([[AC_MA3A.id, "Moteur VL"]]),
    yearStatus: "active",
    classroomSelected: true,
    structured: true,
    classroomByClassId: new Map([[MA3A.id, ROOM_MA3A]]),
    selectedSchoolClassIds: [MA3A.id],
    schoolClasses: classes,
    planningSchoolYearId: YEAR_ID,
  });
}

function adminBadge(schoolClass: SchoolClassRecord | null) {
  const status = assignmentDisplayStatus(TCA_MA3A, {
    schoolClass,
    courseSchoolYearId: AC_MA3A.schoolYearId,
    at: AT,
  });
  return `Titulaire · ${assignmentDisplayLabel(status)}`;
}

test("version 2.38.0 — classe archivée hors opérationnel, pas de migration", async () => {
  assert.equal(APP_VERSION, "2.38.0");
  assert.equal(SQL_MIGRATION_FILES.at(-1), "0024_structured_agenda_bridge.sql");
  const [classroomsSrc, panel, lifecycle] = await Promise.all([
    readFile(new URL("../src/features/control-planning/classrooms.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/app/components/annual-courses-admin-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/school-catalog/class-lifecycle.ts", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(classroomsSrc, /isActive: true, isArchived: false/);
  assert.match(panel, /assignmentDisplayLabel/);
  assert.match(panel, /assignmentDisplayStatus/);
  assert.doesNotMatch(panel, /lifecycleLabel\(assignmentLifecycle/);
  assert.match(lifecycle, /isOperationalSchoolClass/);
  assert.doesNotMatch(lifecycle, /listAssignments|deleteAssignment|archiveAnnualCourse/);
});

test("1 — classe active + attribution active → visible dans Mes cours", () => {
  assert.equal(isOperationalSchoolClass(MA3A, YEAR_ID), true);
  const workspace = mesCours([MA3A]);
  assert.equal(workspace.courses.length, 1);
  assert.equal(workspace.courses[0]?.classCode, "MA3A");
  assert.deepEqual(assignedSchoolClassIdsFromTeacherCourses(workspace.courses), [MA3A.id]);
});

test("2 — classe archivée + attribution encore enregistrée → absente de Mes cours", () => {
  const archived = schoolClass("sc-ma3a", "MA3A", {
    isActive: false,
    isArchived: true,
    archivedAt: "2026-09-01T00:00:00.000Z",
  });
  assert.equal(isOperationalSchoolClass(archived, YEAR_ID), false);
  const workspace = mesCours([archived]);
  assert.equal(workspace.courses.length, 0);
  assert.equal(TCA_MA3A.endedAt, null);
  assert.equal(assignmentLifecycle(TCA_MA3A, AT), "active");
  assert.equal(AC_MA3A.isArchived, false);
});

test("3 — classe archivée → absente de Contrôles", async () => {
  const archived = schoolClass("sc-ma3a", "MA3A", { isActive: false, isArchived: true });
  assert.deepEqual(controles([archived]), []);
  const planning = await getControlPlanning(planningDeps([archived]), {
    teacherId: TEACHER_ID,
    todayIso: TODAY,
  });
  assert.equal(planning.ok, true);
  if (planning.ok) assert.deepEqual(planning.view.classes, []);
});

test("4 — classe archivée → aucune placementOption", () => {
  const archived = schoolClass("sc-ma3a", "MA3A", { isActive: false, isArchived: true });
  assert.deepEqual(placementFor([archived]), []);
});

test("7 et 8 — attribution historique présente en admin, jamais simplement Active", () => {
  assert.equal(adminBadge(MA3A), "Titulaire · Active");
  const archived = schoolClass("sc-ma3a", "MA3A", { isActive: false, isArchived: true });
  const badge = adminBadge(archived);
  assert.equal(badge, "Titulaire · Classe archivée");
  assert.notEqual(assignmentDisplayLabel(assignmentDisplayStatus(TCA_MA3A, { schoolClass: archived })), "Active");
  assert.equal(lifecycleLabel(assignmentLifecycle(TCA_MA3A, AT)), "Active");
  assert.equal(adminBadge(null), "Titulaire · Terminée");
  const otherYear = schoolClass("sc-ma3a", "MA3A", { schoolYearId: "year-other" });
  assert.equal(adminBadge(otherYear), "Titulaire · Terminée");
});

test("9 — classe désactivée → même comportement opérationnel", async () => {
  const inactive = schoolClass("sc-ma3a", "MA3A", { isActive: false, isArchived: false });
  assert.equal(isOperationalSchoolClass(inactive, YEAR_ID), false);
  assert.equal(mesCours([inactive]).courses.length, 0);
  assert.deepEqual(controles([inactive]), []);
  assert.deepEqual(placementFor([inactive]), []);
  const planning = await getControlPlanning(planningDeps([inactive]), {
    teacherId: TEACHER_ID,
    todayIso: TODAY,
  });
  assert.equal(planning.ok, true);
  if (planning.ok) {
    assert.deepEqual(planning.view.classes, []);
    const options = (planning.view.semester?.weeks ?? []).flatMap((week) =>
      week.days.flatMap((day) => day.placementOptions),
    );
    assert.equal(options.length, 0);
  }
  assert.equal(adminBadge(inactive), "Titulaire · Classe désactivée");
  assert.equal(TCA_MA3A.endedAt, null);
});

function yearsStub(): SchoolYearStore {
  const weeks = mondayWeeks("2027-08-16", 16);
  const year: SchoolYearRecord = {
    id: "year-2027",
    label: "2027-2028",
    status: "active",
    startsOn: "2027-08-01",
    endsOn: "2028-07-31",
    sourceFilename: null,
    importedAt: null,
    activatedAt: "2027-08-01T00:00:00.000Z",
    createdAt: "2027-01-01T00:00:00.000Z",
  };
  return {
    listSchoolYears: async () => [year],
    getActiveSchoolYear: async () => ({ ...year, weeks }),
    getSchoolYearById: async (id: string) => (id === "year-2027" ? { ...year, weeks } : null),
    listDayExceptions: async () => [],
  } as SchoolYearStore;
}

interface SqliteWorld {
  catalog: SqlSchoolCatalogStore;
  courses: SqlAnnualCourseStore;
  courseDeps: AnnualCourseServiceDeps;
  publishDeps: StructuredPublishDeps;
  planning: ControlPlanningServiceDeps;
  close: () => void;
}

async function sqliteWorld(): Promise<SqliteWorld> {
  const db = createNodeSqliteDatabase(":memory:");
  await applyMigrations(db);
  await db.exec(
    `INSERT OR IGNORE INTO school_years (id, label, status, starts_on, ends_on, created_at)
     VALUES ('year-2027', '2027-2028', 'active', '2027-08-01', '2028-07-31', datetime('now'))`,
  );
  const catalog = new SqlSchoolCatalogStore(db);
  await catalog.ensureSeeded();
  const adapters = new SqlRuntimeAgendaAdapterStore(db);
  const agenda = new SqlAgendaStore(db);
  const courses = new SqlAnnualCourseStore(db);
  const years = yearsStub();
  const teachers = new SqlTeacherAccountStore(db);
  const schedules = new SqlCourseScheduleStore(db);
  const paths = new SqlPedagogicalPathStore(db);
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
  const publishDeps: StructuredPublishDeps = {
    courses,
    catalog,
    years,
    teachers,
    schedules,
    paths,
    agenda,
    adapters,
  };
  const planning: ControlPlanningServiceDeps = {
    agenda,
    adapters,
    catalog,
    courses,
    years,
    teachers,
    schedules,
  };
  return { catalog, courses, courseDeps, publishDeps, planning, close: () => db.close() };
}

async function seedOperationalCourse(world: SqliteWorld, classCode = "MA3A") {
  const suffix = Math.random().toString(36).replace(/[^a-z]/g, "").slice(0, 3).padEnd(3, "x");
  const profession = await world.catalog.createProfession({
    label: `Mécatronique ${suffix}`,
    durationYears: 4,
  });
  const branchesList = await world.catalog.listBranches();
  const moteur = branchesList.find((entry) => entry.label === "Moteur") ?? branchesList[0]!;
  await world.catalog.updateBranch(moteur.id, { teachingType: "TECHNICAL" });
  const ctx = await world.catalog.createContext({
    professionId: profession.id,
    trainingYear: 1,
    branchId: moteur.id,
  });
  assert.equal(ctx.ok, true);
  if (!ctx.ok) throw new Error(ctx.reason);
  const schoolClassRecord = await world.catalog.createClass({
    code: `${classCode}${suffix.toUpperCase()}`,
    label: classCode,
    schoolYearId: "year-2027",
    schoolYearLabel: "2027-2028",
    professionId: profession.id,
    trainingYear: 1,
    parallelCode: "A",
  });
  await world.publishDeps.adapters.upsertClassroom({
    id: `rt-${schoolClassRecord.id}`,
    name: schoolClassRecord.code,
    programLabel: schoolClassRecord.label,
    accessCodeHint: "",
    schoolClassId: schoolClassRecord.id,
  });
  const teacher = await world.publishDeps.teachers.createAccount({
    displayName: "François Martin",
    initials: `F${suffix}`.slice(0, 4).toUpperCase(),
    teachingType: "TECHNICAL",
  });
  assert.equal(teacher.ok, true);
  if (!teacher.ok) throw new Error(teacher.reason);
  const admin = await world.publishDeps.teachers.createAccount({
    displayName: "Admin",
    initials: `A${suffix}`.slice(0, 4).toUpperCase(),
    teachingType: "TECHNICAL",
    isAdmin: true,
  });
  assert.equal(admin.ok, true);
  if (!admin.ok) throw new Error(admin.reason);
  const courseResult = await createAnnualCourse(world.courseDeps, {
    schoolYearId: "year-2027",
    classId: schoolClassRecord.id,
    contextId: ctx.value.id,
  });
  assert.equal(courseResult.ok, true);
  if (!courseResult.ok) throw new Error(courseResult.reason);
  await assignTeacherToCourse(world.courseDeps, {
    annualCourseId: courseResult.value.id,
    teacherId: teacher.account.id,
    role: "PRIMARY",
    createdByAdminId: admin.account.id,
    validFrom: "2026-08-01",
  });
  await world.publishDeps.schedules.createSlot({
    id: `slot-${courseResult.value.id}-p4`,
    annualCourseId: courseResult.value.id,
    dayOfWeek: 1,
    periodStart: 4,
    periodEnd: 4,
    weekKind: "all",
    validFrom: null,
    validTo: null,
    createdAt: "2027-01-01T00:00:00.000Z",
    updatedAt: "2027-01-01T00:00:00.000Z",
  });
  await world.publishDeps.schedules.createSlot({
    id: `slot-${courseResult.value.id}-p6`,
    annualCourseId: courseResult.value.id,
    dayOfWeek: 1,
    periodStart: 6,
    periodEnd: 6,
    weekKind: "all",
    validFrom: null,
    validTo: null,
    createdAt: "2027-01-01T00:00:00.000Z",
    updatedAt: "2027-01-01T00:00:00.000Z",
  });
  await world.publishDeps.schedules.createSlot({
    id: `slot-${courseResult.value.id}-d3`,
    annualCourseId: courseResult.value.id,
    dayOfWeek: 3,
    periodStart: 4,
    periodEnd: 4,
    weekKind: "all",
    validFrom: null,
    validTo: null,
    createdAt: "2027-01-01T00:00:00.000Z",
    updatedAt: "2027-01-01T00:00:00.000Z",
  });
  return {
    schoolClass: schoolClassRecord,
    teacher: teacher.account,
    admin: admin.account,
    course: courseResult.value,
  };
}

async function sessionsFor(world: SqliteWorld, annualCourseId: string) {
  const sessions = await listComputedCourseSessions(world.publishDeps, {
    schoolYearId: "year-2027",
    annualCourseId,
  });
  assert.equal(sessions.ok, true);
  if (!sessions.ok) throw new Error(sessions.reason);
  const unique = [...new Map(sessions.value.map((entry) => [entry.key, entry])).values()];
  assert.ok(unique.length >= 2);
  return unique;
}

test("5 — classe archivée → impossible de créer un contrôle", async () => {
  const world = await sqliteWorld();
  try {
    const seeded = await seedOperationalCourse(world);
    const [session] = await sessionsFor(world, seeded.course.id);
    await world.catalog.updateClass(seeded.schoolClass.id, { isArchived: true });
    const created = await publishManualControlToAgenda(world.publishDeps, {
      teacherId: seeded.teacher.id,
      annualCourseId: seeded.course.id,
      courseSessionKey: session!.key,
      title: "Contrôle MA3A",
    });
    assert.equal(created.ok, false);
    if (!created.ok) {
      assert.equal(created.status, 409);
      assert.equal(created.reason, STRUCTURED_PUBLISH_CLASS_ARCHIVED_REASON);
    }
    const remainingCourses = await world.courses.listCourses();
    const remainingAssignments = await world.courses.listAssignments(seeded.course.id);
    assert.equal(remainingCourses.some((entry) => entry.id === seeded.course.id), true);
    assert.equal(remainingAssignments.length, 1);
    assert.equal(remainingAssignments[0]?.endedAt, null);
  } finally {
    world.close();
  }
});

test("6 — classe archivée → impossible de déplacer un contrôle vers cette classe", async () => {
  const world = await sqliteWorld();
  try {
    const seeded = await seedOperationalCourse(world);
    const [source, dest] = await sessionsFor(world, seeded.course.id);
    const created = await publishManualControlToAgenda(world.publishDeps, {
      teacherId: seeded.teacher.id,
      annualCourseId: seeded.course.id,
      courseSessionKey: source!.key,
      title: "Contrôle à déplacer",
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    await world.catalog.updateClass(seeded.schoolClass.id, { isArchived: true });
    const moved = await moveStructuredControlToCourseSession(world.publishDeps, {
      teacherId: seeded.teacher.id,
      agendaItemId: created.item.id,
      annualCourseId: seeded.course.id,
      courseSessionKey: dest!.key,
    });
    assert.equal(moved.ok, false);
    if (!moved.ok) {
      assert.equal(moved.status, 409);
      assert.equal(moved.reason, STRUCTURED_PUBLISH_CLASS_ARCHIVED_REASON);
    }
    const stillThere = await world.courses.listAssignments(seeded.course.id);
    assert.equal(stillThere.length, 1);
  } finally {
    world.close();
  }
});

test("10 — API forgée vers classroom / cours d’une classe archivée → refus serveur", async () => {
  const world = await sqliteWorld();
  try {
    const seeded = await seedOperationalCourse(world);
    const [session] = await sessionsFor(world, seeded.course.id);
    const before = await getControlPlanning(world.planning, {
      teacherId: seeded.teacher.id,
      todayIso: "2027-09-15",
    });
    assert.equal(before.ok, true);
    if (!before.ok) return;
    assert.ok(before.view.classes.length >= 1);
    const classroomId = before.view.classes[0]!.id;

    await world.catalog.updateClass(seeded.schoolClass.id, { isArchived: true });

    const forgedPlanning = await getControlPlanning(world.planning, {
      teacherId: seeded.teacher.id,
      classroomId,
      todayIso: "2027-09-15",
    });
    assert.equal(forgedPlanning.ok, false);
    if (!forgedPlanning.ok) assert.equal(forgedPlanning.status, 403);

    const forgedCreate = await publishManualControlToAgenda(world.publishDeps, {
      teacherId: seeded.teacher.id,
      annualCourseId: seeded.course.id,
      courseSessionKey: session!.key,
      title: "Contrôle forgé",
    });
    assert.equal(forgedCreate.ok, false);
    if (!forgedCreate.ok) {
      assert.equal(forgedCreate.status, 409);
      assert.equal(forgedCreate.reason, STRUCTURED_PUBLISH_CLASS_ARCHIVED_REASON);
    }

    const inactiveWorld = await sqliteWorld();
    try {
      const inactiveSeeded = await seedOperationalCourse(inactiveWorld, "MA3B");
      const [inactiveSession] = await sessionsFor(inactiveWorld, inactiveSeeded.course.id);
      await inactiveWorld.catalog.updateClass(inactiveSeeded.schoolClass.id, { isActive: false });
      const inactiveCreate = await publishManualControlToAgenda(inactiveWorld.publishDeps, {
        teacherId: inactiveSeeded.teacher.id,
        annualCourseId: inactiveSeeded.course.id,
        courseSessionKey: inactiveSession!.key,
        title: "Contrôle classe inactive",
      });
      assert.equal(inactiveCreate.ok, false);
      if (!inactiveCreate.ok) {
        assert.equal(inactiveCreate.status, 409);
        assert.equal(inactiveCreate.reason, STRUCTURED_PUBLISH_CLASS_INACTIVE_REASON);
      }
    } finally {
      inactiveWorld.close();
    }
  } finally {
    world.close();
  }
});
