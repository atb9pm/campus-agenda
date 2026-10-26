import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { TeacherClassSetup } from "../src/features/teacher-setup/index.ts";
import {
  groupMaSemaineByMeetingDays,
  officialDisplayDaysForCourse,
  type TeacherCourseMeetingDay,
  type TeacherCourseWorkspaceEntry,
} from "../src/features/teacher-workspace/index.ts";

const TODAY = "2027-10-15T12:00:00.000Z";

function course(
  patch: Partial<TeacherCourseWorkspaceEntry> & {
    annualCourseId: string;
    classId?: string;
    classCode?: string;
    meetingDays?: TeacherCourseMeetingDay[];
  },
): TeacherCourseWorkspaceEntry {
  const classId = patch.classId ?? "class-mecma3a";
  return {
    assignmentId: `${patch.annualCourseId}-as`,
    role: "PRIMARY",
    validFrom: TODAY,
    validTo: null,
    schoolYearId: "year-2027",
    schoolYearLabel: "2027-2028",
    classId,
    classCode: patch.classCode ?? "MECMA3A",
    classLabel: "MECMA3A",
    classSortOrder: 1,
    professionId: null,
    professionLabel: "Mécanicien",
    professionClassCodePrefix: "MECMA",
    trainingYear: 3,
    parallelCode: "A",
    contextId: "ctx-1",
    branchId: "br-1",
    branchCode: "br-1",
    branchLabel: patch.branchLabel ?? "Branche",
    branchSortOrder: 1,
    teachingType: "TECHNICAL",
    ...patch,
  };
}

function setup(dayOfWeek: TeacherClassSetup["dayOfWeek"] = 1): TeacherClassSetup {
  return {
    id: "class-mecma3a",
    name: "MECMA3A",
    programLabel: "Mécanicien",
    dayOfWeek,
    branchNames: ["Branche"],
    icon: "",
    professionPrefix: "MECMA",
  };
}

function daysOn(groups: ReturnType<typeof groupMaSemaineByMeetingDays>): number[] {
  return groups.map((group) => group.dayOfWeek);
}

function courseIdsOn(
  groups: ReturnType<typeof groupMaSemaineByMeetingDays>,
  dayOfWeek: number,
): string[] {
  const group = groups.find((entry) => entry.dayOfWeek === dayOfWeek);
  return group?.classes.flatMap((entry) => entry.courses.map((item) => item.annualCourseId)) ?? [];
}

test("cas 1 — MeetingDay mardi toutes semaines : visible mardi, absent lundi", () => {
  const assigned = course({
    annualCourseId: "ac-mecma",
    meetingDays: [{ dayOfWeek: 2, weekKind: "all", role: "PRIMARY" }],
  });
  const groups = groupMaSemaineByMeetingDays([setup(1)], [assigned], "A");
  assert.deepEqual(daysOn(groups), [2]);
  assert.deepEqual(courseIdsOn(groups, 2), ["ac-mecma"]);
  assert.deepEqual(courseIdsOn(groups, 1), []);
});

test("cas 2 — MeetingDay mardi semaine A : visible en A, absent en B", () => {
  const assigned = course({
    annualCourseId: "ac-mecma",
    meetingDays: [{ dayOfWeek: 2, weekKind: "A", role: "PRIMARY" }],
  });
  const weekA = groupMaSemaineByMeetingDays([setup(1)], [assigned], "A");
  const weekB = groupMaSemaineByMeetingDays([setup(1)], [assigned], "B");
  assert.deepEqual(daysOn(weekA), [2]);
  assert.deepEqual(courseIdsOn(weekA, 2), ["ac-mecma"]);
  assert.deepEqual(daysOn(weekB), []);
});

test("cas 3 — MeetingDay jeudi semaine B : visible en B, absent en A", () => {
  const assigned = course({
    annualCourseId: "ac-mecma",
    meetingDays: [{ dayOfWeek: 4, weekKind: "B", role: "PRIMARY" }],
  });
  const weekA = groupMaSemaineByMeetingDays([setup(1)], [assigned], "A");
  const weekB = groupMaSemaineByMeetingDays([setup(1)], [assigned], "B");
  assert.deepEqual(daysOn(weekA), []);
  assert.deepEqual(daysOn(weekB), [4]);
  assert.deepEqual(courseIdsOn(weekB, 4), ["ac-mecma"]);
});

test("cas 4 — préférence lundi ignorée si MeetingDay officiel = mardi (MECMA3A)", () => {
  const assigned = course({
    annualCourseId: "ac-mecma",
    meetingDays: [{ dayOfWeek: 2, weekKind: "all", role: "PRIMARY" }],
  });
  const groups = groupMaSemaineByMeetingDays([setup(1)], [assigned], "A");
  assert.deepEqual(daysOn(groups), [2], "le mardi officiel gagne");
  assert.deepEqual(courseIdsOn(groups, 1), [], "le lundi de préférence n’apparaît plus");
  assert.equal(setup(1).dayOfWeek, 1, "la préférence persistée n’est pas modifiée");
});

test("cas 5 — aucun MeetingDay : repli sur la préférence legacy", () => {
  const assigned = course({ annualCourseId: "ac-legacy" });
  const groups = groupMaSemaineByMeetingDays([setup(1)], [assigned], "A");
  assert.deepEqual(daysOn(groups), [1]);
  assert.deepEqual(courseIdsOn(groups, 1), ["ac-legacy"]);
  assert.deepEqual(officialDisplayDaysForCourse(undefined, 4, "A"), [4]);
  assert.deepEqual(officialDisplayDaysForCourse([], 3, "B"), [3]);
});

test("PRIMARY mardi A + ADDITIONAL jeudi B suivent la semaine consultée", () => {
  const assigned = course({
    annualCourseId: "ac-split",
    meetingDays: [
      { dayOfWeek: 2, weekKind: "A", role: "PRIMARY" },
      { dayOfWeek: 4, weekKind: "B", role: "ADDITIONAL" },
    ],
  });
  assert.deepEqual(daysOn(groupMaSemaineByMeetingDays([setup(1)], [assigned], "A")), [2]);
  assert.deepEqual(daysOn(groupMaSemaineByMeetingDays([setup(1)], [assigned], "B")), [4]);
});

test("Ma semaine — copy et groupement officiel, préférences inchangées", async () => {
  const [panel, page] = await Promise.all([
    readFile(new URL("../web/app/components/ma-semaine-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(panel, /groupMaSemaineByMeetingDays/);
  assert.match(panel, /Les cours sont affichés selon les jours configurés dans l’horaire des classes/);
  assert.doesNotMatch(panel, /préférence personnelle/);
  assert.doesNotMatch(panel, /groupClassesByWeekday/);
  assert.match(page, /jours configurés dans l’horaire des classes/);
  const config = await readFile(new URL("../web/app/components/configuration-panel.tsx", import.meta.url), "utf8");
  assert.match(config, /upsertSetupPreferenceForCourse/);
});
