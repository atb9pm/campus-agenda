import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { TeacherClassSetup, WeekdayIndex } from "../src/features/teacher-setup/index.ts";
import {
  groupMaSemaineByMeetingDays,
  maSemaineBranchBadgeLabel,
  type TeacherCourseWorkspaceEntry,
} from "../src/features/teacher-workspace/index.ts";

const TODAY = "2027-10-15T12:00:00.000Z";

function setup(id: string, name: string, dayOfWeek: WeekdayIndex = 1): TeacherClassSetup {
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

function course(
  patch: Partial<TeacherCourseWorkspaceEntry> & {
    annualCourseId: string;
    classId: string;
    classCode: string;
  },
): TeacherCourseWorkspaceEntry {
  return {
    assignmentId: `${patch.annualCourseId}-as`,
    role: "PRIMARY",
    validFrom: TODAY,
    validTo: null,
    schoolYearId: patch.schoolYearId ?? "year-2027",
    schoolYearLabel: "2027-2028",
    classLabel: patch.classCode,
    classSortOrder: 1,
    professionId: null,
    professionLabel: "Mécanicien",
    professionClassCodePrefix: "MECAUTO",
    trainingYear: 2,
    parallelCode: null,
    contextId: "ctx-1",
    branchId: patch.branchId ?? "br-1",
    branchCode: patch.branchCode ?? "br-1",
    branchLabel: patch.branchLabel ?? "Branche",
    branchSortOrder: 1,
    teachingType: "TECHNICAL",
    ...patch,
  };
}

function classNames(
  groups: ReturnType<typeof groupMaSemaineByMeetingDays>,
  dayOfWeek: number,
): string[] {
  return groups.find((group) => group.dayOfWeek === dayOfWeek)?.classes.map((entry) => entry.setup.name) ?? [];
}

function badges(
  groups: ReturnType<typeof groupMaSemaineByMeetingDays>,
  dayOfWeek: number,
  classId: string,
): string[] {
  const card = groups
    .find((group) => group.dayOfWeek === dayOfWeek)
    ?.classes.find((entry) => entry.setup.id === classId);
  return card?.courses.map((item) => maSemaineBranchBadgeLabel(item.branchLabel, item.weekSuffix)) ?? [];
}

test("période — P1 avant P5, indépendamment de l’ordre des classes", () => {
  const setups = [setup("class-ma", "MA4A"), setup("class-m2", "MECAUTO2")];
  const courses = [
    course({
      annualCourseId: "ac-ma",
      classId: "class-ma",
      classCode: "MA4A",
      branchLabel: "Électrotechnique",
      scheduleSlots: [{ dayOfWeek: 1, weekKind: "all", periodStart: 5 }],
    }),
    course({
      annualCourseId: "ac-m2",
      classId: "class-m2",
      classCode: "MECAUTO2",
      branchLabel: "Moteur",
      scheduleSlots: [{ dayOfWeek: 1, weekKind: "all", periodStart: 1 }],
    }),
  ];
  assert.deepEqual(classNames(groupMaSemaineByMeetingDays(setups, courses, "A"), 1), ["MECAUTO2", "MA4A"]);
});

test("période — P3 précède P10, tri numérique", () => {
  const setups = [setup("class-late", "ZZZ"), setup("class-early", "AAA")];
  const courses = [
    course({
      annualCourseId: "ac-late",
      classId: "class-late",
      classCode: "ZZZ",
      scheduleSlots: [{ dayOfWeek: 1, weekKind: "A", periodStart: 10 }],
    }),
    course({
      annualCourseId: "ac-early",
      classId: "class-early",
      classCode: "AAA",
      scheduleSlots: [{ dayOfWeek: 1, weekKind: "A", periodStart: 3 }],
    }),
  ];
  assert.deepEqual(classNames(groupMaSemaineByMeetingDays(setups, courses, "A"), 1), ["AAA", "ZZZ"]);
});

test("période — plusieurs branches : la carte suit la première période, sans doublon", () => {
  const setups = [setup("class-3a", "MECAUTO3A"), setup("class-other", "MECAUTO4")];
  const courses = [
    course({
      annualCourseId: "ac-other",
      classId: "class-other",
      classCode: "MECAUTO4",
      branchLabel: "Électricité",
      scheduleSlots: [{ dayOfWeek: 1, weekKind: "all", periodStart: 3 }],
    }),
    course({
      annualCourseId: "ac-moteur",
      classId: "class-3a",
      classCode: "MECAUTO3A",
      branchLabel: "Moteur",
      scheduleSlots: [{ dayOfWeek: 1, weekKind: "all", periodStart: 5 }],
    }),
    course({
      annualCourseId: "ac-chassis",
      classId: "class-3a",
      classCode: "MECAUTO3A",
      branchId: "br-chassis",
      branchCode: "chassis",
      branchLabel: "Châssis",
      scheduleSlots: [{ dayOfWeek: 1, weekKind: "all", periodStart: 1 }],
    }),
  ];
  const groups = groupMaSemaineByMeetingDays(setups, courses, "A");
  assert.deepEqual(classNames(groups, 1), ["MECAUTO3A", "MECAUTO4"]);
  assert.equal(groups[0]?.classes.filter((entry) => entry.setup.id === "class-3a").length, 1);
  assert.deepEqual(badges(groups, 1, "class-3a"), ["Châssis", "Moteur"]);
  assert.deepEqual(
    groups[0]?.classes[0]?.courses.map((item) => item.annualCourseId),
    ["ac-chassis", "ac-moteur"],
  );
});

test("période — semaine A et semaine B peuvent inverser l’ordre", () => {
  const setups = [setup("class-m2", "MECAUTO2"), setup("class-ma", "MA4A")];
  const courses = [
    course({
      annualCourseId: "ac-m2",
      classId: "class-m2",
      classCode: "MECAUTO2",
      meetingDays: [{ dayOfWeek: 1, weekKind: "all", role: "PRIMARY" }],
      scheduleSlots: [
        { dayOfWeek: 1, weekKind: "A", periodStart: 1 },
        { dayOfWeek: 1, weekKind: "B", periodStart: 7 },
      ],
    }),
    course({
      annualCourseId: "ac-ma",
      classId: "class-ma",
      classCode: "MA4A",
      meetingDays: [{ dayOfWeek: 1, weekKind: "all", role: "PRIMARY" }],
      scheduleSlots: [
        { dayOfWeek: 1, weekKind: "A", periodStart: 5 },
        { dayOfWeek: 1, weekKind: "B", periodStart: 1 },
      ],
    }),
  ];
  assert.deepEqual(classNames(groupMaSemaineByMeetingDays(setups, courses, "A"), 1), ["MECAUTO2", "MA4A"]);
  assert.deepEqual(classNames(groupMaSemaineByMeetingDays(setups, courses, "B"), 1), ["MA4A", "MECAUTO2"]);
});

test("période — même départ : ordre stable par code de classe", () => {
  const setups = [setup("class-b", "MECAUTO3A"), setup("class-a", "MECAUTO2")];
  const courses = [
    course({
      annualCourseId: "ac-b",
      classId: "class-b",
      classCode: "MECAUTO3A",
      scheduleSlots: [{ dayOfWeek: 1, weekKind: "all", periodStart: 1 }],
    }),
    course({
      annualCourseId: "ac-a",
      classId: "class-a",
      classCode: "MECAUTO2",
      scheduleSlots: [{ dayOfWeek: 1, weekKind: "all", periodStart: 1 }],
    }),
  ];
  assert.deepEqual(classNames(groupMaSemaineByMeetingDays(setups, courses, "A"), 1), ["MECAUTO2", "MECAUTO3A"]);
});

test("période — classe sans période reste affichée, après celles qui en ont une", () => {
  const setups = [setup("class-unknown", "AMA2A"), setup("class-known", "MECAUTO2")];
  const courses = [
    course({
      annualCourseId: "ac-unknown",
      classId: "class-unknown",
      classCode: "AMA2A",
      meetingDays: [{ dayOfWeek: 1, weekKind: "all", role: "PRIMARY" }],
    }),
    course({
      annualCourseId: "ac-known",
      classId: "class-known",
      classCode: "MECAUTO2",
      scheduleSlots: [{ dayOfWeek: 1, weekKind: "all", periodStart: 7 }],
    }),
  ];
  const groups = groupMaSemaineByMeetingDays(setups, courses, "B");
  assert.deepEqual(classNames(groups, 1), ["MECAUTO2", "AMA2A"]);
  assert.equal(groups[0]?.classes.length, 2);
});

test("période — le regroupement par jour ne change pas, un créneau d’un autre jour ne trie pas", () => {
  const setups = [setup("class-a", "MECAUTO2"), setup("class-b", "MA4A")];
  const courses = [
    course({
      annualCourseId: "ac-a",
      classId: "class-a",
      classCode: "MECAUTO2",
      scheduleSlots: [
        { dayOfWeek: 1, weekKind: "all", periodStart: 1 },
        { dayOfWeek: 2, weekKind: "all", periodStart: 8 },
      ],
    }),
    course({
      annualCourseId: "ac-b",
      classId: "class-b",
      classCode: "MA4A",
      scheduleSlots: [{ dayOfWeek: 2, weekKind: "all", periodStart: 3 }],
    }),
  ];
  const groups = groupMaSemaineByMeetingDays(setups, courses, "A");
  assert.deepEqual(groups.map((group) => group.dayOfWeek), [1, 2]);
  assert.deepEqual(classNames(groups, 1), ["MECAUTO2"]);
  assert.deepEqual(classNames(groups, 2), ["MA4A", "MECAUTO2"]);
});

test("période — plusieurs blocs : la première période de la journée compte", () => {
  const setups = [setup("class-split", "MECAUTO2"), setup("class-mid", "MECAUTO3A")];
  const courses = [
    course({
      annualCourseId: "ac-split",
      classId: "class-split",
      classCode: "MECAUTO2",
      scheduleSlots: [
        { dayOfWeek: 1, weekKind: "all", periodStart: 7 },
        { dayOfWeek: 1, weekKind: "all", periodStart: 1 },
      ],
    }),
    course({
      annualCourseId: "ac-mid",
      classId: "class-mid",
      classCode: "MECAUTO3A",
      scheduleSlots: [{ dayOfWeek: 1, weekKind: "all", periodStart: 3 }],
    }),
  ];
  assert.deepEqual(classNames(groupMaSemaineByMeetingDays(setups, courses, "A"), 1), [
    "MECAUTO2",
    "MECAUTO3A",
  ]);
});

test("période — les créneaux d’une autre année ne sont pas ceux du cours consulté", () => {
  const setups = [setup("class-now", "MECAUTO2")];
  const consulted = course({
    annualCourseId: "ac-now",
    classId: "class-now",
    classCode: "MECAUTO2",
    schoolYearId: "year-2027",
    scheduleSlots: [{ dayOfWeek: 1, weekKind: "all", periodStart: 8 }],
  });
  const groups = groupMaSemaineByMeetingDays(setups, [consulted], "A");
  assert.equal(groups[0]?.classes[0]?.courses[0]?.schoolYearId, "year-2027");
  assert.equal(groups[0]?.classes[0]?.courses[0]?.annualCourseId, "ac-now");
  assert.deepEqual(classNames(groups, 1), ["MECAUTO2"]);
});

test("sources — le tri lit periodStart du créneau de l’année du cours, l’écran ne retrie pas", async () => {
  const [days, service, queries, panel, css] = await Promise.all([
    readFile(new URL("../src/features/teacher-workspace/ma-semaine-days.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/teacher-workspace/service.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/teacher-workspace/queries.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/app/components/ma-semaine-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(days, /periodStart < earliest/);
  assert.match(days, /localeCompare\(right\.setup\.name, "fr-CH"\)/);
  assert.match(service, /periodStart: slot\.periodStart/);
  assert.match(service, /slotsByCourse\.get\(slot\.annualCourseId\)/);
  assert.match(queries, /course\.schoolYearId !== schoolYearId/);
  assert.match(panel, /groupMaSemaineByMeetingDays\(activeClasses, courses, selectedWeek\?\.kind/);
  assert.match(panel, /onOpenCourse\(course\)/);
  assert.match(panel, /onOpenCourse\(uniqueCourse\)/);
  assert.match(css, /\.ma-semaine-class-card \{/);
  assert.doesNotMatch(panel, /sort\(/);
});
