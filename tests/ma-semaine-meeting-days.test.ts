import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { TeacherClassSetup } from "../src/features/teacher-setup/index.ts";
import {
  groupMaSemaineByMeetingDays,
  maSemaineBranchBadgeLabel,
  officialDisplayDaysForCourse,
  type TeacherCourseMeetingDay,
  type TeacherCourseScheduleSlotView,
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

test("cas 5 — aucun MeetingDay ni ClassAttendanceDay : repli sur la préférence legacy", () => {
  const assigned = course({ annualCourseId: "ac-legacy" });
  const groups = groupMaSemaineByMeetingDays([setup(1)], [assigned], "A");
  assert.deepEqual(daysOn(groups), [1]);
  assert.deepEqual(courseIdsOn(groups, 1), ["ac-legacy"]);
  assert.deepEqual(officialDisplayDaysForCourse(undefined, undefined, 4, "A"), [4]);
  assert.deepEqual(officialDisplayDaysForCourse([], [], 3, "B"), [3]);
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
  const [panel, page, service] = await Promise.all([
    readFile(new URL("../web/app/components/ma-semaine-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/teacher-workspace/service.ts", import.meta.url), "utf8"),
  ]);
  assert.match(panel, /groupMaSemaineByMeetingDays/);
  assert.match(panel, /Les cours sont affichés selon les jours configurés dans l’horaire des classes/);
  assert.doesNotMatch(panel, /préférence personnelle/);
  assert.doesNotMatch(panel, /groupClassesByWeekday/);
  assert.match(page, /jours configurés dans l’horaire des classes/);
  const config = await readFile(new URL("../web/app/components/configuration-panel.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(config, /upsertSetupPreferenceForCourse/);
  assert.doesNotMatch(config, /Jour d’affichage/);
  assert.match(service, /listAttendanceDays/);
  assert.match(service, /classAttendanceDays/);
  assert.match(service, /listSlots/);
  assert.match(service, /scheduleSlots/);
  assert.match(panel, /maSemaineBranchBadgeLabel/);
  assert.match(panel, /suffixe -A ou -B/);
});

const TUESDAY_ALL: TeacherCourseMeetingDay[] = [{ dayOfWeek: 2, weekKind: "all", role: "PRIMARY" }];
const THURSDAY_ALL: TeacherCourseMeetingDay[] = [{ dayOfWeek: 4, weekKind: "all", role: "PRIMARY" }];
const THURSDAY_B: TeacherCourseMeetingDay[] = [{ dayOfWeek: 4, weekKind: "B", role: "PRIMARY" }];
const TUESDAY_A: TeacherCourseMeetingDay[] = [{ dayOfWeek: 2, weekKind: "A", role: "PRIMARY" }];

test("attendance 1 — aucun MeetingDay + classe mardi/all + préférence lundi → mardi uniquement", () => {
  const injection = course({
    annualCourseId: "ac-injection",
    branchLabel: "CP Léger Injection, dépollution",
    classAttendanceDays: TUESDAY_ALL,
  });
  const transmission = course({
    annualCourseId: "ac-transmission",
    branchId: "br-2",
    branchCode: "br-2",
    branchLabel: "CP2 Transmission",
    classAttendanceDays: TUESDAY_ALL,
  });
  const groups = groupMaSemaineByMeetingDays([setup(1)], [injection, transmission], "A");
  assert.deepEqual(daysOn(groups), [2]);
  assert.deepEqual(courseIdsOn(groups, 2), ["ac-injection", "ac-transmission"]);
  assert.deepEqual(courseIdsOn(groups, 1), []);
});

test("attendance 2 — MeetingDay jeudi/all + classe mardi/all → jeudi uniquement", () => {
  const assigned = course({
    annualCourseId: "ac-mecma",
    meetingDays: THURSDAY_ALL,
    classAttendanceDays: TUESDAY_ALL,
  });
  const groups = groupMaSemaineByMeetingDays([setup(1)], [assigned], "A");
  assert.deepEqual(daysOn(groups), [4]);
  assert.deepEqual(courseIdsOn(groups, 2), []);
  assert.deepEqual(courseIdsOn(groups, 1), []);
});

test("attendance 3 — MeetingDay jeudi/B + classe mardi/all, semaine A → absent (pas de repli)", () => {
  const assigned = course({
    annualCourseId: "ac-mecma",
    meetingDays: THURSDAY_B,
    classAttendanceDays: TUESDAY_ALL,
  });
  const weekA = groupMaSemaineByMeetingDays([setup(1)], [assigned], "A");
  assert.deepEqual(daysOn(weekA), []);
  assert.deepEqual(courseIdsOn(weekA, 2), []);
  assert.deepEqual(courseIdsOn(weekA, 1), []);
  assert.deepEqual(officialDisplayDaysForCourse(THURSDAY_B, TUESDAY_ALL, 1, "A"), []);
});

test("attendance 4 — MeetingDay jeudi/B + classe mardi/all, semaine B → jeudi", () => {
  const assigned = course({
    annualCourseId: "ac-mecma",
    meetingDays: THURSDAY_B,
    classAttendanceDays: TUESDAY_ALL,
  });
  const weekB = groupMaSemaineByMeetingDays([setup(1)], [assigned], "B");
  assert.deepEqual(daysOn(weekB), [4]);
  assert.deepEqual(courseIdsOn(weekB, 4), ["ac-mecma"]);
  assert.deepEqual(courseIdsOn(weekB, 2), []);
});

test("attendance 5 — aucun MeetingDay + classe mardi/A, semaine A → mardi", () => {
  const assigned = course({
    annualCourseId: "ac-mecma",
    classAttendanceDays: TUESDAY_A,
  });
  const weekA = groupMaSemaineByMeetingDays([setup(1)], [assigned], "A");
  assert.deepEqual(daysOn(weekA), [2]);
  assert.deepEqual(courseIdsOn(weekA, 2), ["ac-mecma"]);
});

test("attendance 6 — aucun MeetingDay + classe mardi/A, semaine B → absent (pas de repli personnel)", () => {
  const assigned = course({
    annualCourseId: "ac-mecma",
    classAttendanceDays: TUESDAY_A,
  });
  const weekB = groupMaSemaineByMeetingDays([setup(1)], [assigned], "B");
  assert.deepEqual(daysOn(weekB), []);
  assert.deepEqual(courseIdsOn(weekB, 1), []);
  assert.deepEqual(officialDisplayDaysForCourse([], TUESDAY_A, 1, "B"), []);
});

test("attendance 7 — aucun MeetingDay + aucun ClassAttendanceDay + préférence lundi → lundi", () => {
  const assigned = course({ annualCourseId: "ac-legacy", classAttendanceDays: [] });
  const groups = groupMaSemaineByMeetingDays([setup(1)], [assigned], "B");
  assert.deepEqual(daysOn(groups), [1]);
  assert.deepEqual(courseIdsOn(groups, 1), ["ac-legacy"]);
});

function classSetup(
  id: string,
  name: string,
  dayOfWeek: TeacherClassSetup["dayOfWeek"] = 1,
): TeacherClassSetup {
  return {
    id,
    name,
    programLabel: "Mécanicien",
    dayOfWeek,
    branchNames: ["Branche"],
    icon: "",
    professionPrefix: "MECAUTO",
  };
}

function badgesOn(
  groups: ReturnType<typeof groupMaSemaineByMeetingDays>,
  dayOfWeek: number,
  classId: string,
): string[] {
  const group = groups.find((entry) => entry.dayOfWeek === dayOfWeek);
  const card = group?.classes.find((entry) => entry.setup.id === classId);
  return card?.courses.map((item) => maSemaineBranchBadgeLabel(item.branchLabel, item.weekSuffix)) ?? [];
}

test("créneau — Châssis jeudi A/B : les deux classes restent le jeudi, suffixe sur la branche", () => {
  const setups = [classSetup("class-3a", "MECAUTO3A", 1), classSetup("class-3b", "MECAUTO3B", 1)];
  const injectionA = course({
    annualCourseId: "ac-injection-a",
    classId: "class-3a",
    classCode: "MECAUTO3A",
    branchLabel: "CP VL Injection - Dépollution",
    scheduleSlots: [{ dayOfWeek: 1, weekKind: "all" }],
    classAttendanceDays: [
      { dayOfWeek: 1, weekKind: "all", role: "PRIMARY" },
      { dayOfWeek: 4, weekKind: "all", role: "ADDITIONAL" },
    ],
  });
  const chassisA = course({
    annualCourseId: "ac-chassis-a",
    classId: "class-3a",
    classCode: "MECAUTO3A",
    branchId: "br-chassis",
    branchCode: "chassis",
    branchLabel: "CP 3 Châssis",
    scheduleSlots: [{ dayOfWeek: 4, weekKind: "A" }],
    classAttendanceDays: injectionA.classAttendanceDays,
  });
  const injectionB = course({
    ...injectionA,
    annualCourseId: "ac-injection-b",
    classId: "class-3b",
    classCode: "MECAUTO3B",
    assignmentId: "ac-injection-b-as",
  });
  const chassisB = course({
    ...chassisA,
    annualCourseId: "ac-chassis-b",
    classId: "class-3b",
    classCode: "MECAUTO3B",
    assignmentId: "ac-chassis-b-as",
    scheduleSlots: [{ dayOfWeek: 4, weekKind: "B" }],
  });
  const courses = [injectionA, chassisA, injectionB, chassisB];

  for (const week of ["A", "B"] as const) {
    const groups = groupMaSemaineByMeetingDays(setups, courses, week);
    assert.deepEqual(daysOn(groups), [1, 4], `semaine ${week}`);
    assert.deepEqual(badgesOn(groups, 1, "class-3a"), ["CP VL Injection - Dépollution"]);
    assert.deepEqual(badgesOn(groups, 1, "class-3b"), ["CP VL Injection - Dépollution"]);
    assert.deepEqual(badgesOn(groups, 4, "class-3a"), ["CP 3 Châssis-A"]);
    assert.deepEqual(badgesOn(groups, 4, "class-3b"), ["CP 3 Châssis-B"]);
    assert.deepEqual(courseIdsOn(groups, 4), ["ac-chassis-a", "ac-chassis-b"]);
  }
});

test("créneau — même classe jeudi A et jeudi B : deux badges, visibles dans les deux semaines", () => {
  const slots: TeacherCourseScheduleSlotView[] = [
    { dayOfWeek: 4, weekKind: "A" },
    { dayOfWeek: 4, weekKind: "A" },
    { dayOfWeek: 4, weekKind: "B" },
  ];
  const assigned = course({
    annualCourseId: "ac-chassis",
    branchLabel: "CP 3 Châssis",
    scheduleSlots: slots,
    classAttendanceDays: [{ dayOfWeek: 1, weekKind: "all", role: "PRIMARY" }],
  });
  const weekA = groupMaSemaineByMeetingDays([setup(1)], [assigned], "A");
  const weekB = groupMaSemaineByMeetingDays([setup(1)], [assigned], "B");
  assert.deepEqual(badgesOn(weekA, 4, "class-mecma3a"), ["CP 3 Châssis-A", "CP 3 Châssis-B"]);
  assert.deepEqual(badgesOn(weekB, 4, "class-mecma3a"), ["CP 3 Châssis-A", "CP 3 Châssis-B"]);
  assert.deepEqual(daysOn(weekA), [4]);
  assert.deepEqual(courseIdsOn(weekA, 1), []);
});

test("créneau — jeudi toutes les semaines : un badge sans suffixe", () => {
  const assigned = course({
    annualCourseId: "ac-chassis",
    branchLabel: "CP 3 Châssis",
    scheduleSlots: [{ dayOfWeek: 4, weekKind: "all" }],
  });
  const groups = groupMaSemaineByMeetingDays([setup(1)], [assigned], "B");
  assert.deepEqual(badgesOn(groups, 4, "class-mecma3a"), ["CP 3 Châssis"]);
  assert.equal(groups[0]?.classes[0]?.courses[0]?.weekSuffix, null);
});

test("créneau — MeetingDay jeudi B prime sur un créneau lundi, sans repli en semaine A", () => {
  const assigned = course({
    annualCourseId: "ac-mecma",
    meetingDays: [{ dayOfWeek: 4, weekKind: "B", role: "PRIMARY" }],
    scheduleSlots: [{ dayOfWeek: 1, weekKind: "all" }],
    classAttendanceDays: [{ dayOfWeek: 2, weekKind: "all", role: "PRIMARY" }],
  });
  const weekA = groupMaSemaineByMeetingDays([setup(1)], [assigned], "A");
  const weekB = groupMaSemaineByMeetingDays([setup(1)], [assigned], "B");
  assert.deepEqual(daysOn(weekA), []);
  assert.deepEqual(badgesOn(weekB, 4, "class-mecma3a"), ["Branche"]);
  assert.equal(weekB[0]?.classes[0]?.courses[0]?.weekSuffix, null);
});
