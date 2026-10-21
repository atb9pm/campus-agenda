import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  loadTeacherNotebookDocument,
  persistTeacherNotebookDocument,
} from "../src/features/class-notebook/annual-private-notes.ts";
import { isNotesDocumentV2 } from "../src/features/class-notebook/index.ts";
import type { AnnualCourse, TeacherCourseAssignment } from "../src/features/annual-courses/types.ts";
import { teacherCanAccessAnnualCourse } from "../src/features/annual-courses/access.ts";
import {
  studentMayAccessCourseNotes,
  teacherMayConsultCourseNotes,
} from "../src/features/pedagogical-path/index.ts";
import { MemoryAnnualCourseStore } from "../src/lib/persistence/memory-annual-course-store.ts";
import {
  getMemoryAnnualCourseNotesStore,
  resetMemoryPedagogicalPathStore,
} from "../src/lib/persistence/memory-pedagogical-path-store.ts";
import {
  getMemoryTeacherNotesStore,
  resetMemoryTeacherNotesStore,
} from "../src/lib/persistence/memory-teacher-notes-store.ts";
import { buildTeacherDeleteStatements } from "../src/features/admin-teacher-delete/sql-statements.ts";
import { applyTeacherDeleteInMemory } from "../src/features/admin-teacher-delete/apply-memory.ts";
import type { TeacherDeletePlan } from "../src/features/admin-teacher-delete/types.ts";
import type { ClassNotesDocument, TeacherWeekNote } from "../src/features/class-notebook/types.ts";

const TEACHER_1 = "teacher-1";
const TEACHER_2 = "teacher-2";
const TEACHER_OTHER = "teacher-other";
const YEAR = "year-2027";
const COURSE_INJECTION = "ac-injection";
const COURSE_CP1 = "ac-cp1";
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

function assignment(id: string, teacherId: string, annualCourseId: string, role: TeacherCourseAssignment["role"] = "PRIMARY"): TeacherCourseAssignment {
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

function v2Doc(sessions: Record<string, TeacherWeekNote[]>): ClassNotesDocument {
  return { version: 2, sessions };
}

function world() {
  resetMemoryTeacherNotesStore();
  resetMemoryPedagogicalPathStore();
  return {
    courses: new MemoryAnnualCourseStore(),
    teacherNotes: getMemoryTeacherNotesStore(),
    courseNotes: getMemoryAnnualCourseNotesStore(),
  };
}

async function seedSharedCourse(store: MemoryAnnualCourseStore) {
  await store.createCourse(course(COURSE_INJECTION, "ctx-injection"));
  await store.createCourse(course(COURSE_CP1, "ctx-cp1"));
  await store.createAssignment(assignment("asg-1-inj", TEACHER_1, COURSE_INJECTION));
  await store.createAssignment(assignment("asg-2-inj", TEACHER_2, COURSE_INJECTION, "CO_TEACHER"));
  await store.createAssignment(assignment("asg-1-cp1", TEACHER_1, COURSE_CP1));
}

test("enseignant attribué — lecture de sa note", async () => {
  const deps = world();
  await seedSharedCourse(deps.courses);
  await persistTeacherNotebookDocument(
    TEACHER_1,
    v2Doc({ [SESSION_INJECTION]: [{ id: "n1", text: "Préparer l’injection" }] }),
    deps,
  );
  const loaded = await loadTeacherNotebookDocument(TEACHER_1, deps);
  assert.ok(loaded && isNotesDocumentV2(loaded));
  assert.equal(loaded.sessions[SESSION_INJECTION]?.[0]?.text, "Préparer l’injection");
  assert.equal(
    teacherMayConsultCourseNotes({ isTeacher: true, isStudent: false, canAccessAnnualCourse: true }),
    true,
  );
});

test("deuxième enseignant du même AnnualCourse — mêmes notes, édition partagée", async () => {
  const deps = world();
  await seedSharedCourse(deps.courses);
  await persistTeacherNotebookDocument(
    TEACHER_1,
    v2Doc({ [SESSION_INJECTION]: [{ id: "n1", text: "Note de Prof 1" }] }),
    deps,
  );
  const asProf2 = await loadTeacherNotebookDocument(TEACHER_2, deps);
  assert.ok(asProf2 && isNotesDocumentV2(asProf2));
  assert.equal(asProf2.sessions[SESSION_INJECTION]?.[0]?.text, "Note de Prof 1");
  assert.equal((await deps.courseNotes.listNotesByAnnualCourse(COURSE_INJECTION)).length, 1);

  await persistTeacherNotebookDocument(
    TEACHER_2,
    v2Doc({ [SESSION_INJECTION]: [{ id: "n1", text: "Corrigé par Prof 2" }] }),
    deps,
  );
  const asProf1 = await loadTeacherNotebookDocument(TEACHER_1, deps);
  assert.ok(asProf1 && isNotesDocumentV2(asProf1));
  assert.equal(asProf1.sessions[SESSION_INJECTION]?.[0]?.text, "Corrigé par Prof 2");
  assert.equal((await deps.courseNotes.listNotesByAnnualCourse(COURSE_INJECTION)).length, 1);
});

test("enseignant d’un autre cours — note invisible", async () => {
  const deps = world();
  await seedSharedCourse(deps.courses);
  await deps.courses.createAssignment(assignment("asg-other-cp1", TEACHER_OTHER, COURSE_CP1));
  await persistTeacherNotebookDocument(
    TEACHER_1,
    v2Doc({ [SESSION_INJECTION]: [{ id: "n1", text: "Injection seulement" }] }),
    deps,
  );
  const other = await loadTeacherNotebookDocument(TEACHER_OTHER, deps);
  assert.ok(!other || !isNotesDocumentV2(other) || !other.sessions[SESSION_INJECTION]);
  assert.equal(
    teacherMayConsultCourseNotes({ isTeacher: true, isStudent: false, canAccessAnnualCourse: false }),
    false,
  );
});

test("sauvegarder Injection n’efface pas CP1", async () => {
  const deps = world();
  await seedSharedCourse(deps.courses);
  await persistTeacherNotebookDocument(
    TEACHER_1,
    v2Doc({
      [SESSION_INJECTION]: [{ id: "inj", text: "Injection" }],
      [SESSION_CP1]: [{ id: "cp1", text: "CP1" }],
    }),
    deps,
  );
  await persistTeacherNotebookDocument(
    TEACHER_1,
    v2Doc({ [SESSION_INJECTION]: [{ id: "inj", text: "Injection mise à jour" }] }),
    deps,
  );
  const injection = await deps.courseNotes.listNotesByAnnualCourse(COURSE_INJECTION);
  const cp1 = await deps.courseNotes.listNotesByAnnualCourse(COURSE_CP1);
  assert.equal(injection.length, 1);
  assert.equal(injection[0]?.text, "Injection mise à jour");
  assert.equal(cp1.length, 1);
  assert.equal(cp1[0]?.text, "CP1");
  assert.equal(cp1[0]?.courseSessionKey, SESSION_CP1);
});

test("note avec et sans courseSessionKey, CTX conservé", async () => {
  const deps = world();
  await seedSharedCourse(deps.courses);
  await deps.courseNotes.createNote("placed", {
    schoolYearId: YEAR,
    classId: "class-ma1",
    contextId: "ctx-injection",
    annualCourseId: COURSE_INJECTION,
    authorTeacherId: TEACHER_1,
    ownerTeacherId: TEACHER_1,
    text: "Placée",
    courseSessionKey: SESSION_INJECTION,
    legacyNoteId: "placed",
    referenceSessionId: "ref-sess-1",
  });
  await deps.courseNotes.createNote("unplaced", {
    schoolYearId: YEAR,
    classId: "class-ma1",
    contextId: "ctx-injection",
    annualCourseId: COURSE_INJECTION,
    authorTeacherId: TEACHER_1,
    ownerTeacherId: TEACHER_1,
    text: "Sans séance",
    courseSessionKey: null,
    referenceSessionId: "ref-sess-2",
  });
  await persistTeacherNotebookDocument(
    TEACHER_1,
    v2Doc({ [SESSION_INJECTION]: [{ id: "placed", text: "Placée éditée" }] }),
    deps,
  );
  const listed = await deps.courseNotes.listNotesByAnnualCourse(COURSE_INJECTION);
  const placed = listed.find((note) => note.legacyNoteId === "placed");
  const unplaced = listed.find((note) => note.id === "unplaced");
  assert.equal(placed?.text, "Placée éditée");
  assert.equal(placed?.courseSessionKey, SESSION_INJECTION);
  assert.equal(placed?.referenceSessionId, "ref-sess-1");
  assert.equal(placed?.contextId, "ctx-injection");
  assert.equal(unplaced?.text, "Sans séance");
  assert.equal(unplaced?.courseSessionKey, null);
  assert.equal(unplaced?.referenceSessionId, "ref-sess-2");
});

test("élèves toujours exclus ; admin sans élargissement du Carnet", async () => {
  assert.equal(studentMayAccessCourseNotes(), false);
  assert.equal(
    teacherMayConsultCourseNotes({ isTeacher: false, isStudent: true, canAccessAnnualCourse: true }),
    false,
  );
  const admin = {
    id: "admin-1",
    displayName: "Admin",
    initials: "Ad",
    isAdmin: true,
    isActive: true,
    isArchived: false,
  };
  assert.equal(
    teacherCanAccessAnnualCourse({
      teacher: admin as never,
      course: course(COURSE_INJECTION, "ctx-injection"),
      assignments: [],
      isAdmin: true,
    }),
    true,
  );
  const deps = world();
  await seedSharedCourse(deps.courses);
  await persistTeacherNotebookDocument(
    TEACHER_1,
    v2Doc({ [SESSION_INJECTION]: [{ id: "n1", text: "Interne" }] }),
    deps,
  );
  const adminNotebook = await loadTeacherNotebookDocument("admin-1", deps);
  assert.ok(!adminNotebook || !isNotesDocumentV2(adminNotebook) || !adminNotebook.sessions[SESSION_INJECTION]);
});

test("suppression d’un enseignant — la note de cours survit", async () => {
  const sql = buildTeacherDeleteStatements("teacher-chf").map((entry) => entry.sql).join("\n");
  assert.doesNotMatch(sql, /DELETE FROM annual_course_notes/);
  assert.match(sql, /UPDATE annual_course_notes SET owner_teacher_id = NULL/);
  assert.match(sql, /UPDATE annual_course_notes SET author_teacher_id = NULL/);

  const deps = world();
  await seedSharedCourse(deps.courses);
  await persistTeacherNotebookDocument(
    TEACHER_1,
    v2Doc({ [SESSION_INJECTION]: [{ id: "keep", text: "Doit rester" }] }),
    deps,
  );
  const before = await deps.courseNotes.listNotesByAnnualCourse(COURSE_INJECTION);
  assert.equal(before.length, 1);

  const plan = {
    target: { id: TEACHER_1, displayName: "Un", initials: "U1" },
    confirmationText: "U1",
    lastAdminBlocked: false,
    counts: {
      assignments: 0,
      classes: 0,
      publications: 0,
      memberships: 0,
      templates: 0,
      personalNotes: 0,
      setups: 0,
      annualCourseNotes: 1,
    },
    assignmentIds: [],
    assignmentEventIds: [],
    membershipIds: [],
    publicationIds: [],
    templateIds: [],
    annualCourseNoteIds: before.map((note) => note.id),
    annualCourseIds: [COURSE_INJECTION],
    classIds: ["class-ma1"],
  } as TeacherDeletePlan;

  await applyTeacherDeleteInMemory(plan, {
    accounts: { deleteAccount: async () => true, listAccounts: async () => [] },
    courses: deps.courses,
    agenda: { exportAllItems: async () => [], replaceAllItems: async () => undefined },
    templates: { listTemplatesForTeacher: async () => [] },
    memberships: { listMemberships: async () => [] },
    teacherSetups: { exportAllSetups: async () => [], replaceAllSetups: async () => undefined },
    teacherNotes: deps.teacherNotes,
    notes: deps.courseNotes,
  } as never);

  const after = await deps.courseNotes.listNotesByAnnualCourse(COURSE_INJECTION);
  assert.equal(after.length, 1);
  assert.equal(after[0]?.text, "Doit rester");
  assert.equal(after[0]?.ownerTeacherId, null);
  assert.equal(after[0]?.authorTeacherId, "");
  assert.equal(after[0]?.annualCourseId, COURSE_INJECTION);
  assert.equal(after[0]?.courseSessionKey, SESSION_INJECTION);
});

test("route Carnet — session enseignant obligatoire", async () => {
  const route = await readFile(new URL("../web/app/api/teacher/notes/route.ts", import.meta.url), "utf8");
  assert.match(route, /requireTeacherSession/);
  const studentAgenda = await readFile(new URL("../web/app/api/agenda/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(studentAgenda, /listNotesByAnnualCourse/);
  assert.doesNotMatch(studentAgenda, /loadTeacherNotebookDocument/);
});
