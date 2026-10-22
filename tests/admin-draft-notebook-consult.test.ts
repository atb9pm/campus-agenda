import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assignTeacherToCourse,
  createAnnualCourse,
  type AnnualCourseServiceDeps,
} from "../src/features/annual-courses/index.ts";
import type { AnnualCourseMeetingDay } from "../src/features/annual-courses/meeting-days.ts";
import { isVisibleToStudent } from "../src/features/agenda/visibility.ts";
import {
  evaluateNotebookPublishAccess,
  NOTEBOOK_PUBLISH_YEAR_INACTIVE,
} from "../src/features/class-notebook/publish-access.ts";
import { filterNotebookItemsForSubject } from "../src/features/class-notebook/open-course.ts";
import {
  COURSE_TIMELINE_FORBIDDEN_REASON,
  getTeacherCourseTimeline,
  type CourseTimelineServiceDeps,
} from "../src/features/course-timeline/index.ts";
import type { CourseScheduleSlot } from "../src/features/course-schedule/types.ts";
import type { SchoolYearRecord } from "../src/features/school-year/types.ts";
import { getStudentAgendaItems } from "../src/features/student/agenda.ts";
import {
  buildTeacherCourseWorkspace,
  listTeacherCourses,
  WORKSPACE_ASSIGNMENT_ROLE_LABELS,
} from "../src/features/teacher-workspace/index.ts";
import { MemoryAnnualCourseStore, resetMemoryAnnualCourseStore } from "../src/lib/persistence/memory-annual-course-store.ts";
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
import { MemoryAgendaStore } from "../src/lib/persistence/memory-store.ts";
import type { SchoolYearStore } from "../src/lib/persistence/school-year-types.ts";

const ACTIVE_YEAR_ID = "year-2026";
const DRAFT_YEAR_ID = "year-2027";
const TODAY = "2026-10-15T12:00:00.000Z";
const ACTIVE_MONDAY = "2026-08-17";
const DRAFT_MONDAY = "2027-08-23";

function yearRecord(
  id: string,
  label: string,
  status: SchoolYearRecord["status"],
  startsOn: string,
): SchoolYearRecord {
  const endYear = label.slice(5);
  return {
    id,
    label,
    status,
    startsOn,
    endsOn: `${endYear}-07-31`,
    sourceFilename: null,
    importedAt: null,
    activatedAt: status === "active" ? "2026-08-01T00:00:00.000Z" : null,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function mondayWeeks(startMonday: string, count: number) {
  const weeks: Array<{ number: number; kind: "A" | "B"; monday: string }> = [];
  const [year, month, day] = startMonday.split("-").map(Number);
  const cursor = new Date(year, month - 1, day, 12);
  for (let number = 1; number <= count; number += 1) {
    const iso = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
    weeks.push({ number, kind: number % 2 === 1 ? "A" : "B", monday: iso });
    cursor.setDate(cursor.getDate() + 7);
  }
  return weeks;
}

function yearsStore(): SchoolYearStore {
  const years = [
    yearRecord(ACTIVE_YEAR_ID, "2026-2027", "active", ACTIVE_MONDAY),
    yearRecord(DRAFT_YEAR_ID, "2027-2028", "draft", DRAFT_MONDAY),
  ];
  const weeksById = new Map([
    [ACTIVE_YEAR_ID, mondayWeeks(ACTIVE_MONDAY, 6)],
    [DRAFT_YEAR_ID, mondayWeeks(DRAFT_MONDAY, 6)],
  ]);
  return {
    listSchoolYears: async () => years,
    getActiveSchoolYear: async () => {
      const active = years.find((entry) => entry.status === "active");
      return active ? { ...active, weeks: weeksById.get(active.id) ?? [] } : null;
    },
    getSchoolYearById: async (id: string) => {
      const year = years.find((entry) => entry.id === id);
      if (!year) return null;
      return { ...year, weeks: weeksById.get(year.id) ?? [] };
    },
    listDayExceptions: async () => [],
  } as SchoolYearStore;
}

function mondaySlot(annualCourseId: string): CourseScheduleSlot {
  return {
    id: `slot-${annualCourseId}`,
    annualCourseId,
    dayOfWeek: 1,
    periodStart: 2,
    periodEnd: 3,
    weekKind: "all",
    validFrom: null,
    validTo: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

function meetingDay(annualCourseId: string): AnnualCourseMeetingDay {
  return {
    id: `md-${annualCourseId}`,
    annualCourseId,
    dayOfWeek: 1,
    weekKind: "all",
    role: "PRIMARY",
    createdAt: "2027-08-01T00:00:00.000Z",
    updatedAt: "2027-08-01T00:00:00.000Z",
  };
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
  const branches = await catalog.listBranches();
  const moteur = branches.find((entry) => entry.label === "Moteur") ?? branches[0]!;
  await catalog.updateBranch(moteur.id, { teachingType: "TECHNICAL" });
  const context = await catalog.createContext({
    professionId: profession.id,
    trainingYear: 1,
    branchId: moteur.id,
  });
  assert.equal(context.ok, true);
  if (!context.ok) throw new Error(context.reason);

  const classActive = await catalog.createClass({
    code: "MECMA1A",
    label: "MECMA 1A",
    sortOrder: 2,
    schoolYearId: ACTIVE_YEAR_ID,
    schoolYearLabel: "2026-2027",
    professionId: profession.id,
    trainingYear: 1,
    parallelCode: "A",
  });
  const classDraft = await catalog.createClass({
    code: "MECMA1B",
    label: "MECMA 1B",
    sortOrder: 3,
    schoolYearId: DRAFT_YEAR_ID,
    schoolYearLabel: "2027-2028",
    professionId: profession.id,
    trainingYear: 1,
    parallelCode: "B",
  });

  const teachers = getMemoryTeacherAccountStore();
  const alice = await teachers.createAccount({
    displayName: "Alice Titulaire",
    initials: "AlT",
    teachingType: "TECHNICAL",
  });
  const admin = await teachers.createAccount({
    displayName: "Admin Consultation",
    initials: "AdC",
    teachingType: "TECHNICAL",
    isAdmin: true,
  });
  assert.equal(alice.ok && admin.ok, true);
  if (!alice.ok || !admin.ok) throw new Error("comptes");

  const courses = new MemoryAnnualCourseStore();
  const deps: AnnualCourseServiceDeps = {
    courses,
    catalog,
    years: yearsStore(),
    teachers,
    notes: getMemoryAnnualCourseNotesStore(),
  };
  const schedules = new MemoryCourseScheduleStore();
  const activeCourse = await createAnnualCourse(deps, {
    schoolYearId: ACTIVE_YEAR_ID,
    classId: classActive.id,
    contextId: context.value.id,
  });
  const draftCourse = await createAnnualCourse(deps, {
    schoolYearId: DRAFT_YEAR_ID,
    classId: classDraft.id,
    contextId: context.value.id,
  });
  assert.equal(activeCourse.ok && draftCourse.ok, true);
  if (!activeCourse.ok || !draftCourse.ok) throw new Error("cours");
  const assigned = await assignTeacherToCourse(deps, {
    annualCourseId: activeCourse.value.id,
    teacherId: alice.account.id,
    role: "PRIMARY",
    createdByAdminId: "admin-1",
    validFrom: "2026-08-01",
  });
  assert.equal(assigned.ok, true);
  if (!assigned.ok) throw new Error(assigned.reason);
  await schedules.createSlot(mondaySlot(activeCourse.value.id));
  await schedules.replaceMeetingDaysForAnnualCourse(draftCourse.value.id, [meetingDay(draftCourse.value.id)]);

  const timeline: CourseTimelineServiceDeps = {
    courses,
    catalog,
    years: deps.years,
    teachers,
    schedules,
    paths: new MemoryPedagogicalPathStore(),
  };

  return {
    deps,
    catalog,
    timeline,
    schedules,
    classActive,
    classDraft,
    contextId: context.value.id,
    alice: alice.account,
    admin: admin.account,
    activeCourse: activeCourse.value,
    draftCourse: draftCourse.value,
  };
}

type World = Awaited<ReturnType<typeof fixture>>;

function timelineOf(
  world: World,
  options: {
    teacherId: string;
    annualCourseId: string;
    schoolYearId?: string;
    isAdmin?: boolean;
    adminConsult?: boolean;
  },
) {
  return getTeacherCourseTimeline(world.timeline, { ...options, at: TODAY });
}

test("1 — enseignant standard, année active, cours attribué : timeline autorisée", async () => {
  const world = await fixture();
  const result = await timelineOf(world, {
    teacherId: world.alice.id,
    annualCourseId: world.activeCourse.id,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.course.schoolYearId, ACTIVE_YEAR_ID);
  assert.equal(result.course.role, "PRIMARY");
  assert.ok(result.timeline.entries.length > 0);
  assert.equal(
    result.timeline.entries.every((entry) => entry.courseSession.date.startsWith("2026-")),
    true,
  );
});

test("2 — enseignant standard, DRAFT attribué, paramètre d’année forcé : pas d’accès", async () => {
  const world = await fixture();
  const assigned = await assignTeacherToCourse(world.deps, {
    annualCourseId: world.draftCourse.id,
    teacherId: world.alice.id,
    role: "PRIMARY",
    createdByAdminId: "admin-1",
    validFrom: "2027-08-01",
  });
  assert.equal(assigned.ok, true);
  const forced = await timelineOf(world, {
    teacherId: world.alice.id,
    annualCourseId: world.draftCourse.id,
    schoolYearId: DRAFT_YEAR_ID,
    isAdmin: false,
    adminConsult: false,
  });
  assert.equal(forced.ok, false);
  if (!forced.ok) {
    assert.equal(forced.status, 403);
    assert.equal(forced.reason, COURSE_TIMELINE_FORBIDDEN_REASON);
  }
  const draftYear = await world.deps.years.getSchoolYearById(DRAFT_YEAR_ID);
  assert.equal(draftYear?.status, "draft");
});

test("3 — admin, DRAFT, consult explicite : timeline autorisée", async () => {
  const world = await fixture();
  const result = await timelineOf(world, {
    teacherId: world.admin.id,
    annualCourseId: world.draftCourse.id,
    schoolYearId: DRAFT_YEAR_ID,
    isAdmin: true,
    adminConsult: true,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.course.schoolYearId, DRAFT_YEAR_ID);
  assert.equal(result.course.schoolYearLabel, "2027-2028");
});

test("4 — admin, DRAFT, consult, aucune attribution : lecture seule autorisée", async () => {
  const world = await fixture();
  const before = await world.deps.courses.listAssignments();
  const result = await timelineOf(world, {
    teacherId: world.admin.id,
    annualCourseId: world.draftCourse.id,
    schoolYearId: DRAFT_YEAR_ID,
    isAdmin: true,
    adminConsult: true,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.course.role, "ADMIN_CONSULT");
  const workspace = await listTeacherCourses(world.deps, {
    teacherId: world.admin.id,
    schoolYearId: DRAFT_YEAR_ID,
    isAdmin: true,
    adminConsult: true,
    at: TODAY,
  });
  const entry = workspace.courses.find((course) => course.annualCourseId === world.draftCourse.id);
  assert.equal(entry?.role, "ADMIN_CONSULT");
  assert.equal(entry?.assignmentId, `consult:${world.draftCourse.id}`);
  const after = await world.deps.courses.listAssignments();
  assert.equal(after.length, before.length);
  assert.equal(after.some((entry) => entry.teacherId === world.admin.id), false);
  const publish = evaluateNotebookPublishAccess({
    teacherId: world.admin.id,
    annualCourse: world.draftCourse,
    schoolClass: world.classDraft,
    activeYear: { id: ACTIVE_YEAR_ID, status: "active" },
    assignments: after,
    at: TODAY,
  });
  assert.equal(publish.canPublish, false);
  if (!publish.canPublish) assert.equal(publish.reason, NOTEBOOK_PUBLISH_YEAR_INACTIVE);
  const year = await world.deps.years.getSchoolYearById(DRAFT_YEAR_ID);
  assert.equal(year?.status, "draft");
});

test("5 — admin, DRAFT, vraie attribution : timeline autorisée avec le rôle réel", async () => {
  const world = await fixture();
  const assigned = await assignTeacherToCourse(world.deps, {
    annualCourseId: world.draftCourse.id,
    teacherId: world.admin.id,
    role: "CO_TEACHER",
    createdByAdminId: "admin-1",
    validFrom: "2027-08-01",
  });
  assert.equal(assigned.ok, true);
  const result = await timelineOf(world, {
    teacherId: world.admin.id,
    annualCourseId: world.draftCourse.id,
    schoolYearId: DRAFT_YEAR_ID,
    isAdmin: true,
    adminConsult: true,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.course.role, "CO_TEACHER");
  assert.equal(result.course.schoolYearId, DRAFT_YEAR_ID);
  const stored = (await world.deps.courses.listAssignmentsForTeacher(world.admin.id)).find(
    (entry) => entry.annualCourseId === world.draftCourse.id,
  );
  assert.equal(stored?.role, "CO_TEACHER");
  assert.equal(stored?.id.startsWith("consult:"), false);
});

test("6 — admin sans consult : année active opérationnelle, DRAFT refusé", async () => {
  const world = await fixture();
  const onActive = await assignTeacherToCourse(world.deps, {
    annualCourseId: world.activeCourse.id,
    teacherId: world.admin.id,
    role: "CO_TEACHER",
    createdByAdminId: "admin-1",
    validFrom: "2026-08-01",
  });
  assert.equal(onActive.ok, true);
  if (!onActive.ok) throw new Error(onActive.reason);
  const active = await timelineOf(world, {
    teacherId: world.admin.id,
    annualCourseId: world.activeCourse.id,
    schoolYearId: DRAFT_YEAR_ID,
    isAdmin: true,
    adminConsult: false,
  });
  assert.equal(active.ok, true);
  if (active.ok) assert.equal(active.course.schoolYearId, ACTIVE_YEAR_ID);
  const draft = await timelineOf(world, {
    teacherId: world.admin.id,
    annualCourseId: world.draftCourse.id,
    schoolYearId: DRAFT_YEAR_ID,
    isAdmin: true,
    adminConsult: false,
  });
  assert.equal(draft.ok, false);
  if (!draft.ok) assert.equal(draft.status, 403);
});

test("7 — consult=1 sans droit admin ne contourne pas l’année active", async () => {
  const world = await fixture();
  const assigned = await assignTeacherToCourse(world.deps, {
    annualCourseId: world.draftCourse.id,
    teacherId: world.alice.id,
    role: "PRIMARY",
    createdByAdminId: "admin-1",
    validFrom: "2027-08-01",
  });
  assert.equal(assigned.ok, true);
  const result = await timelineOf(world, {
    teacherId: world.alice.id,
    annualCourseId: world.draftCourse.id,
    schoolYearId: DRAFT_YEAR_ID,
    isAdmin: false,
    adminConsult: true,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 403);
    assert.equal(result.reason, COURSE_TIMELINE_FORBIDDEN_REASON);
  }
});

test("8 — le Carnet 2027–2028 charge les séances de l’année DRAFT", async () => {
  const world = await fixture();
  assert.equal((await world.schedules.listSlotsByAnnualCourse(world.draftCourse.id)).length, 0);
  const result = await timelineOf(world, {
    teacherId: world.admin.id,
    annualCourseId: world.draftCourse.id,
    schoolYearId: DRAFT_YEAR_ID,
    isAdmin: true,
    adminConsult: true,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.timeline.entries.length > 0);
  assert.equal(
    result.timeline.entries.every(
      (entry) =>
        entry.courseSession.schoolYearId === DRAFT_YEAR_ID &&
        entry.courseSession.annualCourseId === world.draftCourse.id &&
        entry.courseSession.date >= DRAFT_MONDAY &&
        entry.courseSession.date.startsWith("2027-"),
    ),
    true,
  );
  assert.equal(result.timeline.entries[0]?.courseSession.date, DRAFT_MONDAY);
});

test("9 et 10 — contenu transféré visible pour l’admin, invisible pour l’élève", async () => {
  const world = await fixture();
  const result = await timelineOf(world, {
    teacherId: world.admin.id,
    annualCourseId: world.draftCourse.id,
    schoolYearId: DRAFT_YEAR_ID,
    isAdmin: true,
    adminConsult: true,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const session = result.timeline.entries[0]?.courseSession;
  assert.ok(session);
  if (!session) return;

  const note = await world.deps.notes.createNote("note-draft-transferee", {
    schoolYearId: DRAFT_YEAR_ID,
    classId: world.classDraft.id,
    contextId: world.contextId,
    authorTeacherId: world.alice.id,
    ownerTeacherId: world.alice.id,
    text: "Note transférée N+1",
    courseSessionKey: session.key,
    sourceNoteId: "note-source-n",
    sourceSchoolYearId: ACTIVE_YEAR_ID,
    inheritedAt: "2027-08-01T00:00:00.000Z",
    annualCourseId: world.draftCourse.id,
  });
  const notes = await world.deps.notes.listNotesByAnnualCourse(world.draftCourse.id);
  assert.equal(notes.some((entry) => entry.text === "Note transférée N+1" && entry.id === note.id), true);

  const agenda = new MemoryAgendaStore([]);
  const transferred = await agenda.createAgendaItem({
    classroomId: world.classDraft.id,
    subjectId: "subject-draft",
    authorTeacherId: world.alice.id,
    day: 0,
    hour: 8,
    schoolWeekNumber: session.schoolWeekNumber,
    type: "HOMEWORK",
    title: "Publication transférée N+1",
    detail: "Héritée, non publiée aux élèves",
    schoolYearId: DRAFT_YEAR_ID,
    annualCourseId: world.draftCourse.id,
    courseSessionKey: session.key,
    courseSessionDate: session.date,
    studentVisible: false,
  });
  transferred.sourceTransitionId = "transition-n-plus-1";
  transferred.studentVisible = false;
  const publishedActive = await agenda.createAgendaItem({
    classroomId: world.classDraft.id,
    subjectId: "subject-active",
    authorTeacherId: world.alice.id,
    day: 0,
    hour: 9,
    schoolWeekNumber: 1,
    type: "INFORMATION",
    title: "Publication année active",
    detail: "Visible élève",
    schoolYearId: ACTIVE_YEAR_ID,
    annualCourseId: world.activeCourse.id,
    courseSessionKey: `${ACTIVE_YEAR_ID}|${world.activeCourse.id}|${ACTIVE_MONDAY}`,
    courseSessionDate: ACTIVE_MONDAY,
    studentVisible: true,
  });

  const listed = await agenda.listAgendaItemsByAnnualCourse(world.draftCourse.id);
  assert.equal(listed.some((item) => item.title === "Publication transférée N+1"), true);
  const visibleInNotebook = filterNotebookItemsForSubject(listed, {
    classroomId: world.classDraft.id,
    teacherId: world.admin.id,
    subjectId: null,
    annualCourseId: world.draftCourse.id,
    restrictToSubject: true,
  });
  assert.deepEqual(
    visibleInNotebook.map((item) => item.title),
    ["Publication transférée N+1"],
  );
  assert.equal(visibleInNotebook[0]?.studentVisible, false);
  assert.equal(visibleInNotebook[0]?.courseSessionDate, session.date);

  const studentItems = getStudentAgendaItems(await agenda.listAgendaItems(world.classDraft.id), world.classDraft.id);
  assert.equal(studentItems.some((item) => item.annualCourseId === world.draftCourse.id), false);
  assert.equal(studentItems.some((item) => item.id === publishedActive.id), true);
  assert.equal(isVisibleToStudent(transferred), false);
  assert.equal(transferred.studentVisible, false);

  const teacherForced = await timelineOf(world, {
    teacherId: world.alice.id,
    annualCourseId: world.draftCourse.id,
    schoolYearId: DRAFT_YEAR_ID,
    isAdmin: false,
    adminConsult: true,
  });
  assert.equal(teacherForced.ok, false);
});

test("11 — consultation admin sans attribution : pas le libellé Titulaire", async () => {
  const world = await fixture();
  await assignTeacherToCourse(world.deps, {
    annualCourseId: world.draftCourse.id,
    teacherId: world.alice.id,
    role: "PRIMARY",
    createdByAdminId: "admin-1",
    validFrom: "2027-08-01",
  });
  const [assignments, courses, classes, contexts, branches, years, professions] = await Promise.all([
    world.deps.courses.listAssignments(),
    world.deps.courses.listCourses(),
    world.catalog.listClasses(),
    world.catalog.listContexts(),
    world.catalog.listBranches(),
    world.deps.years.listSchoolYears(),
    world.catalog.listProfessions(),
  ]);
  const workspace = buildTeacherCourseWorkspace({
    teacherId: world.admin.id,
    at: TODAY,
    schoolYearId: DRAFT_YEAR_ID,
    isAdmin: true,
    adminConsult: true,
    assignments,
    courses,
    classes,
    contexts,
    branches,
    years,
    professions,
  });
  const entry = workspace.courses.find((course) => course.annualCourseId === world.draftCourse.id);
  assert.equal(entry?.role, "ADMIN_CONSULT");
  assert.equal(WORKSPACE_ASSIGNMENT_ROLE_LABELS[entry!.role], "Consultation admin");
  assert.notEqual(WORKSPACE_ASSIGNMENT_ROLE_LABELS[entry!.role], "Titulaire");
  assert.equal(
    assignments.some((item) => item.teacherId === world.admin.id && item.annualCourseId === world.draftCourse.id),
    false,
  );

  const queries = await readFile(new URL("../src/features/teacher-workspace/queries.ts", import.meta.url), "utf8");
  assert.match(queries, /entry\.teacherId === input\.teacherId/);
  assert.match(queries, /role: assignment\?\.role \?\? "ADMIN_CONSULT"/);
  assert.doesNotMatch(queries, /\?\? "PRIMARY"/);
});

test("sources — consult=1 uniquement depuis la consultation admin, publication DRAFT fermée", async () => {
  const [route, api, panel, page, service] = await Promise.all([
    readFile(new URL("../web/app/api/teacher/course-timeline/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/lib/api-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/app/components/class-notebook-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/course-timeline/service.ts", import.meta.url), "utf8"),
  ]);

  assert.match(route, /schoolYearIdFromSearchParams/);
  assert.match(route, /searchParams\.get\("consult"\) === "1"/);
  assert.match(route, /teacherIsAdmin\(teacherId\)/);
  assert.match(route, /isAdmin,\s*adminConsult/);
  assert.doesNotMatch(route, /searchParams\.get\("teacherId"\)/);
  assert.doesNotMatch(route, /export const POST/);
  assert.doesNotMatch(route, /export const PUT/);
  assert.doesNotMatch(route, /export const PATCH/);
  assert.doesNotMatch(route, /export const DELETE/);

  const timelineApi = api.slice(api.indexOf("export async function fetchTeacherCourseTimelineApi"));
  const consultGuard = timelineApi.indexOf("if (options?.adminConsult)");
  assert.ok(consultGuard > 0);
  assert.doesNotMatch(timelineApi.slice(0, consultGuard), /params\.set\("consult", "1"\)/);
  assert.match(timelineApi.slice(consultGuard), /params\.set\("consult", "1"\)/);
  assert.match(panel, /adminConsult \? \{ schoolYearId, adminConsult: true \} : undefined/);

  assert.match(page, /schoolYearId=\{adminYearConsult \? viewedSchoolYearId : null\}/);
  assert.match(page, /adminConsult=\{adminYearConsult\}/);
  assert.match(page, /!adminYearConsult && workspaceAllowsNotebookPublish/);
  assert.match(
    page,
    /Consultation administrative en lecture seule\. Les enseignants et les élèves utilisent toujours l’année active\./,
  );
  assert.match(service, /schoolYearId: options\.schoolYearId/);
  assert.match(service, /adminConsult: options\.adminConsult/);
  assert.match(service, /isAdmin: options\.isAdmin/);
});
