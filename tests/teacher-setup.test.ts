import assert from "node:assert/strict";
import test from "node:test";

import { DEMO_CATALOG, TEACHER_CHF_ID } from "../src/features/classes/index.ts";
import {
  buildDefaultTeacherSetup,
  groupClassesByWeekday,
  normalizeTeacherSetup,
  sortClassesByWeekday,
} from "../src/features/teacher-setup/index.ts";
import {
  DEFAULT_TEACHER_NAV_SECTION,
  TEACHER_NAV_SECTIONS,
  teacherNavSectionsForRole,
  createDefaultWorkspace,
  openClassAgenda,
} from "../src/features/teacher/index.ts";

test("navigation — sections enseignant + administration admin", () => {
  assert.deepEqual([...TEACHER_NAV_SECTIONS], ["ma-semaine", "configuration", "administration"]);
  assert.equal(DEFAULT_TEACHER_NAV_SECTION, "ma-semaine");
  assert.deepEqual(teacherNavSectionsForRole(false), ["ma-semaine", "configuration"]);
  assert.ok(teacherNavSectionsForRole(true).includes("administration"));
});

test("workspace — ouverture classe retourne sur Ma semaine", () => {
  const workspace = createDefaultWorkspace(TEACHER_CHF_ID, "classe-chf-ma2");
  assert.equal(workspace.activeSection, "ma-semaine");

  const opened = openClassAgenda(workspace, "classe-chf-ma3b");
  assert.equal(opened.selectedClassroomId, "classe-chf-ma3b");
  assert.equal(opened.activeSection, "ma-semaine");
});

test("teacher setup — tri par jour de semaine", () => {
  const defaults = buildDefaultTeacherSetup(DEMO_CATALOG, TEACHER_CHF_ID);
  const sorted = sortClassesByWeekday(defaults.classes);
  assert.ok(sorted.length >= 8);

  for (let index = 1; index < sorted.length; index += 1) {
    assert.ok(sorted[index - 1].dayOfWeek <= sorted[index].dayOfWeek);
  }

  const grouped = groupClassesByWeekday(defaults.classes);
  assert.ok(grouped.length >= 1);
  assert.ok(grouped.every((group) => group.classes.length > 0));
});

test("teacher setup — normalisation des branches", () => {
  const normalized = normalizeTeacherSetup({
    version: 1,
    classes: [
      {
        id: "test",
        name: " MA2 ",
        programLabel: "MA",
        dayOfWeek: 1,
        branchNames: [" Con. Prof I ", ""],
        icon: "🔧",
      },
    ],
  });

  assert.equal(normalized.classes[0]?.name, "MA2");
  assert.deepEqual(normalized.classes[0]?.branchNames, ["Con. Prof I"]);
});
