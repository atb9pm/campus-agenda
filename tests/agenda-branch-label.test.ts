import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { AnnualCourse } from "../src/features/annual-courses/types.ts";
import {
  UNDEFINED_BRANCH_LABEL,
  displayBranchLabel,
  listResolvedAgendaSubjects,
  resolveAgendaBranchLabel,
  runtimeSubjectIdForAnnualCourse,
} from "../src/features/agenda-bridge/index.ts";
import type { PedagogicalContextRecord } from "../src/features/school-catalog/profession-types.ts";
import type { SchoolBranchRecord } from "../src/features/school-catalog/types.ts";
import { listUpcomingTestsForClass } from "../src/features/evaluations/index.ts";
import { buildSchoolWeeks, resolveDisplayCourseDay } from "../src/features/calendar/index.ts";
import type { PrototypeAgendaItem } from "../src/features/agenda/demo-items.ts";

const MASTER_BRANCH_LABEL = "CP Léger Injection, dépollution";
const COURSE_ID = "ac-1788245202770-m0hhz64";
const SUBJECT_ID = runtimeSubjectIdForAnnualCourse(COURSE_ID);

function branch(label: string): SchoolBranchRecord {
  return {
    id: "br-injection",
    code: "INJ",
    label,
    sortOrder: 1,
    isActive: true,
    adminCode: "BR-0001",
    isArchived: false,
    archivedAt: null,
    teachingType: "TECHNICAL",
  };
}

const context: PedagogicalContextRecord = {
  id: "ctx-injection",
  adminCode: "CTX-0001",
  professionId: "prf-1",
  trainingYear: 1,
  branchId: "br-injection",
  isActive: true,
  isArchived: false,
  archivedAt: null,
};

const course: AnnualCourse = {
  id: COURSE_ID,
  schoolYearId: "sy-1",
  classId: "cl-1",
  contextId: context.id,
  isArchived: false,
  archivedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

test("libellé élève — refuse les identifiants techniques et le vide", () => {
  assert.equal(displayBranchLabel(""), UNDEFINED_BRANCH_LABEL);
  assert.equal(displayBranchLabel("   "), UNDEFINED_BRANCH_LABEL);
  assert.equal(displayBranchLabel(null), UNDEFINED_BRANCH_LABEL);
  assert.equal(displayBranchLabel(SUBJECT_ID), UNDEFINED_BRANCH_LABEL);
  assert.equal(displayBranchLabel("subject-course-ac-1788201895481-a0fjgc6"), UNDEFINED_BRANCH_LABEL);
  assert.equal(displayBranchLabel(MASTER_BRANCH_LABEL), MASTER_BRANCH_LABEL);
});

test("libellé élève — utilise le nom exact de la branche maître, pas le titre", () => {
  const label = resolveAgendaBranchLabel({
    subjectId: SUBJECT_ID,
    annualCourseId: COURSE_ID,
    subjects: [{ id: SUBJECT_ID, name: SUBJECT_ID, annualCourseId: COURSE_ID }],
    courses: [course],
    contexts: [context],
    branches: [branch(MASTER_BRANCH_LABEL)],
  });

  assert.equal(label, MASTER_BRANCH_LABEL);
  assert.notEqual(label, "Transmission");
  assert.ok(!label.startsWith("subject-course-"));
});

test("libellé élève — un renommage maître se répercute immédiatement", () => {
  const renamed = "CP Léger Injection, dépollution — mise à jour";
  const before = resolveAgendaBranchLabel({
    subjectId: SUBJECT_ID,
    annualCourseId: COURSE_ID,
    subjects: [{ id: SUBJECT_ID, name: "Ancien nom runtime", annualCourseId: COURSE_ID }],
    courses: [course],
    contexts: [context],
    branches: [branch(MASTER_BRANCH_LABEL)],
  });
  const after = resolveAgendaBranchLabel({
    subjectId: SUBJECT_ID,
    annualCourseId: COURSE_ID,
    subjects: [{ id: SUBJECT_ID, name: "Ancien nom runtime", annualCourseId: COURSE_ID }],
    courses: [course],
    contexts: [context],
    branches: [branch(renamed)],
  });

  assert.equal(before, MASTER_BRANCH_LABEL);
  assert.equal(after, renamed);
});

test("libellé élève — fallback propre si la branche maître est introuvable", () => {
  const label = resolveAgendaBranchLabel({
    subjectId: SUBJECT_ID,
    subjects: [{ id: SUBJECT_ID, name: SUBJECT_ID }],
    courses: [],
    contexts: [],
    branches: [],
  });
  assert.equal(label, UNDEFINED_BRANCH_LABEL);
});

test("libellé élève — liste agenda jamais un ID technique", () => {
  const subjects = listResolvedAgendaSubjects({
    classroomId: "classroom-school-cl-1",
    items: [{ subjectId: SUBJECT_ID, annualCourseId: COURSE_ID }],
    runtimeSubjects: [{
      id: SUBJECT_ID,
      name: SUBJECT_ID,
      annualCourseId: COURSE_ID,
    }],
    courses: [course],
    contexts: [context],
    branches: [branch(MASTER_BRANCH_LABEL)],
  });

  assert.deepEqual(subjects.map((entry) => entry.name), [MASTER_BRANCH_LABEL]);
  assert.ok(subjects.every((entry) => !entry.name.startsWith("subject-course-")));
});

test("contrôles à venir — nom de branche réel, jamais « Branche — titre »", () => {
  const weeks = buildSchoolWeeks();
  const fromSlot = resolveDisplayCourseDay(new Date(2026, 8, 21, 12), weeks);
  const item: PrototypeAgendaItem = {
    id: 7701,
    classroomId: "classroom-school-cl-1",
    subjectId: SUBJECT_ID,
    authorTeacherId: "teacher-1",
    day: fromSlot.dayIndex,
    hour: 8,
    weekOffset: 0,
    schoolWeekNumber: fromSlot.schoolWeekNumber,
    type: "TEST",
    title: "Transmission",
    detail: "Révision 1re année",
  };

  const upcoming = listUpcomingTestsForClass(
    [item],
    {
      classrooms: [{
        id: "classroom-school-cl-1",
        name: "MMA1A",
        programLabel: "",
        accessCodeHint: "",
      }],
      subjects: [{
        id: SUBJECT_ID,
        name: MASTER_BRANCH_LABEL,
        classroomId: "classroom-school-cl-1",
        annualCourseId: COURSE_ID,
      }],
      memberships: [],
      teachers: [],
    },
    "classroom-school-cl-1",
    fromSlot,
    weeks,
  );

  assert.equal(upcoming.length, 1);
  assert.equal(upcoming[0]?.subjectName, MASTER_BRANCH_LABEL);
  assert.notEqual(upcoming[0]?.subjectName, "Branche");
  assert.ok(!upcoming[0]?.subjectName.startsWith("subject-course-"));
});

test("contrôles à venir — identifiant technique remplacé par le fallback", () => {
  const weeks = buildSchoolWeeks();
  const fromSlot = resolveDisplayCourseDay(new Date(2026, 8, 21, 12), weeks);
  const upcoming = listUpcomingTestsForClass(
    [{
      id: 7702,
      classroomId: "classroom-school-cl-1",
      subjectId: SUBJECT_ID,
      authorTeacherId: "teacher-1",
      day: fromSlot.dayIndex,
      hour: 8,
      weekOffset: 0,
      schoolWeekNumber: fromSlot.schoolWeekNumber,
      type: "TEST",
      title: "Transmission",
      detail: "Révision 1re année",
    }],
    {
      classrooms: [{
        id: "classroom-school-cl-1",
        name: "MMA1A",
        programLabel: "",
        accessCodeHint: "",
      }],
      subjects: [{
        id: SUBJECT_ID,
        name: SUBJECT_ID,
        classroomId: "classroom-school-cl-1",
      }],
      memberships: [],
      teachers: [],
    },
    "classroom-school-cl-1",
    fromSlot,
    weeks,
  );

  assert.equal(upcoming[0]?.subjectName, UNDEFINED_BRANCH_LABEL);
});

test("sources — GET /api/agenda expose les libellés résolus", async () => {
  const route = await readFile(new URL("../web/app/api/agenda/route.ts", import.meta.url), "utf8");
  assert.match(route, /listResolvedAgendaSubjects/);
  assert.match(route, /subjects,/);
});

test("sources — vue élève affiche le nom résolu, jamais l’ID", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../web/app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(page, /setAgendaSubjects\(view\.subjects\)/);
  assert.match(page, /student-upcoming-tests-branch/);
  assert.match(page, /studentUpcomingHeadline/);
  assert.doesNotMatch(page, /subjectName\} — \{entry\.item\.title/);
  assert.match(css, /\.student-course-day-app[\s\S]{0,80}font-family: var\(--carnet-font\)/);
  assert.match(css, /\.student-branch-block h2[\s\S]{0,160}text-transform: none/);
  assert.match(css, /\.student-upcoming-tests-branch/);
  assert.doesNotMatch(css, /\.student-branch-block h2[^{]*\{[^}]*text-transform: uppercase/);
});
