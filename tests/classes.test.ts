import assert from "node:assert/strict";
import test from "node:test";

import {
  DEMO_CATALOG,
  DEMO_CURRENT_TEACHER_ID,
  TEACHER_DEMO_ID,
  countBranchesInClassroom,
  countTeachersInClassroom,
  getClassroomById,
  getClassroomsForTeacher,
  getSubjectsForClassroom,
  getSubjectsForTeacherInClassroom,
  getTeachersInClassroom,
  teacherTeachesSubject,
} from "../src/features/classes/index.ts";

test("phase 0.2 — un enseignant peut être rattaché à plusieurs classes", () => {
  const classrooms = getClassroomsForTeacher(DEMO_CATALOG, TEACHER_DEMO_ID);
  assert.equal(classrooms.length, 2);
  assert.deepEqual(
    classrooms.map((classroom) => classroom.id).sort(),
    ["classe-demo-tma-1a", "classe-demo-tma-2a"],
  );
});

test("phase 0.2 — chaque classe possède ses propres branches", () => {
  const secondYear = getSubjectsForClassroom(DEMO_CATALOG, "classe-demo-tma-2a");
  const firstYear = getSubjectsForClassroom(DEMO_CATALOG, "classe-demo-tma-1a");

  assert.equal(secondYear.length, 5);
  assert.equal(firstYear.length, 3);
  assert.ok(secondYear.every((subject) => subject.classroomId === "classe-demo-tma-2a"));
  assert.ok(firstYear.every((subject) => subject.classroomId === "classe-demo-tma-1a"));
});

test("phase 0.2 — les enseignants sont isolés par classe", () => {
  assert.equal(countTeachersInClassroom(DEMO_CATALOG, "classe-demo-tma-2a"), 5);
  assert.equal(countTeachersInClassroom(DEMO_CATALOG, "classe-demo-tma-1a"), 2);
  assert.equal(countBranchesInClassroom(DEMO_CATALOG, "classe-demo-tma-2a"), 5);
});

test("phase 0.2 — le rattachement enseignant ↔ branche est vérifiable", () => {
  assert.equal(
    teacherTeachesSubject(
      DEMO_CATALOG,
      TEACHER_DEMO_ID,
      "classe-demo-tma-2a",
      "subject-demo-electricite-2a",
    ),
    true,
  );
  assert.equal(
    teacherTeachesSubject(
      DEMO_CATALOG,
      TEACHER_DEMO_ID,
      "classe-demo-tma-2a",
      "subject-demo-chassis-2a",
    ),
    false,
  );

  const branches = getSubjectsForTeacherInClassroom(
    DEMO_CATALOG,
    TEACHER_DEMO_ID,
    "classe-demo-tma-2a",
  );
  assert.deepEqual(
    branches.map((subject) => subject.name).sort((a, b) => a.localeCompare(b, "fr")),
    ["Électricité", "Moteur"],
  );
});

test("phase 0.2 — les données de démonstration restent fictives", () => {
  const classroom = getClassroomById(DEMO_CATALOG, "classe-demo-tma-2a");
  assert.ok(classroom);
  assert.match(classroom.accessCodeHint, /^TMA /);
  assert.match(classroom.id, /^classe-demo-/);

  for (const teacher of getTeachersInClassroom(DEMO_CATALOG, classroom.id)) {
    assert.match(teacher.displayName, /démo/i);
  }
});
