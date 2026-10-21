import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { PrototypeAgendaItem } from "../src/features/agenda/demo-items.ts";
import {
  canModifyPublication,
  createPublication,
  deletePublication,
  updatePublication,
} from "../src/features/agenda/publications.ts";
import { isVisibleToStudent } from "../src/features/agenda/visibility.ts";
import { teacherHasStructuredPublishAccess } from "../src/features/agenda-bridge/index.ts";
import type { AnnualCourse, TeacherCourseAssignment } from "../src/features/annual-courses/types.ts";
import { teacherCanAccessAnnualCourse } from "../src/features/annual-courses/access.ts";
import { applyTeacherDeleteInMemory } from "../src/features/admin-teacher-delete/apply-memory.ts";
import { buildTeacherDeleteStatements } from "../src/features/admin-teacher-delete/sql-statements.ts";
import type { TeacherDeletePlan } from "../src/features/admin-teacher-delete/types.ts";
import { filterNotebookItemsForSubject } from "../src/features/class-notebook/open-course.ts";
import {
  authorizeAssignedCoursePublication,
  evaluateNotebookPublishAccess,
} from "../src/features/class-notebook/index.ts";
import {
  canManageOwnStructuredControlCard,
  projectControlCard,
} from "../src/features/control-planning/index.ts";
import {
  listFutureTestsForClass,
  listTestsOnCourseDay,
  listUpcomingTestsForTeacher,
} from "../src/features/evaluations/index.ts";
import { getStudentAgendaItems } from "../src/features/student/agenda.ts";
import { MemoryAnnualCourseStore } from "../src/lib/persistence/memory-annual-course-store.ts";
import { MemoryAgendaStore } from "../src/lib/persistence/memory-store.ts";
import type { SchoolClassRecord } from "../src/features/school-catalog/types.ts";
import type { SchoolYearRecord } from "../src/features/school-year/types.ts";
import type { SchoolWeek } from "../src/features/calendar/types.ts";

const TEACHER_A = "teacher-a";
const TEACHER_B = "teacher-b";
const TEACHER_OTHER = "teacher-other";
const YEAR = "year-2027";
const COURSE_INJECTION = "ac-injection";
const COURSE_CP1 = "ac-cp1";
const CLASSROOM = "rt-class-ma1";
const SUBJECT_INJECTION = "subj-injection";
const SUBJECT_CP1 = "subj-cp1";
const SESSION_INJECTION = `${YEAR}|${COURSE_INJECTION}|2027-09-13`;
const SESSION_CP1 = `${YEAR}|${COURSE_CP1}|2027-09-14`;

function course(id: string, contextId: string): AnnualCourse {
  return {
    id,
    schoolYearId: YEAR,
    classId: "class-ma1",
    contextId,
    isArchived: false,
    archivedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function assignment(
  id: string,
  teacherId: string,
  annualCourseId: string,
  role: TeacherCourseAssignment["role"] = "PRIMARY",
): TeacherCourseAssignment {
  return {
    id,
    annualCourseId,
    teacherId,
    role,
    validFrom: "2020-01-01T00:00:00.000Z",
    validTo: null,
    createdByAdminId: "admin-1",
    createdAt: "2020-01-01T00:00:00.000Z",
    endedAt: null,
    overrideReason: null,
    overrideByAdminId: null,
  };
}

function schoolClass(): SchoolClassRecord {
  return {
    id: "class-ma1",
    code: "MA1",
    label: "MA1",
    sortOrder: 1,
    isActive: true,
    schoolYearId: YEAR,
    schoolYearLabel: "2026-2027",
    professionId: "prof-1",
    trainingYear: 1,
    parallelCode: null,
    isArchived: false,
    archivedAt: null,
  };
}

function activeYear(): SchoolYearRecord {
  return {
    id: YEAR,
    label: "2026-2027",
    status: "active",
    startsOn: "2026-08-17",
    endsOn: "2027-07-02",
    sourceFilename: null,
    importedAt: null,
    activatedAt: "2026-08-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function item(
  patch: Partial<PrototypeAgendaItem> & Pick<PrototypeAgendaItem, "id" | "title" | "type">,
): PrototypeAgendaItem {
  return {
    classroomId: CLASSROOM,
    subjectId: SUBJECT_INJECTION,
    authorTeacherId: TEACHER_A,
    day: 0,
    hour: 8,
    weekOffset: 0,
    schoolWeekNumber: 4,
    detail: "Détail",
    schoolYearId: YEAR,
    annualCourseId: COURSE_INJECTION,
    courseSessionKey: SESSION_INJECTION,
    courseSessionDate: "2027-09-13",
    studentVisible: true,
    ...patch,
  };
}

function teacherAccount(id: string) {
  return {
    id,
    displayName: id,
    initials: id.slice(0, 2).toUpperCase(),
    isAdmin: false,
    isActive: true,
    isArchived: false,
  };
}

async function seedSharedCourse(store: MemoryAnnualCourseStore) {
  await store.createCourse(course(COURSE_INJECTION, "ctx-injection"));
  await store.createCourse(course(COURSE_CP1, "ctx-cp1"));
  await store.createAssignment(assignment("asg-a-inj", TEACHER_A, COURSE_INJECTION));
  await store.createAssignment(assignment("asg-b-inj", TEACHER_B, COURSE_INJECTION, "CO_TEACHER"));
  await store.createAssignment(assignment("asg-a-cp1", TEACHER_A, COURSE_CP1));
}

function courseAuthDeps(store: MemoryAnnualCourseStore) {
  return {
    courses: store,
    catalog: { listClasses: async () => [schoolClass()] },
    years: { getActiveSchoolYear: async () => activeYear() },
  };
}

function openCourseFilter(teacherId: string, annualCourseId: string, subjectId: string) {
  return {
    classroomId: CLASSROOM,
    teacherId,
    subjectId,
    annualCourseId,
    restrictToSubject: true as const,
  };
}

const WEEKS: SchoolWeek[] = [{ number: 4, kind: "A", monday: new Date(2027, 8, 13, 12) }];
const CATALOG = {
  classrooms: [{ id: CLASSROOM, name: "MA1", programLabel: "", accessCodeHint: "" }],
  subjects: [
    { id: SUBJECT_INJECTION, name: "CP Injection", classroomId: CLASSROOM, annualCourseId: COURSE_INJECTION },
    { id: SUBJECT_CP1, name: "CP1", classroomId: CLASSROOM, annualCourseId: COURSE_CP1 },
  ],
  memberships: [],
  teachers: [
    { id: TEACHER_A, displayName: "Prof A", initials: "PA" },
    { id: TEACHER_B, displayName: "Prof B", initials: "PB" },
  ],
};

test("1 — l’auteur voit sa publication dans le Carnet du cours", () => {
  const homework = item({ id: 1, type: "HOMEWORK", title: "Devoir injection" });
  const visible = filterNotebookItemsForSubject([homework], openCourseFilter(TEACHER_A, COURSE_INJECTION, SUBJECT_INJECTION));
  assert.deepEqual(
    visible.map((entry) => entry.id),
    [1],
  );
  assert.equal(visible[0]?.authorTeacherId, TEACHER_A);
});

test("2 — le deuxième professeur du même AnnualCourse voit la même publication", () => {
  const homework = item({ id: 1, type: "HOMEWORK", title: "Devoir injection" });
  const asA = filterNotebookItemsForSubject([homework], openCourseFilter(TEACHER_A, COURSE_INJECTION, SUBJECT_INJECTION));
  const asB = filterNotebookItemsForSubject([homework], openCourseFilter(TEACHER_B, COURSE_INJECTION, SUBJECT_INJECTION));
  assert.equal(asA.length, 1);
  assert.equal(asB.length, 1);
  assert.equal(asA[0], homework);
  assert.equal(asB[0], homework);
  assert.equal(asA[0]?.id, asB[0]?.id);
  assert.equal(asB[0]?.authorTeacherId, TEACHER_A);
});

test("3 — le deuxième professeur peut modifier la publication, sans copie", async () => {
  const homework = item({ id: 1, type: "HOMEWORK", title: "Devoir injection" });
  assert.equal(canModifyPublication(homework, TEACHER_B, false, { canAccessAnnualCourse: true }), true);

  const store = new MemoryAgendaStore([homework]);
  const updated = await store.updateAgendaItem(
    1,
    TEACHER_B,
    { title: "Devoir corrigé par B", detail: "Nouvelle consigne" },
    { canAccessAnnualCourse: true },
  );
  assert.equal(updated.ok, true);
  if (!updated.ok) return;
  assert.equal(updated.item.title, "Devoir corrigé par B");
  assert.equal(updated.item.authorTeacherId, TEACHER_A);
  assert.equal(updated.item.annualCourseId, COURSE_INJECTION);
  assert.equal((await store.listAgendaItemsByAnnualCourse(COURSE_INJECTION)).length, 1);

  const reloaded = filterNotebookItemsForSubject(
    await store.listAgendaItems(CLASSROOM),
    openCourseFilter(TEACHER_A, COURSE_INJECTION, SUBJECT_INJECTION),
  );
  assert.equal(reloaded[0]?.title, "Devoir corrigé par B");
  assert.equal(reloaded[0]?.authorTeacherId, TEACHER_A);
});

test("4 — un professeur d’un autre cours ne voit pas la publication", () => {
  const injection = item({ id: 1, type: "HOMEWORK", title: "Devoir injection" });
  const otherCourse = filterNotebookItemsForSubject(
    [injection],
    openCourseFilter(TEACHER_A, COURSE_CP1, SUBJECT_CP1),
  );
  assert.deepEqual(otherCourse, []);

  const weekWithoutCourse = filterNotebookItemsForSubject([injection], {
    classroomId: CLASSROOM,
    teacherId: TEACHER_OTHER,
    subjectId: SUBJECT_INJECTION,
    restrictToSubject: false,
  });
  assert.deepEqual(weekWithoutCourse, []);

  assert.equal(
    teacherCanAccessAnnualCourse({
      teacher: teacherAccount(TEACHER_OTHER) as never,
      course: course(COURSE_INJECTION, "ctx-injection"),
      assignments: [
        assignment("asg-a-inj", TEACHER_A, COURSE_INJECTION),
        assignment("asg-b-inj", TEACHER_B, COURSE_INJECTION, "CO_TEACHER"),
      ],
    }),
    false,
  );
  assert.equal(canModifyPublication(injection, TEACHER_OTHER, false, { canAccessAnnualCourse: false }), false);
});

test("5 — un professeur non attribué ne peut pas modifier", async () => {
  const homework = item({ id: 1, type: "HOMEWORK", title: "Devoir injection" });
  assert.equal(canModifyPublication(homework, TEACHER_OTHER, false, { canAccessAnnualCourse: false }), false);

  const denied = updatePublication([homework], 1, TEACHER_OTHER, { title: "Usurpation" }, false, {
    canAccessAnnualCourse: false,
  });
  assert.equal(denied.ok, false);

  const store = new MemoryAgendaStore([homework]);
  const mutated = await store.updateAgendaItem(1, TEACHER_OTHER, { title: "Usurpation" }, {
    canAccessAnnualCourse: false,
  });
  assert.equal(mutated.ok, false);
  if (mutated.ok) return;
  assert.equal(mutated.status, 403);

  const courses = new MemoryAnnualCourseStore();
  await seedSharedCourse(courses);
  const auth = await authorizeAssignedCoursePublication(courseAuthDeps(courses), {
    teacherId: TEACHER_OTHER,
    item: homework,
  });
  assert.ok(auth && !auth.ok);
  if (auth && !auth.ok) {
    assert.equal(auth.status, 403);
  }

  const assigned = await authorizeAssignedCoursePublication(courseAuthDeps(courses), {
    teacherId: TEACHER_B,
    item: homework,
  });
  assert.ok(assigned && assigned.ok);
});

test("6 — retirer l’auteur ne supprime pas devoir, contrôle ni information", async () => {
  const sql = buildTeacherDeleteStatements(TEACHER_A).map((entry) => entry.sql).join("\n");
  assert.doesNotMatch(sql, /DELETE FROM agenda_items/);
  assert.match(sql, /UPDATE agenda_items SET author_teacher_id = NULL WHERE author_teacher_id = \?/);

  const publications = [
    item({ id: 1, type: "HOMEWORK", title: "Devoir" }),
    item({ id: 2, type: "TEST", title: "Contrôle" }),
    item({ id: 3, type: "INFORMATION", title: "Info" }),
  ];
  const agenda = new MemoryAgendaStore(publications);
  const courses = new MemoryAnnualCourseStore();
  await seedSharedCourse(courses);

  const plan = {
    target: { id: TEACHER_A, displayName: "Prof A", initials: "PA" },
    confirmationText: "PA",
    lastAdminBlocked: false,
    counts: {
      assignments: 2,
      classes: 0,
      publications: 3,
      memberships: 0,
      templates: 0,
      personalNotes: 0,
      setups: 0,
      annualCourseNotes: 0,
    },
    assignmentIds: [],
    assignmentEventIds: [],
    membershipIds: [],
    publicationIds: [1, 2, 3],
    templateIds: [],
    annualCourseNoteIds: [],
    annualCourseIds: [COURSE_INJECTION, COURSE_CP1],
    classIds: ["class-ma1"],
  } as TeacherDeletePlan;

  await applyTeacherDeleteInMemory(plan, {
    accounts: { deleteAccount: async () => true, listAccounts: async () => [] },
    courses,
    agenda,
    templates: { listTemplatesForTeacher: async () => [] },
    memberships: { listMemberships: async () => [] },
    teacherSetups: { exportAllSetups: async () => [], replaceAllSetups: async () => undefined },
    teacherNotes: { exportAllNotes: async () => [], replaceAllNotes: async () => undefined },
  } as never);

  const remaining = await agenda.listAgendaItemsByAnnualCourse(COURSE_INJECTION);
  assert.equal(remaining.length, 3);
  assert.deepEqual(
    remaining.map((entry) => entry.type).sort(),
    ["HOMEWORK", "INFORMATION", "TEST"],
  );
  assert.ok(remaining.every((entry) => entry.authorTeacherId === ""));
  assert.ok(remaining.every((entry) => entry.annualCourseId === COURSE_INJECTION));
  assert.ok(remaining.every((entry) => entry.courseSessionKey === SESSION_INJECTION));

  const asB = filterNotebookItemsForSubject(remaining, openCourseFilter(TEACHER_B, COURSE_INJECTION, SUBJECT_INJECTION));
  assert.equal(asB.length, 3);
});

test("7-9 — HOMEWORK, INFORMATION et TEST avec studentVisible false invisibles élève", () => {
  const homework = item({ id: 1, type: "HOMEWORK", title: "Devoir brouillon", studentVisible: false });
  const information = item({ id: 2, type: "INFORMATION", title: "Info brouillon", studentVisible: false });
  const control = item({ id: 3, type: "TEST", title: "Contrôle brouillon", studentVisible: false });
  const published = item({ id: 4, type: "HOMEWORK", title: "Devoir publié", studentVisible: true });

  assert.equal(isVisibleToStudent(homework), false);
  assert.equal(isVisibleToStudent(information), false);
  assert.equal(isVisibleToStudent(control), false);
  assert.equal(isVisibleToStudent(published), true);

  const studentItems = getStudentAgendaItems([homework, information, control, published], CLASSROOM);
  assert.deepEqual(
    studentItems.map((entry) => entry.id),
    [4],
  );

  const upcoming = listFutureTestsForClass(
    [control, item({ id: 5, type: "TEST", title: "Contrôle publié", studentVisible: true })],
    CATALOG,
    CLASSROOM,
    new Date(2027, 8, 1, 12),
    WEEKS,
  );
  assert.deepEqual(
    upcoming.map((entry) => entry.item.id),
    [5],
  );
});

test("10 — TEST publié avec séance valide visible selon les règles normales", () => {
  const published = item({
    id: 10,
    type: "TEST",
    title: "Contrôle injection",
    studentVisible: true,
    schoolWeekNumber: 4,
    day: 0,
  });
  const orphan = item({
    id: 11,
    type: "TEST",
    title: "Sans semaine",
    studentVisible: true,
    schoolWeekNumber: 99,
    day: 0,
  });
  assert.equal(isVisibleToStudent(published), true);
  assert.equal(isVisibleToStudent(orphan), true);

  const studentItems = getStudentAgendaItems([published, orphan], CLASSROOM);
  assert.deepEqual(
    studentItems.map((entry) => entry.id),
    [10, 11],
  );

  const upcoming = listFutureTestsForClass(
    [published, orphan],
    CATALOG,
    CLASSROOM,
    new Date(2027, 8, 13, 12),
    WEEKS,
  );
  assert.deepEqual(
    upcoming.map((entry) => entry.item.id),
    [10],
  );
});

test("11 — références CTX / courseSessionKey inchangées après édition partagée", () => {
  const homework = item({
    id: 1,
    type: "HOMEWORK",
    title: "Devoir",
    referenceSessionId: "ref-sess-1",
    referenceItemId: "ref-item-1",
  });
  const result = updatePublication(
    [homework],
    1,
    TEACHER_B,
    { title: "Devoir mis à jour", detail: "Nouveau détail" },
    false,
    { canAccessAnnualCourse: true },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const updated = result.items[0]!;
  assert.equal(updated.authorTeacherId, TEACHER_A);
  assert.equal(updated.annualCourseId, COURSE_INJECTION);
  assert.equal(updated.courseSessionKey, SESSION_INJECTION);
  assert.equal(updated.courseSessionDate, "2027-09-13");
  assert.equal(updated.referenceSessionId, "ref-sess-1");
  assert.equal(updated.referenceItemId, "ref-item-1");
  assert.equal(updated.schoolYearId, YEAR);
  assert.equal(updated.subjectId, SUBJECT_INJECTION);
});

test("12 — comportements existants hors partage conservés", () => {
  const legacy = item({
    id: 20,
    type: "HOMEWORK",
    title: "Legacy sans cours",
    annualCourseId: null,
    courseSessionKey: null,
    courseSessionDate: null,
  });
  assert.equal(canModifyPublication(legacy, TEACHER_A), true);
  assert.equal(canModifyPublication(legacy, TEACHER_B), false);
  const denied = deletePublication([legacy], 20, TEACHER_B);
  assert.equal(denied.ok, false);

  const weekAll = filterNotebookItemsForSubject(
    [item({ id: 1, type: "HOMEWORK", title: "De A" }), item({ id: 2, type: "HOMEWORK", title: "De B", authorTeacherId: TEACHER_B })],
    {
      classroomId: CLASSROOM,
      teacherId: TEACHER_B,
      subjectId: SUBJECT_INJECTION,
      restrictToSubject: false,
    },
  );
  assert.deepEqual(
    weekAll.map((entry) => entry.id),
    [2],
  );

  const sameSubjectOtherCourse = item({
    id: 3,
    type: "HOMEWORK",
    title: "Autre cours même branche",
    authorTeacherId: TEACHER_A,
    annualCourseId: COURSE_CP1,
    courseSessionKey: SESSION_CP1,
    subjectId: SUBJECT_INJECTION,
  });
  const openedInjection = filterNotebookItemsForSubject(
    [item({ id: 1, type: "HOMEWORK", title: "Injection" }), sameSubjectOtherCourse],
    openCourseFilter(TEACHER_B, COURSE_INJECTION, SUBJECT_INJECTION),
  );
  assert.deepEqual(
    openedInjection.map((entry) => entry.id),
    [1],
  );

  const draftTest = item({ id: 30, type: "TEST", title: "Brouillon coordination", studentVisible: false, day: 0 });
  const coordination = listTestsOnCourseDay([draftTest], CLASSROOM, { schoolWeekNumber: 4, dayIndex: 0 });
  assert.equal(coordination.length, 1);

  const teacherWeek = listUpcomingTestsForTeacher(
    [item({ id: 40, type: "TEST", title: "De A", studentVisible: true }), item({ id: 41, type: "TEST", title: "De B", authorTeacherId: TEACHER_B, studentVisible: true })],
    CATALOG,
    TEACHER_B,
    new Date(2027, 8, 1, 12),
    WEEKS,
  );
  assert.deepEqual(
    teacherWeek.map((entry) => entry.item.id),
    [41],
  );

  const peerCard = projectControlCard(item({ id: 50, type: "TEST", title: "Contrôle A" }), {
    teacherId: TEACHER_B,
    classrooms: [{ id: CLASSROOM, name: "MA1" }],
    subjects: [{ id: SUBJECT_INJECTION, name: "CP Injection" }],
    teachers: [
      { id: TEACHER_A, displayName: "Prof A", initials: "PA" },
      { id: TEACHER_B, displayName: "Prof B", initials: "PB" },
    ],
    date: "2027-09-13",
    assignedAnnualCourseIds: new Set([COURSE_INJECTION]),
  });
  assert.equal(peerCard.isOwn, false);
  assert.equal(peerCard.canManage, true);
  assert.equal(canManageOwnStructuredControlCard(peerCard, true), true);

  const outsiderCard = projectControlCard(item({ id: 51, type: "TEST", title: "Contrôle A" }), {
    teacherId: TEACHER_OTHER,
    classrooms: [{ id: CLASSROOM, name: "MA1" }],
    subjects: [{ id: SUBJECT_INJECTION, name: "CP Injection" }],
    teachers: [{ id: TEACHER_A, displayName: "Prof A", initials: "PA" }],
    date: "2027-09-13",
    assignedAnnualCourseIds: new Set(),
  });
  assert.equal(outsiderCard.canManage, false);
  assert.equal(canManageOwnStructuredControlCard(outsiderCard, true), false);
});

test("accès AnnualCourse — TCA gouverne, authorTeacherId reste une provenance", async () => {
  const courses = new MemoryAnnualCourseStore();
  await seedSharedCourse(courses);
  const assignments = await courses.listAssignments(COURSE_INJECTION);
  assert.equal(
    teacherHasStructuredPublishAccess({
      teacherId: TEACHER_B,
      annualCourseId: COURSE_INJECTION,
      assignments,
      at: "2027-09-13T12:00:00.000Z",
    }),
    true,
  );
  assert.equal(
    teacherHasStructuredPublishAccess({
      teacherId: TEACHER_OTHER,
      annualCourseId: COURSE_INJECTION,
      assignments,
      at: "2027-09-13T12:00:00.000Z",
    }),
    false,
  );

  const notebookAccess = evaluateNotebookPublishAccess({
    teacherId: TEACHER_B,
    annualCourse: course(COURSE_INJECTION, "ctx-injection"),
    schoolClass: schoolClass(),
    activeYear: activeYear(),
    assignments,
  });
  assert.equal(notebookAccess.canPublish, true);

  const testItem = item({ id: 9, type: "TEST", title: "Contrôle" });
  const testAuth = await authorizeAssignedCoursePublication(courseAuthDeps(courses), {
    teacherId: TEACHER_B,
    item: testItem,
  });
  assert.ok(testAuth && testAuth.ok);

  const created = createPublication([], {
    id: 99,
    classroomId: CLASSROOM,
    subjectId: SUBJECT_INJECTION,
    authorTeacherId: TEACHER_A,
    day: 0,
    hour: 8,
    schoolWeekNumber: 4,
    type: "HOMEWORK",
    title: "Création",
    detail: "x",
    annualCourseId: COURSE_INJECTION,
    courseSessionKey: SESSION_INJECTION,
  });
  assert.equal(created[0]?.authorTeacherId, TEACHER_A);
});

test("sources — filtres auteur remplacés, studentVisible uniforme, hors transition", async () => {
  const [
    openCourse,
    publications,
    visibility,
    agendaGet,
    agendaId,
    apply,
    preview,
  ] = await Promise.all([
    readFile(new URL("../src/features/class-notebook/open-course.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/agenda/publications.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/agenda/visibility.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/app/api/agenda/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/app/api/agenda/[id]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/year-transition/apply.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/year-transition/preview.ts", import.meta.url), "utf8"),
  ]);

  assert.match(openCourse, /if \(annual && item\.annualCourseId === annual\) return true/);
  assert.match(publications, /canAccessAnnualCourse/);
  assert.match(publications, /authorTeacherId.*reste une provenance/);
  assert.match(visibility, /if \(!isStudentVisible\(item\)\) return false/);
  assert.doesNotMatch(visibility, /item\.type === "TEST"/);
  assert.match(agendaGet, /session\?\.kind === "student"/);
  assert.match(agendaGet, /isVisibleToStudent/);
  assert.match(agendaId, /authorizeAssignedCoursePublication/);
  assert.match(agendaId, /canAccessAnnualCourse: true/);
  assert.match(apply, /studentVisible: false/);
  assert.doesNotMatch(apply, /canAccessAnnualCourse/);
  assert.doesNotMatch(preview, /canAccessAnnualCourse/);
});
