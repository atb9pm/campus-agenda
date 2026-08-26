import assert from "node:assert/strict";
import test from "node:test";

import {
  DEMO_CATALOG,
  TEACHER_CHF_ID,
  getClassroomsForTeacher,
  getSubjectsForTeacherInClassroom,
  teacherTeachesSubject,
} from "../src/features/classes/index.ts";

test("ChF — huit classes issues du PDF horaire 2026-2027", () => {
  const classrooms = getClassroomsForTeacher(DEMO_CATALOG, TEACHER_CHF_ID);
  assert.equal(classrooms.length, 8);
  assert.ok(classrooms.some((entry) => entry.name === "MA2"));
  assert.ok(classrooms.some((entry) => entry.name === "MMA3A"));
  assert.ok(classrooms.some((entry) => entry.name === "PAI"));
});

test("ChF — branches Con. Prof I / L et BG selon la grille", () => {
  assert.equal(
    teacherTeachesSubject(DEMO_CATALOG, TEACHER_CHF_ID, "classe-chf-ma3ab", "subject-chf-ma3ab-cpl"),
    true,
  );
  assert.equal(
    teacherTeachesSubject(DEMO_CATALOG, TEACHER_CHF_ID, "classe-chf-mma3a", "subject-chf-mma3a-bg"),
    true,
  );

  const mma3aBranches = getSubjectsForTeacherInClassroom(DEMO_CATALOG, TEACHER_CHF_ID, "classe-chf-mma3a");
  assert.deepEqual(
    mma3aBranches.map((subject) => subject.name).sort((left, right) => left.localeCompare(right, "fr")),
    ["BG", "Con. Prof I"],
  );
});
