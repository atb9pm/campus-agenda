import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  courseOpeningWeekMissingReason,
  resolveCourseOpeningWeek,
  type CourseOpeningWeek,
} from "../src/features/class-notebook/open-course.ts";
import {
  groupMaSemaineByMeetingDays,
  type TeacherCourseMeetingDay,
  type TeacherCourseWorkspaceEntry,
} from "../src/features/teacher-workspace/index.ts";
import type { TeacherClassSetup } from "../src/features/teacher-setup/index.ts";

function weeks(entries: Array<[number, "A" | "B" | null]>): CourseOpeningWeek[] {
  return entries.map(([number, kind]) => ({ number, kind }));
}

function open(list: CourseOpeningWeek[], selected: number, suffix: "A" | "B" | null) {
  return resolveCourseOpeningWeek(list, selected, suffix);
}

const SCHOOL = weeks([
  [12, "A"],
  [13, "B"],
  [14, "A"],
  [17, "A"],
  [20, "B"],
  [36, "B"],
  [37, "A"],
]);

test("1 — semaine A + badge A → même semaine", () => {
  assert.deepEqual(open(SCHOOL, 12, "A"), { ok: true, schoolWeekNumber: 12 });
});

test("2 — semaine A + badge B → prochaine semaine B", () => {
  assert.deepEqual(open(SCHOOL, 12, "B"), { ok: true, schoolWeekNumber: 13 });
});

test("3 — semaine B + badge B → même semaine", () => {
  assert.deepEqual(open(SCHOOL, 13, "B"), { ok: true, schoolWeekNumber: 13 });
});

test("4 — semaine B + badge A → prochaine semaine A", () => {
  assert.deepEqual(open(SCHOOL, 13, "A"), { ok: true, schoolWeekNumber: 14 });
});

test("5 — badge sans alternance → même semaine", () => {
  assert.deepEqual(open(SCHOOL, 12, null), { ok: true, schoolWeekNumber: 12 });
  assert.deepEqual(resolveCourseOpeningWeek(SCHOOL, 13, undefined), { ok: true, schoolWeekNumber: 13 });
});

test("6 — vacances absentes du calendrier → prochaine semaine compatible, pas numéro + 1", () => {
  assert.deepEqual(open(SCHOOL, 17, "B"), { ok: true, schoolWeekNumber: 20 });
  assert.equal(SCHOOL.some((week) => week.number === 18 || week.number === 19), false);
});

test("7 — fin d’année sans semaine ultérieure → dernière semaine compatible antérieure", () => {
  assert.deepEqual(open(SCHOOL, 37, "B"), { ok: true, schoolWeekNumber: 36 });
});

test("8 — aucune semaine compatible → pas de semaine inventée", () => {
  const onlyA = weeks([[12, "A"], [14, "A"]]);
  const missing = open(onlyA, 12, "B");
  assert.equal(missing.ok, false);
  if (missing.ok) return;
  assert.equal(missing.reason, courseOpeningWeekMissingReason("B"));
  assert.match(missing.reason, /Ma semaine reste inchangée/);
});

test("le rythme vient du calendrier, pas de la parité du numéro", () => {
  const irregular = weeks([[12, "A"], [13, "A"], [20, "B"]]);
  assert.deepEqual(open(irregular, 12, "B"), { ok: true, schoolWeekNumber: 20 });
});

function course(
  patch: Partial<TeacherCourseWorkspaceEntry> & { annualCourseId: string },
): TeacherCourseWorkspaceEntry {
  return {
    assignmentId: `${patch.annualCourseId}-as`,
    role: "PRIMARY",
    validFrom: "2026-08-17T00:00:00.000Z",
    validTo: null,
    schoolYearId: "year-2026",
    schoolYearLabel: "2026-2027",
    classId: "class-3a",
    classCode: "MECAUTO3A",
    classLabel: "MECAUTO3A",
    classSortOrder: 1,
    professionId: null,
    professionLabel: "Mécanicien",
    professionClassCodePrefix: "MECAUTO",
    trainingYear: 3,
    parallelCode: "A",
    contextId: "ctx",
    branchId: "br-chassis",
    branchCode: "chassis",
    branchLabel: "CP 3 Châssis",
    branchSortOrder: 1,
    teachingType: "TECHNICAL",
    ...patch,
  };
}

const SETUP: TeacherClassSetup = {
  id: "class-3a",
  name: "MECAUTO3A",
  programLabel: "Mécanicien",
  dayOfWeek: 1,
  branchNames: [],
  icon: "",
  professionPrefix: "MECAUTO",
};

test("9 — deux badges A/B du même cours ouvrent des semaines différentes", () => {
  const assigned = course({
    annualCourseId: "ac-chassis",
    scheduleSlots: [
      { dayOfWeek: 4, weekKind: "A" },
      { dayOfWeek: 4, weekKind: "B" },
    ],
  });
  const groups = groupMaSemaineByMeetingDays([SETUP], [assigned], "A");
  const thursday = groups.find((group) => group.dayOfWeek === 4);
  const badges = thursday?.classes[0]?.courses ?? [];
  assert.deepEqual(badges.map((badge) => badge.weekSuffix), ["A", "B"]);
  assert.equal(new Set(badges.map((badge) => badge.annualCourseId)).size, 1);
  const opened = badges.map((badge) => open(SCHOOL, 12, badge.weekSuffix));
  assert.deepEqual(opened, [
    { ok: true, schoolWeekNumber: 12 },
    { ok: true, schoolWeekNumber: 13 },
  ]);
});

test("10 — plusieurs créneaux du même rythme : un seul badge", () => {
  const assigned = course({
    annualCourseId: "ac-chassis",
    scheduleSlots: [
      { dayOfWeek: 4, weekKind: "A" },
      { dayOfWeek: 4, weekKind: "A" },
    ],
  });
  const groups = groupMaSemaineByMeetingDays([SETUP], [assigned], "B");
  const badges = groups.find((group) => group.dayOfWeek === 4)?.classes[0]?.courses ?? [];
  assert.equal(badges.length, 1);
  assert.equal(badges[0]?.weekSuffix, "A");
  assert.deepEqual(open(SCHOOL, 13, badges[0]?.weekSuffix ?? null), { ok: true, schoolWeekNumber: 14 });
});

test("MeetingDay prioritaire : pas de suffixe de créneau, la semaine consultée est conservée", () => {
  const meetingDays: TeacherCourseMeetingDay[] = [{ dayOfWeek: 4, weekKind: "B", role: "PRIMARY" }];
  const assigned = course({
    annualCourseId: "ac-chassis",
    meetingDays,
    scheduleSlots: [{ dayOfWeek: 1, weekKind: "A" }],
  });
  const groups = groupMaSemaineByMeetingDays([SETUP], [assigned], "B");
  const badge = groups.find((group) => group.dayOfWeek === 4)?.classes[0]?.courses[0];
  assert.equal(badge?.weekSuffix, null);
  assert.deepEqual(open(SCHOOL, 13, badge?.weekSuffix ?? null), { ok: true, schoolWeekNumber: 13 });
});

test("11-12 — retour Ma semaine et navigation du carnet ne partagent pas la semaine", async () => {
  const page = await readFile(new URL("../web/app/page.tsx", import.meta.url), "utf8");
  const notebook = await readFile(new URL("../web/app/components/class-notebook-panel.tsx", import.meta.url), "utf8");
  const semaine = await readFile(new URL("../web/app/components/ma-semaine-panel.tsx", import.meta.url), "utf8");
  assert.match(page, /setNotebookCenterWeek\(target\.schoolWeekNumber\)/);
  assert.match(page, /function closeClassNotebook\(\) \{\s*setOpenNotebookClassId\(null\);\s*setOpenNotebookCourse\(null\);/);
  assert.doesNotMatch(page, /function closeClassNotebook\([\s\S]{0,220}setSelectedSchoolWeekNumber/);
  assert.match(page, /function shiftNotebookWeeks[\s\S]{0,280}setNotebookCenterWeek\(target\.number\)/);
  assert.doesNotMatch(page, /function shiftNotebookWeeks[\s\S]{0,280}setSelectedSchoolWeekNumber/);
  assert.match(page, /onCenterWeekChange=\{setNotebookCenterWeek\}/);
  assert.match(page, /onSelectSchoolWeek=\{setSelectedSchoolWeekNumber\}/);
  assert.doesNotMatch(notebook, /setSelectedSchoolWeekNumber/);
  assert.doesNotMatch(semaine, /matchMedia|innerWidth/);
  assert.equal([...page.matchAll(/function openCourseInWeek/g)].length, 1);
});

test("13-16 — l’ouverture ne modifie ni séances, ni jours de séance, ni attributions", async () => {
  const [opening, sessions, meetingDays, assignments] = await Promise.all([
    readFile(new URL("../src/features/class-notebook/open-course.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/course-sessions/compute.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/annual-courses/meeting-days.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/annual-courses/service.ts", import.meta.url), "utf8"),
  ]);
  assert.match(opening, /resolveCourseOpeningWeek/);
  assert.doesNotMatch(opening, /computeCourseSessions|replaceAnnualCourseMeetingDays|assignTeacherToCourse/);
  assert.doesNotMatch(sessions, /resolveCourseOpeningWeek/);
  assert.doesNotMatch(meetingDays, /resolveCourseOpeningWeek/);
  assert.doesNotMatch(assignments, /resolveCourseOpeningWeek/);
});
