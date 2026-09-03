import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assignTeacherToCourse,
  createAnnualCourse,
  type AnnualCourseServiceDeps,
} from "../src/features/annual-courses/index.ts";
import {
  canManageOwnStructuredControlCard,
  isMovableStructuredControlCard,
} from "../src/features/control-planning/index.ts";
import { TEST_ALERT_THRESHOLD } from "../src/features/evaluations/index.ts";
import {
  STRUCTURED_AGENDA_COMPAT_HOUR,
  STRUCTURED_CONTROL_DELETE_FORBIDDEN_REASON,
  STRUCTURED_CONTROL_EDIT_CONTENT_ONLY_REASON,
  STRUCTURED_CONTROL_EDIT_FORBIDDEN_REASON,
  STRUCTURED_CONTROL_EDIT_NOT_STRUCTURED_REASON,
  STRUCTURED_CONTROL_EDIT_NOT_TEST_REASON,
  deleteStructuredControl,
  publishManualControlToAgenda,
  structuredControlContentFromBody,
  updateStructuredControlContent,
  type StructuredPublishDeps,
} from "../src/features/course-publications/index.ts";
import { listComputedCourseSessions } from "../src/features/course-sessions/index.ts";
import { structuredAgendaPatchGuard } from "../src/features/agenda/index.ts";
import { ARCHIVED_YEAR_READONLY_REASON } from "../src/features/school-year/archived-readonly.ts";
import { APP_VERSION } from "../src/lib/app-version.ts";
import { MemoryAgendaStore } from "../src/lib/persistence/memory-store.ts";
import {
  MemoryAnnualCourseStore,
  resetMemoryAnnualCourseStore,
} from "../src/lib/persistence/memory-annual-course-store.ts";
import { MemoryCourseScheduleStore } from "../src/lib/persistence/memory-course-schedule-store.ts";
import {
  getMemoryAnnualCourseNotesStore,
  MemoryPedagogicalPathStore,
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
import { resetMemoryLegacySchool } from "../src/lib/persistence/memory-legacy-school.ts";
import { MemoryRuntimeAgendaAdapterStore } from "../src/lib/persistence/memory-runtime-adapter-store.ts";
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
import type { AgendaStore } from "../src/lib/persistence/types.ts";
import type { RuntimeAgendaAdapterStore } from "../src/lib/persistence/runtime-agenda-types.ts";
import type { PrototypeAgendaItem } from "../src/features/agenda/demo-items.ts";

function randomLetters(length: number) {
  const alphabet = "abcdefghijkmnpqrstuvwxyz";
  let value = "";
  for (let index = 0; index < length; index += 1) {
    value += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return value;
}

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

function yearsStub(status: SchoolYearRecord["status"] = "active"): SchoolYearStore {
  const previous: SchoolYearRecord = {
    id: "year-2026",
    label: "2026-2027",
    status: "archived",
    startsOn: "2026-08-01",
    endsOn: "2027-07-31",
    sourceFilename: null,
    importedAt: null,
    activatedAt: "2026-08-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  const year: SchoolYearRecord = {
    id: "year-2027",
    label: "2027-2028",
    status,
    startsOn: "2027-08-01",
    endsOn: "2028-07-31",
    sourceFilename: null,
    importedAt: null,
    activatedAt: status === "active" ? "2027-08-01T00:00:00.000Z" : null,
    createdAt: "2027-01-01T00:00:00.000Z",
  };
  const weeks2026 = mondayWeeks("2026-08-17", 16);
  const weeks2027 = mondayWeeks("2027-08-16", 16);
  return {
    listSchoolYears: async () => [previous, year],
    getActiveSchoolYear: async () => (status === "active" ? { ...year, weeks: weeks2027 } : null),
    getSchoolYearById: async (id: string) => {
      if (id === "year-2026") return { ...previous, weeks: weeks2026 };
      if (id === "year-2027") return { ...year, weeks: weeks2027 };
      return null;
    },
    listDayExceptions: async () => [],
  } as SchoolYearStore;
}

interface World {
  kind: "memory" | "sqlite";
  adapters: RuntimeAgendaAdapterStore;
  agenda: AgendaStore;
  catalog: ReturnType<typeof getMemorySchoolCatalogStore> | SqlSchoolCatalogStore;
  courses: MemoryAnnualCourseStore | SqlAnnualCourseStore;
  years: SchoolYearStore;
  teachers: ReturnType<typeof getMemoryTeacherAccountStore> | SqlTeacherAccountStore;
  schedules: MemoryCourseScheduleStore | SqlCourseScheduleStore;
  paths: MemoryPedagogicalPathStore | SqlPedagogicalPathStore;
  courseDeps: AnnualCourseServiceDeps;
  publishDeps: StructuredPublishDeps;
  close?: () => void;
}

async function memoryWorld(): Promise<World> {
  resetMemorySchoolCatalogStore();
  resetMemoryAnnualCourseStore();
  resetMemoryPedagogicalPathStore();
  resetMemoryTeacherAccountStore();
  resetMemoryLegacySchool();
  const catalog = getMemorySchoolCatalogStore();
  await catalog.ensureSeeded();
  const adapters = new MemoryRuntimeAgendaAdapterStore();
  const agenda = new MemoryAgendaStore([]);
  const courses = new MemoryAnnualCourseStore();
  const years = yearsStub();
  const teachers = getMemoryTeacherAccountStore();
  const schedules = new MemoryCourseScheduleStore();
  const paths = new MemoryPedagogicalPathStore();
  const notes = getMemoryAnnualCourseNotesStore();
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
  return {
    kind: "memory",
    adapters,
    agenda,
    catalog,
    courses,
    years,
    teachers,
    schedules,
    paths,
    courseDeps,
    publishDeps,
  };
}

async function sqliteWorld(): Promise<World> {
  const db = createNodeSqliteDatabase(":memory:");
  await applyMigrations(db);
  await db.exec(
    `INSERT OR IGNORE INTO school_years (id, label, status, starts_on, ends_on, created_at)
     VALUES
       ('year-2026', '2026-2027', 'archived', '2026-08-01', '2027-07-31', datetime('now')),
       ('year-2027', '2027-2028', 'active', '2027-08-01', '2028-07-31', datetime('now'))`,
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
  return {
    kind: "sqlite",
    adapters,
    agenda,
    catalog,
    courses,
    years,
    teachers,
    schedules,
    paths,
    courseDeps,
    publishDeps,
    close: () => db.close(),
  };
}

async function withWorlds(run: (world: World) => Promise<void>): Promise<void> {
  for (const factory of [memoryWorld, sqliteWorld]) {
    const world = await factory();
    try {
      await run(world);
    } finally {
      world.close?.();
    }
  }
}

async function addMondaySlots(world: World, annualCourseId: string) {
  await world.schedules.createSlot({
    id: `slot-${annualCourseId}-p4`,
    annualCourseId,
    dayOfWeek: 1,
    periodStart: 4,
    periodEnd: 4,
    weekKind: "all",
    validFrom: null,
    validTo: null,
    createdAt: "2027-01-01T00:00:00.000Z",
    updatedAt: "2027-01-01T00:00:00.000Z",
  });
  await world.schedules.createSlot({
    id: `slot-${annualCourseId}-p6`,
    annualCourseId,
    dayOfWeek: 1,
    periodStart: 6,
    periodEnd: 6,
    weekKind: "all",
    validFrom: null,
    validTo: null,
    createdAt: "2027-01-01T00:00:00.000Z",
    updatedAt: "2027-01-01T00:00:00.000Z",
  });
}

async function seedCourse(world: World) {
  const profession = await world.catalog.createProfession({
    label: `Mécatronique ${Math.random().toString(36).slice(2, 6)}`,
    durationYears: 4,
  });
  const branches = await world.catalog.listBranches();
  const moteur = branches.find((entry) => entry.label === "Moteur") ?? branches[0]!;
  await world.catalog.updateBranch(moteur.id, { teachingType: "TECHNICAL" });
  const ctx = await world.catalog.createContext({
    professionId: profession.id,
    trainingYear: 1,
    branchId: moteur.id,
  });
  assert.equal(ctx.ok, true);
  if (!ctx.ok) throw new Error(ctx.reason);
  const schoolClass = await world.catalog.createClass({
    code: `MA2A-${Math.random().toString(36).slice(2, 6)}`,
    label: "MA2A",
    schoolYearId: "year-2027",
    schoolYearLabel: "2027-2028",
    professionId: profession.id,
    trainingYear: 1,
    parallelCode: "A",
  });
  const createdTeacher = await world.teachers.createAccount({
    displayName: "François Martin",
    initials: `F${randomLetters(3)}`,
    teachingType: "TECHNICAL",
  });
  assert.equal(createdTeacher.ok, true);
  if (!createdTeacher.ok) throw new Error(createdTeacher.reason);
  const createdAdmin = await world.teachers.createAccount({
    displayName: "Admin",
    initials: `A${randomLetters(3)}`,
    teachingType: "TECHNICAL",
    isAdmin: true,
  });
  assert.equal(createdAdmin.ok, true);
  if (!createdAdmin.ok) throw new Error(createdAdmin.reason);
  const courseResult = await createAnnualCourse(world.courseDeps, {
    schoolYearId: "year-2027",
    classId: schoolClass.id,
    contextId: ctx.value.id,
  });
  assert.equal(courseResult.ok, true);
  if (!courseResult.ok) throw new Error(courseResult.reason);
  await assignTeacherToCourse(world.courseDeps, {
    annualCourseId: courseResult.value.id,
    teacherId: createdTeacher.account.id,
    role: "PRIMARY",
    createdByAdminId: createdAdmin.account.id,
    validFrom: "2026-08-01",
  });
  await addMondaySlots(world, courseResult.value.id);
  return {
    schoolClass,
    teacher: createdTeacher.account,
    admin: createdAdmin.account,
    course: courseResult.value,
  };
}

async function sessionsFor(world: World, annualCourseId: string) {
  const sessions = await listComputedCourseSessions(world.publishDeps, {
    schoolYearId: "year-2027",
    annualCourseId,
  });
  assert.equal(sessions.ok, true);
  if (!sessions.ok) throw new Error(sessions.reason);
  assert.ok(sessions.value.length >= 2);
  return sessions.value;
}

async function publishTest(
  world: World,
  teacherId: string,
  annualCourseId: string,
  courseSessionKey: string,
  title: string,
  detail = "Chapitres 1 à 3",
) {
  const created = await publishManualControlToAgenda(world.publishDeps, {
    teacherId,
    annualCourseId,
    courseSessionKey,
    title,
    detail,
  });
  assert.equal(created.ok, true, created.ok ? title : created.reason);
  if (!created.ok) throw new Error(created.reason);
  return created.item;
}

function structuredSnapshot(item: PrototypeAgendaItem) {
  return {
    id: item.id,
    schoolYearId: item.schoolYearId,
    classroomId: item.classroomId,
    subjectId: item.subjectId,
    annualCourseId: item.annualCourseId,
    courseSessionKey: item.courseSessionKey,
    courseSessionDate: item.courseSessionDate,
    schoolWeekNumber: item.schoolWeekNumber,
    day: item.day,
    hour: item.hour,
    authorTeacherId: item.authorTeacherId,
    type: item.type,
  };
}

test("version 2.38.0 — modification et suppression, pas de migration 0025", async () => {
  assert.equal(APP_VERSION, "2.43.0");
  assert.equal(TEST_ALERT_THRESHOLD, 3);
  assert.equal(SQL_MIGRATION_FILES.at(-1), "0024_structured_agenda_bridge.sql");
  assert.equal(SQL_MIGRATION_FILES.some((file) => file.startsWith("0025")), false);

  const accepted = structuredControlContentFromBody({
    title: "Nouveau titre",
    detail: "Nouveau détail",
    teacherId: "forged",
  });
  assert.equal(accepted.ok, false);
  if (!accepted.ok) assert.equal(accepted.reason, STRUCTURED_CONTROL_EDIT_CONTENT_ONLY_REASON);

  const titleOnly = structuredControlContentFromBody({ title: " Titre seul " });
  assert.equal(titleOnly.ok, true);
  if (titleOnly.ok) {
    assert.equal(titleOnly.title, "Titre seul");
    assert.equal(titleOnly.detail, undefined);
  }

  for (const body of [
    { annualCourseId: "other" },
    { courseSessionKey: "other" },
    { date: "2099-01-01" },
    { classroomId: "other-class" },
    { schoolYearId: "year-2026" },
    { day: 4, title: "x" },
  ]) {
    const parsed = structuredControlContentFromBody(body);
    assert.equal(parsed.ok, false, JSON.stringify(body));
    if (!parsed.ok) assert.equal(parsed.reason, STRUCTURED_CONTROL_EDIT_CONTENT_ONLY_REASON);
  }
});

test("modification — titre, détail, identité et champs structurés conservés", async () => {
  await withWorlds(async (world) => {
    const seeded = await seedCourse(world);
    const [source] = await sessionsFor(world, seeded.course.id);
    const created = await publishTest(
      world,
      seeded.teacher.id,
      seeded.course.id,
      source!.key,
      "Contrôle injection",
      "Capteurs",
    );
    const before = structuredSnapshot(created);

    const titled = await updateStructuredControlContent(world.publishDeps, {
      teacherId: seeded.teacher.id,
      agendaItemId: created.id,
      title: "Contrôle injection corrigé",
    });
    assert.equal(titled.ok, true, titled.ok ? "" : titled.reason);
    if (titled.ok) {
      assert.equal(titled.item.id, created.id);
      assert.equal(titled.item.title, "Contrôle injection corrigé");
      assert.equal(titled.item.detail, "Capteurs");
      assert.deepEqual(structuredSnapshot(titled.item), before);
    }

    const detailed = await updateStructuredControlContent(world.publishDeps, {
      teacherId: seeded.teacher.id,
      agendaItemId: created.id,
      detail: "Actionneurs et capteurs",
    });
    assert.equal(detailed.ok, true, detailed.ok ? "" : detailed.reason);
    if (detailed.ok) {
      assert.equal(detailed.item.id, created.id);
      assert.equal(detailed.item.title, "Contrôle injection corrigé");
      assert.equal(detailed.item.detail, "Actionneurs et capteurs");
      assert.deepEqual(structuredSnapshot(detailed.item), before);
      assert.equal(detailed.item.hour, STRUCTURED_AGENDA_COMPAT_HOUR);
    }

    const persisted = await world.agenda.findAgendaItem(created.id);
    assert.ok(persisted);
    assert.equal(persisted?.title, "Contrôle injection corrigé");
    assert.equal(persisted?.detail, "Actionneurs et capteurs");
    assert.deepEqual(structuredSnapshot(persisted!), before);
  });
});

test("rejet — collègue, non TEST, champs structurés forgés", async () => {
  await withWorlds(async (world) => {
    const seeded = await seedCourse(world);
    const [source] = await sessionsFor(world, seeded.course.id);
    const created = await publishTest(world, seeded.teacher.id, seeded.course.id, source!.key, "Contrôle auteur");
    const before = structuredSnapshot(created);

    const other = await world.teachers.createAccount({
      displayName: "Autre Enseignant",
      initials: `Z${randomLetters(3)}`,
      teachingType: "TECHNICAL",
    });
    assert.equal(other.ok, true);
    if (!other.ok) throw new Error(other.reason);

    const stolen = await updateStructuredControlContent(world.publishDeps, {
      teacherId: other.account.id,
      agendaItemId: created.id,
      title: "Titre usurpé",
    });
    assert.equal(stolen.ok, false);
    if (!stolen.ok) {
      assert.equal(stolen.status, 403);
      assert.equal(stolen.reason, STRUCTURED_CONTROL_EDIT_FORBIDDEN_REASON);
    }

    const homework = await world.agenda.createAgendaItem({
      classroomId: created.classroomId,
      subjectId: created.subjectId,
      authorTeacherId: seeded.teacher.id,
      day: created.day,
      hour: created.hour,
      weekOffset: 0,
      schoolWeekNumber: created.schoolWeekNumber,
      type: "HOMEWORK",
      title: "Devoir",
      detail: "",
      schoolYearId: created.schoolYearId,
      annualCourseId: created.annualCourseId,
      courseSessionKey: created.courseSessionKey,
      courseSessionDate: created.courseSessionDate,
    });
    const notTest = await updateStructuredControlContent(world.publishDeps, {
      teacherId: seeded.teacher.id,
      agendaItemId: homework.id,
      title: "Pas un contrôle",
    });
    assert.equal(notTest.ok, false);
    if (!notTest.ok) {
      assert.equal(notTest.status, 400);
      assert.equal(notTest.reason, STRUCTURED_CONTROL_EDIT_NOT_TEST_REASON);
    }

    const unstructured = await world.agenda.createAgendaItem({
      classroomId: created.classroomId,
      subjectId: created.subjectId,
      authorTeacherId: seeded.teacher.id,
      day: created.day,
      hour: created.hour,
      weekOffset: 0,
      schoolWeekNumber: created.schoolWeekNumber,
      type: "TEST",
      title: "Contrôle legacy",
      detail: "",
      schoolYearId: created.schoolYearId,
    });
    const notStructured = await updateStructuredControlContent(world.publishDeps, {
      teacherId: seeded.teacher.id,
      agendaItemId: unstructured.id,
      title: "Legacy",
    });
    assert.equal(notStructured.ok, false);
    if (!notStructured.ok) {
      assert.equal(notStructured.status, 400);
      assert.equal(notStructured.reason, STRUCTURED_CONTROL_EDIT_NOT_STRUCTURED_REASON);
    }

    const after = await world.agenda.findAgendaItem(created.id);
    assert.ok(after);
    assert.equal(after?.title, "Contrôle auteur");
    assert.deepEqual(structuredSnapshot(after!), before);
  });
});

test("suppression — contrôle de l’auteur retiré, rien d’autre", async () => {
  await withWorlds(async (world) => {
    const seeded = await seedCourse(world);
    const [source, dest] = await sessionsFor(world, seeded.course.id);
    const keep = await publishTest(world, seeded.teacher.id, seeded.course.id, dest!.key, "Contrôle conservé");
    const created = await publishTest(world, seeded.teacher.id, seeded.course.id, source!.key, "Contrôle à supprimer");

    const coursesBefore = await world.courses.listCourses();
    const classesBefore = await world.catalog.listClasses();
    const slotsBefore = await world.schedules.listSlotsByAnnualCourse(seeded.course.id);
    const sessionsBefore = await sessionsFor(world, seeded.course.id);
    const itemsBefore = await world.agenda.exportAllItems();

    const deleted = await deleteStructuredControl(world.publishDeps, {
      teacherId: seeded.teacher.id,
      agendaItemId: created.id,
    });
    assert.equal(deleted.ok, true, deleted.ok ? "" : deleted.reason);
    if (deleted.ok) {
      assert.equal(deleted.item.id, created.id);
      assert.equal(deleted.item.title, "Contrôle à supprimer");
    }

    assert.equal(await world.agenda.findAgendaItem(created.id), undefined);
    const kept = await world.agenda.findAgendaItem(keep.id);
    assert.ok(kept);
    assert.equal(kept?.title, "Contrôle conservé");

    assert.equal((await world.courses.listCourses()).length, coursesBefore.length);
    assert.equal((await world.catalog.listClasses()).length, classesBefore.length);
    assert.equal((await world.schedules.listSlotsByAnnualCourse(seeded.course.id)).length, slotsBefore.length);
    assert.equal((await sessionsFor(world, seeded.course.id)).length, sessionsBefore.length);
    assert.equal((await world.agenda.exportAllItems()).length, itemsBefore.length - 1);
    assert.ok(await world.courses.getCourse(seeded.course.id));
    assert.ok((await world.catalog.listClasses()).some((entry) => entry.id === seeded.schoolClass.id));
  });
});

test("rejet — suppression collègue, année archivée pour edit et delete", async () => {
  await withWorlds(async (world) => {
    const seeded = await seedCourse(world);
    const [source] = await sessionsFor(world, seeded.course.id);
    const created = await publishTest(world, seeded.teacher.id, seeded.course.id, source!.key, "Contrôle protégé");

    const other = await world.teachers.createAccount({
      displayName: "Collègue",
      initials: `C${randomLetters(3)}`,
      teachingType: "TECHNICAL",
    });
    assert.equal(other.ok, true);
    if (!other.ok) throw new Error(other.reason);

    const stolenDelete = await deleteStructuredControl(world.publishDeps, {
      teacherId: other.account.id,
      agendaItemId: created.id,
    });
    assert.equal(stolenDelete.ok, false);
    if (!stolenDelete.ok) {
      assert.equal(stolenDelete.status, 403);
      assert.equal(stolenDelete.reason, STRUCTURED_CONTROL_DELETE_FORBIDDEN_REASON);
    }
    assert.ok(await world.agenda.findAgendaItem(created.id));

    world.publishDeps.years = yearsStub("archived");
    const archivedEdit = await updateStructuredControlContent(world.publishDeps, {
      teacherId: seeded.teacher.id,
      agendaItemId: created.id,
      title: "Année archivée",
    });
    assert.equal(archivedEdit.ok, false);
    if (!archivedEdit.ok) {
      assert.equal(archivedEdit.status, 403);
      assert.equal(archivedEdit.reason, ARCHIVED_YEAR_READONLY_REASON);
    }

    const archivedDelete = await deleteStructuredControl(world.publishDeps, {
      teacherId: seeded.teacher.id,
      agendaItemId: created.id,
    });
    assert.equal(archivedDelete.ok, false);
    if (!archivedDelete.ok) {
      assert.equal(archivedDelete.status, 403);
      assert.equal(archivedDelete.reason, ARCHIVED_YEAR_READONLY_REASON);
    }

    const stillThere = await world.agenda.findAgendaItem(created.id);
    assert.ok(stillThere);
    assert.equal(stillThere?.title, "Contrôle protégé");
  });
});

test("UI et non-régression — actions propres, déplacement PR64, création, semestre", async () => {
  const [panel, client, route, moveRoute, createRoute, patchRoute, service] = await Promise.all([
    readFile(new URL("../web/app/components/control-planning-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/lib/api-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/app/api/teacher/controls/[agendaItemId]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/app/api/teacher/controls/[agendaItemId]/move/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/app/api/teacher/controls/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/app/api/agenda/[id]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/course-publications/service.ts", import.meta.url), "utf8"),
  ]);

  assert.match(panel, /data-control-menu/);
  assert.match(panel, /Modifier/);
  assert.match(panel, /Déplacer/);
  assert.match(panel, /Supprimer/);
  assert.match(panel, /onEditClick/);
  assert.match(panel, /onDeleteClick/);
  assert.match(panel, /cardIsManageable\(card\)/);
  assert.match(panel, /canManageOwnStructuredControlCard/);
  assert.match(panel, /updateTeacherControlApi/);
  assert.match(panel, /deleteTeacherControlApi/);
  assert.match(panel, /moveTeacherControlApi/);
  assert.match(panel, /createTeacherControlApi/);
  assert.match(panel, /data-control-move/);
  assert.match(panel, /application\/x-campus-control/);
  assert.match(panel, /data-control-semester/);
  assert.match(panel, /toggleControlPlanningClassroomSelection/);
  assert.match(panel, /Supprimer ce contrôle \? Cette action est définitive\./);
  assert.match(panel, /Supprimer le contrôle/);
  assert.match(panel, /aria-haspopup="menu"/);
  assert.doesNotMatch(panel, /onMouseEnter=\{.*setMenuOpen/);

  assert.match(client, /updateTeacherControlApi/);
  assert.match(client, /deleteTeacherControlApi/);
  assert.match(client, /method: "PATCH"/);
  assert.match(client, /method: "DELETE"/);

  assert.match(route, /updateStructuredControlContent/);
  assert.match(route, /deleteStructuredControl/);
  assert.match(route, /structuredControlContentFromBody/);
  assert.match(route, /auth\.session!.teacherId/);
  assert.doesNotMatch(route, /searchParams\.get\("teacherId"\)/);
  assert.doesNotMatch(route, /moveStructuredControlPlacement/);

  assert.match(moveRoute, /moveStructuredControlToCourseSession/);
  assert.match(createRoute, /publishManualControlToAgenda/);
  assert.match(patchRoute, /structuredAgendaPatchGuard/);
  assert.doesNotMatch(patchRoute, /moveStructuredControlPlacement/);
  assert.match(service, /ARCHIVED_YEAR_READONLY_REASON/);
  assert.match(service, /updateAgendaItem/);
  assert.match(service, /deleteAgendaItem/);
  assert.doesNotMatch(service, /CREATE TABLE/);

  assert.equal(
    canManageOwnStructuredControlCard({ isOwn: true, annualCourseId: "ac", courseSessionKey: "key" }, true),
    true,
  );
  assert.equal(
    canManageOwnStructuredControlCard({ isOwn: false, annualCourseId: "ac", courseSessionKey: "key" }, true),
    false,
  );
  assert.equal(
    isMovableStructuredControlCard({ isOwn: true, annualCourseId: "ac", courseSessionKey: "key" }, false),
    false,
  );

  const item = {
    id: 1,
    classroomId: "c",
    subjectId: "s",
    authorTeacherId: "t",
    day: 0,
    hour: 8,
    weekOffset: 0,
    schoolWeekNumber: 1,
    type: "TEST" as const,
    title: "Contrôle",
    detail: "x",
    annualCourseId: "ac",
    courseSessionKey: "key",
  };
  assert.equal(structuredAgendaPatchGuard(item, { title: "Nouveau" }).ok, true);
  assert.equal(structuredAgendaPatchGuard(item, { annualCourseId: "other" }).ok, false);
  assert.equal(structuredAgendaPatchGuard(item, { courseSessionKey: "other" }).ok, false);
});
