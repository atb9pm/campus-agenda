import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { PrototypeAgendaItem } from "../src/features/agenda/demo-items.ts";
import type { AnnualCourseMeetingDayInput } from "../src/features/annual-courses/meeting-days.ts";
import type { AnnualCourse } from "../src/features/annual-courses/types.ts";
import type { CourseScheduleSlot, CourseWeekKind, CourseWeekday } from "../src/features/course-schedule/types.ts";
import type { AnnualCourseNote } from "../src/features/pedagogical-path/annual-notes.ts";
import type { SchoolWeekEntry } from "../src/features/school-year/types.ts";
import {
  TARGET_MEETING_DAY_PLAN_REQUIRED,
  TARGET_MEETING_DAY_PLAN_REQUIRED_REASON,
  YearTransitionPreviewContractError,
  assembleLiveYearTransitionPreviewInput,
  buildYearTransitionPreview,
  canonicalizeTargetMeetingDayPlans,
  parseYearTransitionPreviewRequest,
  pendingTargetClassId,
  pendingTargetCourseId,
  previewHasBlockingEntries,
  previewPrivateNotes,
  yearTransitionPreviewFingerprint,
  type YearTransitionTargetMeetingDayPlan,
} from "../src/features/year-transition/index.ts";
import { yearTransitionSourceMaterialFingerprint } from "../src/features/year-transition/fingerprint.ts";
import { MemoryAgendaStore } from "../src/lib/persistence/memory-store.ts";
import { MemoryAnnualCourseStore } from "../src/lib/persistence/memory-annual-course-store.ts";
import {
  MemoryAnnualCourseNotesStore,
  MemoryPedagogicalPathStore,
} from "../src/lib/persistence/memory-pedagogical-path-store.ts";
import { MemoryCourseScheduleStore } from "../src/lib/persistence/memory-course-schedule-store.ts";
import {
  MemorySchoolYearStore,
  replaceMemorySchoolYears,
  resetMemorySchoolYearStore,
} from "../src/lib/persistence/memory-school-year-store.ts";

const SOURCE_YEAR = "year-n";
const TARGET_YEAR = "year-n1";
const SOURCE_CLASS = "class-ma1a-n";
const SOURCE_INJECTION = "ac-injection-n";
const SOURCE_CHASSIS = "ac-chassis-n";
const CTX_INJECTION = "ctx-injection";
const CTX_CHASSIS = "ctx-chassis";
const TEACHER_A = "teacher-a";
const TEACHER_B = "teacher-b";

function mondayWeeks(startMonday: string, count: number, skip: string[] = []): SchoolWeekEntry[] {
  const weeks: SchoolWeekEntry[] = [];
  const [year, month, day] = startMonday.split("-").map(Number);
  const cursor = new Date(year!, month! - 1, day!, 12);
  let number = 1;
  while (weeks.length < count) {
    const iso = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
    if (!skip.includes(iso)) {
      weeks.push({
        number,
        kind: number % 2 === 1 ? "A" : "B",
        monday: iso,
      });
      number += 1;
    }
    cursor.setDate(cursor.getDate() + 7);
  }
  return weeks;
}

function yearWeeks(skip: string[] = []): SchoolWeekEntry[] {
  return mondayWeeks("2027-08-23", 6, skip);
}

function course(id: string, contextId: string, classId = SOURCE_CLASS): AnnualCourse {
  return {
    id,
    schoolYearId: SOURCE_YEAR,
    classId,
    contextId,
    isArchived: false,
    archivedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function slot(
  annualCourseId: string,
  dayOfWeek: CourseWeekday,
  weekKind: CourseWeekKind = "all",
  id = `slot-${annualCourseId}-${dayOfWeek}`,
): CourseScheduleSlot {
  return {
    id,
    annualCourseId,
    dayOfWeek,
    periodStart: 2,
    periodEnd: 3,
    weekKind,
    validFrom: null,
    validTo: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

function plan(
  sourceAnnualCourseId: string,
  days: AnnualCourseMeetingDayInput[],
): YearTransitionTargetMeetingDayPlan {
  return { sourceAnnualCourseId, days };
}

function mondayAll(sourceAnnualCourseId: string): YearTransitionTargetMeetingDayPlan {
  return plan(sourceAnnualCourseId, [{ dayOfWeek: 1, weekKind: "all", role: "PRIMARY" }]);
}

function thursdayB(sourceAnnualCourseId: string): YearTransitionTargetMeetingDayPlan {
  return plan(sourceAnnualCourseId, [{ dayOfWeek: 4, weekKind: "B", role: "PRIMARY" }]);
}

function mondayAllThursdayB(sourceAnnualCourseId: string): YearTransitionTargetMeetingDayPlan {
  return plan(sourceAnnualCourseId, [
    { dayOfWeek: 1, weekKind: "all", role: "PRIMARY" },
    { dayOfWeek: 4, weekKind: "B", role: "ADDITIONAL" },
  ]);
}

function item(patch: Partial<PrototypeAgendaItem> & Pick<PrototypeAgendaItem, "id" | "title">): PrototypeAgendaItem {
  return {
    classroomId: "rt-ma1",
    subjectId: "subj-injection",
    authorTeacherId: TEACHER_A,
    day: 0,
    hour: 9,
    weekOffset: 0,
    schoolWeekNumber: 1,
    type: "HOMEWORK",
    detail: "N",
    schoolYearId: SOURCE_YEAR,
    annualCourseId: SOURCE_INJECTION,
    courseSessionKey: `${SOURCE_YEAR}|${SOURCE_INJECTION}|2027-08-23`,
    courseSessionDate: "2027-08-23",
    referenceItemId: null,
    referenceSessionId: null,
    studentVisible: true,
    ...patch,
  };
}

function note(
  id: string,
  ownerTeacherId: string,
  date = "2027-08-23",
  annualCourseId = SOURCE_INJECTION,
  contextId = CTX_INJECTION,
): AnnualCourseNote {
  return {
    id,
    schoolYearId: SOURCE_YEAR,
    classId: SOURCE_CLASS,
    contextId,
    referenceSessionId: null,
    authorTeacherId: ownerTeacherId,
    ownerTeacherId,
    text: `Note ${id}`,
    body: null,
    courseSessionKey: `${SOURCE_YEAR}|${annualCourseId}|${date}`,
    legacyNoteId: null,
    notebookPosition: 0,
    sourceNoteId: null,
    sourceSchoolYearId: null,
    inheritedAt: null,
    annualCourseId,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
}

async function world(options: {
  extraCourses?: AnnualCourse[];
  extraSlots?: CourseScheduleSlot[];
  extraItems?: PrototypeAgendaItem[];
  skipWeeks?: string[];
  exceptions?: { date: string; state: "class" | "holiday"; label: string | null }[];
} = {}) {
  resetMemorySchoolYearStore();
  const weeks = yearWeeks(options.skipWeeks);
  replaceMemorySchoolYears(
    [
      {
        id: SOURCE_YEAR,
        label: "2026-2027",
        status: "active",
        startsOn: "2026-08-17",
        endsOn: "2027-07-02",
        sourceFilename: null,
        importedAt: null,
        activatedAt: "2026-08-01T00:00:00.000Z",
        createdAt: "2026-01-01T00:00:00.000Z",
        weeks,
      },
      {
        id: TARGET_YEAR,
        label: "2027-2028",
        status: "draft",
        startsOn: "2027-08-23",
        endsOn: "2028-07-01",
        sourceFilename: null,
        importedAt: null,
        activatedAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        weeks,
      },
    ],
    options.exceptions
      ? new Map([[TARGET_YEAR, options.exceptions]])
      : undefined,
  );

  const courses = new MemoryAnnualCourseStore();
  await courses.createCourse(course(SOURCE_INJECTION, CTX_INJECTION));
  for (const extra of options.extraCourses ?? []) await courses.createCourse(extra);

  const schedules = new MemoryCourseScheduleStore();
  await schedules.createSlot(slot(SOURCE_INJECTION, 1, "all"));
  for (const extra of options.extraSlots ?? []) await schedules.createSlot(extra);

  const agenda = new MemoryAgendaStore(
    options.extraItems ?? [item({ id: 10, title: "Devoir injection" })],
  );
  const years = new MemorySchoolYearStore();

  return {
    deps: {
      courses,
      agenda,
      paths: new MemoryPedagogicalPathStore(),
      years,
      schedules,
      notes: new MemoryAnnualCourseNotesStore(),
    },
    mappings: [{ sourceClassId: SOURCE_CLASS, targetClassId: pendingTargetClassId(SOURCE_CLASS) }],
    pendingCourseId: pendingTargetCourseId(SOURCE_INJECTION),
  };
}

async function assembleWithPlans(
  seeded: Awaited<ReturnType<typeof world>>,
  plans: YearTransitionTargetMeetingDayPlan[],
  selectedSourceAnnualCourseIds?: readonly string[],
) {
  return assembleLiveYearTransitionPreviewInput(
    {
      sourceSchoolYearId: SOURCE_YEAR,
      targetSchoolYearId: TARGET_YEAR,
      classMappings: seeded.mappings,
      selectedSourceClassIds: [SOURCE_CLASS],
      targetMeetingDayPlans: plans,
      ...(selectedSourceAnnualCourseIds !== undefined
        ? { selectedSourceAnnualCourseIds: [...selectedSourceAnnualCourseIds] }
        : {}),
    },
    seeded.deps,
  );
}

function sessionsOf(input: Awaited<ReturnType<typeof assembleWithPlans>>, annualCourseId: string) {
  return input.targetCourseSessions.filter((session) => session.annualCourseId === annualCourseId);
}

test("1 — cours cible lundi/all : séances sur les lundis N+1, segments vides", async () => {
  const seeded = await world();
  const input = await assembleWithPlans(seeded, [mondayAll(SOURCE_INJECTION)]);
  const sessions = sessionsOf(input, seeded.pendingCourseId);
  assert.ok(sessions.length > 0);
  assert.ok(sessions.every((session) => session.dayOfWeek === 1));
  assert.ok(sessions.every((session) => session.segments.length === 0));
  assert.equal(input.targetMeetingDayPlans?.[0]?.days[0]?.dayOfWeek, 1);
});

test("2 — cours cible jeudi/B : uniquement les jeudis des semaines B", async () => {
  const seeded = await world();
  const input = await assembleWithPlans(seeded, [thursdayB(SOURCE_INJECTION)]);
  const sessions = sessionsOf(input, seeded.pendingCourseId);
  assert.ok(sessions.length > 0);
  assert.ok(sessions.every((session) => session.dayOfWeek === 4 && session.weekKind === "B"));
  assert.ok(sessions.every((session) => session.date !== "2027-08-23"));
});

test("3 — lundi/all + jeudi/B", async () => {
  const seeded = await world();
  const input = await assembleWithPlans(seeded, [mondayAllThursdayB(SOURCE_INJECTION)]);
  const sessions = sessionsOf(input, seeded.pendingCourseId);
  const mondays = sessions.filter((session) => session.dayOfWeek === 1);
  const thursdays = sessions.filter((session) => session.dayOfWeek === 4);
  assert.ok(mondays.length > 0);
  assert.ok(thursdays.length > 0);
  assert.ok(thursdays.every((session) => session.weekKind === "B"));
});

test("4-5 — deux cours d’une classe, jours distincts, aucun héritage croisé", async () => {
  const seeded = await world({
    extraCourses: [course(SOURCE_CHASSIS, CTX_CHASSIS)],
    extraSlots: [slot(SOURCE_CHASSIS, 4, "B")],
    extraItems: [
      item({ id: 10, title: "Injection" }),
      item({
        id: 11,
        title: "Châssis",
        annualCourseId: SOURCE_CHASSIS,
        subjectId: "subj-chassis",
        courseSessionKey: `${SOURCE_YEAR}|${SOURCE_CHASSIS}|2027-09-02`,
      }),
    ],
  });
  const input = await assembleWithPlans(seeded, [
    thursdayB(SOURCE_INJECTION),
    mondayAll(SOURCE_CHASSIS),
  ]);
  const injection = sessionsOf(input, pendingTargetCourseId(SOURCE_INJECTION));
  const chassis = sessionsOf(input, pendingTargetCourseId(SOURCE_CHASSIS));
  assert.ok(injection.every((session) => session.dayOfWeek === 4 && session.weekKind === "B"));
  assert.ok(chassis.every((session) => session.dayOfWeek === 1));
  assert.equal(
    injection.some((session) => chassis.some((other) => other.date === session.date && other.dayOfWeek === session.dayOfWeek)),
    false,
  );
});

test("6 + cas explicite — N lundi, N+1 jeudi B : aucune séance lundi issue du slot de N", async () => {
  const seeded = await world();
  const input = await assembleWithPlans(seeded, [thursdayB(SOURCE_INJECTION)]);
  const sessions = sessionsOf(input, seeded.pendingCourseId);
  assert.ok(sessions.length > 0);
  assert.equal(sessions.some((session) => session.dayOfWeek === 1), false);
  assert.equal(
    input.targetCourseSessions.some((session) => session.key.includes("pending-slot")),
    false,
  );
  const preview = buildYearTransitionPreview(input);
  assert.equal(preview.entries[0]?.reason, "PROJECTABLE");
  assert.equal(preview.entries[0]?.proposedPlacement?.day, 3);
  assert.equal(preview.entries[0]?.targetCourseSession?.dayOfWeek, 4);
  assert.equal(preview.entries[0]?.targetCourseSession?.weekKind, "B");
  assert.notEqual(preview.entries[0]?.proposedPlacement?.day, preview.entries[0]?.sourceTemporal.day);
});

test("7 — mêmes jours que N explicitement resaisis, sans cloner les slots", async () => {
  const seeded = await world();
  const input = await assembleWithPlans(seeded, [mondayAll(SOURCE_INJECTION)]);
  const sessions = sessionsOf(input, seeded.pendingCourseId);
  assert.ok(sessions.every((session) => session.dayOfWeek === 1 && session.segments.length === 0));
  assert.equal(sessions.some((session) => session.segments.some((segment) => segment.scheduleSlotId.startsWith("pending-slot:"))), false);
});

test("8 — vacances N+1 : semaine absente du calendrier, pas de séance", async () => {
  const without = await world();
  const full = sessionsOf(
    await assembleWithPlans(without, [mondayAll(SOURCE_INJECTION)]),
    without.pendingCourseId,
  );
  const withVacation = await world({ skipWeeks: ["2027-09-20"] });
  const vacated = sessionsOf(
    await assembleWithPlans(withVacation, [mondayAll(SOURCE_INJECTION)]),
    withVacation.pendingCourseId,
  );
  assert.ok(full.some((session) => session.date === "2027-09-20"));
  assert.equal(vacated.some((session) => session.date === "2027-09-20"), false);
});

test("9 — férié / exception N+1 : le jeudi B férié n’a pas de séance", async () => {
  const seeded = await world({
    exceptions: [{ date: "2027-09-02", state: "holiday", label: "Pont" }],
  });
  const sessions = sessionsOf(
    await assembleWithPlans(seeded, [thursdayB(SOURCE_INJECTION)]),
    seeded.pendingCourseId,
  );
  assert.equal(sessions.some((session) => session.date === "2027-09-02"), false);
  assert.ok(sessions.some((session) => session.date === "2027-09-16"));
});

test("10 — changement A → B", async () => {
  const seeded = await world();
  const weekA = sessionsOf(
    await assembleWithPlans(seeded, [plan(SOURCE_INJECTION, [{ dayOfWeek: 1, weekKind: "A", role: "PRIMARY" }])]),
    seeded.pendingCourseId,
  );
  const weekB = sessionsOf(
    await assembleWithPlans(seeded, [plan(SOURCE_INJECTION, [{ dayOfWeek: 1, weekKind: "B", role: "PRIMARY" }])]),
    seeded.pendingCourseId,
  );
  assert.ok(weekA.every((session) => session.weekKind === "A"));
  assert.ok(weekB.every((session) => session.weekKind === "B"));
  assert.deepEqual(
    weekA.map((session) => session.date).sort(),
    weekA.map((session) => session.date).sort(),
  );
  assert.notDeepEqual(
    weekA.map((session) => session.date).sort(),
    weekB.map((session) => session.date).sort(),
  );
});

test("11 — aucun MeetingDay pour un cours repris → PREVIEW refusé", async () => {
  const seeded = await world();
  await assert.rejects(
    () => assembleWithPlans(seeded, []),
    (error: unknown) => {
      assert.ok(error instanceof YearTransitionPreviewContractError);
      assert.equal(error.code, TARGET_MEETING_DAY_PLAN_REQUIRED);
      assert.equal(error.message, TARGET_MEETING_DAY_PLAN_REQUIRED_REASON);
      return true;
    },
  );
  await assert.rejects(
    () => assembleWithPlans(seeded, [plan(SOURCE_INJECTION, [])]),
    (error: unknown) => {
      assert.ok(error instanceof YearTransitionPreviewContractError);
      assert.equal(error.code, TARGET_MEETING_DAY_PLAN_REQUIRED);
      return true;
    },
  );
});

test("12-13 — aucun CourseScheduleSlot cible : PREVIEW fonctionne, segments []", async () => {
  const seeded = await world();
  const input = await assembleWithPlans(seeded, [thursdayB(SOURCE_INJECTION)]);
  assert.equal(
    input.targetCourseSessions.every((session) => session.segments.length === 0),
    true,
  );
  const preview = buildYearTransitionPreview(input);
  assert.equal(preview.entries[0]?.reason, "PROJECTABLE");
  assert.equal(preview.entries[0]?.targetCourseSession?.segments.length, 0);
});

test("14 — projection v4 conserve sequenceNumber source → cible", async () => {
  const seeded = await world();
  const input = await assembleWithPlans(seeded, [thursdayB(SOURCE_INJECTION)]);
  const sourceSecond = input.sourceCourseSessions?.find(
    (session) => session.annualCourseId === SOURCE_INJECTION && session.sequenceNumber === 2,
  );
  assert.ok(sourceSecond);
  input.sourceItems[0]!.courseSessionKey = sourceSecond!.key;
  input.sourceItems[0]!.courseSessionDate = sourceSecond!.date;
  const preview = buildYearTransitionPreview(input);
  assert.equal(preview.entries[0]?.reason, "PROJECTABLE");
  assert.equal(preview.entries[0]?.proposedPlacement?.sequenceNumber, 2);
  assert.equal(preview.entries[0]?.targetCourseSession?.sequenceNumber, 2);
  assert.equal(preview.entries[0]?.targetCourseSession?.dayOfWeek, 4);
});

test("15 — publications du cours, tous auteurs", async () => {
  const seeded = await world({
    extraItems: [
      item({ id: 10, title: "De A", authorTeacherId: TEACHER_A }),
      item({ id: 11, title: "De B", authorTeacherId: TEACHER_B }),
    ],
  });
  const input = await assembleWithPlans(seeded, [mondayAll(SOURCE_INJECTION)]);
  assert.deepEqual(
    input.sourceItems.map((entry) => entry.authorTeacherId).sort(),
    [TEACHER_A, TEACHER_B],
  );
  const preview = buildYearTransitionPreview(input);
  assert.equal(preview.entries.length, 2);
  assert.ok(preview.entries.every((entry) => entry.reason === "PROJECTABLE"));
});

test("16 — notes du cours, quel que soit l’ancien owner", async () => {
  const seeded = await world();
  seeded.deps.notes.replaceAllNotes([note("n-a", TEACHER_A), note("n-b", TEACHER_B)]);
  const input = await assembleLiveYearTransitionPreviewInput(
    {
      includePrivateNotes: true,
      privateNotesOwnerTeacherId: TEACHER_A,
      sourceSchoolYearId: SOURCE_YEAR,
      targetSchoolYearId: TARGET_YEAR,
      classMappings: seeded.mappings,
      selectedSourceClassIds: [SOURCE_CLASS],
      targetMeetingDayPlans: [mondayAll(SOURCE_INJECTION)],
    },
    seeded.deps,
  );
  assert.deepEqual(
    (input.sourceNotes ?? []).map((entry) => entry.ownerTeacherId).sort(),
    [TEACHER_A, TEACHER_B],
  );
  const preview = previewPrivateNotes(input);
  assert.equal(preview.length, 2);
  assert.ok(preview.every((entry) => entry.reason === "PROJECTABLE"));
  assert.ok(preview.every((entry) => entry.targetAnnualCourseId === seeded.pendingCourseId));
});

test("17-18 — fingerprint : plan changé ≠ ; même plan dans un autre ordre =", async () => {
  const seeded = await world();
  const monday = await assembleWithPlans(seeded, [mondayAll(SOURCE_INJECTION)]);
  const thursday = await assembleWithPlans(seeded, [thursdayB(SOURCE_INJECTION)]);
  assert.notEqual(yearTransitionPreviewFingerprint(monday), yearTransitionPreviewFingerprint(thursday));
  assert.notEqual(yearTransitionSourceMaterialFingerprint(monday), yearTransitionSourceMaterialFingerprint(thursday));

  const ordered = mondayAllThursdayB(SOURCE_INJECTION);
  const reversed = plan(SOURCE_INJECTION, [...ordered.days].reverse());
  const left = await assembleWithPlans(seeded, [ordered]);
  const right = await assembleWithPlans(seeded, [reversed]);
  assert.equal(yearTransitionPreviewFingerprint(left), yearTransitionPreviewFingerprint(right));
  assert.deepEqual(
    canonicalizeTargetMeetingDayPlans([reversed]),
    canonicalizeTargetMeetingDayPlans([ordered]),
  );
});

test("legacy sans plan — les slots de N peuvent encore être clonés", async () => {
  const seeded = await world();
  const input = await assembleLiveYearTransitionPreviewInput(
    {
      sourceSchoolYearId: SOURCE_YEAR,
      targetSchoolYearId: TARGET_YEAR,
      classMappings: seeded.mappings,
      selectedSourceClassIds: [SOURCE_CLASS],
    },
    seeded.deps,
  );
  const sessions = sessionsOf(input, seeded.pendingCourseId);
  assert.ok(sessions.some((session) => session.dayOfWeek === 1));
  assert.ok(sessions.some((session) => session.segments.some((segment) => segment.scheduleSlotId.startsWith("pending-slot:"))));
  assert.equal(input.targetMeetingDayPlans, undefined);
});

test("parseYearTransitionPreviewRequest accepte le contrat de plans", () => {
  const parsed = parseYearTransitionPreviewRequest(
    {
      sourceSchoolYearId: SOURCE_YEAR,
      targetSchoolYearId: TARGET_YEAR,
      classMappings: [{ sourceClassId: SOURCE_CLASS, targetClassId: pendingTargetClassId(SOURCE_CLASS) }],
      targetMeetingDayPlans: [thursdayB(SOURCE_INJECTION)],
    },
    TEACHER_A,
  );
  assert.equal(parsed.targetMeetingDayPlans?.length, 1);
  assert.equal(parsed.targetMeetingDayPlans?.[0]?.days[0]?.dayOfWeek, 4);
  assert.equal(parsed.targetMeetingDayPlans?.[0]?.days[0]?.weekKind, "B");
});

test("sources — clone N uniquement en legacy, fingerprint inclut le plan", async () => {
  const [assembleSrc, fingerprintSrc, applySrc] = await Promise.all([
    readFile(new URL("../src/features/year-transition/assemble.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/year-transition/fingerprint.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/year-transition/apply.ts", import.meta.url), "utf8"),
  ]);
  assert.match(assembleSrc, /cloneSourceSlots: explicitPlans === undefined/);
  assert.match(assembleSrc, /meetingDays: targetMeetingDays/);
  assert.match(assembleSrc, /pending-slot:/);
  assert.match(assembleSrc, /listNotesByAnnualCourse/);
  assert.doesNotMatch(assembleSrc, /listNotesByOwner/);
  assert.match(fingerprintSrc, /targetMeetingDayPlans/);
  assert.doesNotMatch(
    fingerprintSrc.slice(fingerprintSrc.indexOf("yearTransitionSourceMaterialFingerprint")),
    /delete material\.targetMeetingDayPlans/,
  );
  assert.match(applySrc, /targetMeetingDayPlans: snapshotOptions\.targetMeetingDayPlans/);
});

test("cours décoché : publications et notes hors PREVIEW, pas de BLOCKING", async () => {
  const seeded = await world({
    extraCourses: [course(SOURCE_CHASSIS, CTX_CHASSIS)],
    extraItems: [
      item({ id: 10, title: "CP1 pub" }),
      item({
        id: 21,
        title: "CP2 pub A",
        annualCourseId: SOURCE_CHASSIS,
        subjectId: "subj-chassis",
        courseSessionKey: `${SOURCE_YEAR}|${SOURCE_CHASSIS}|2027-08-23`,
      }),
      item({
        id: 22,
        title: "CP2 pub B",
        annualCourseId: SOURCE_CHASSIS,
        subjectId: "subj-chassis",
        courseSessionKey: `${SOURCE_YEAR}|${SOURCE_CHASSIS}|2027-08-30`,
      }),
    ],
  });
  seeded.deps.notes.replaceAllNotes([
    note("n-cp1", TEACHER_A),
    note("n-cp2-a", TEACHER_A, "2027-08-23", SOURCE_CHASSIS, CTX_CHASSIS),
    note("n-cp2-b", TEACHER_B, "2027-08-30", SOURCE_CHASSIS, CTX_CHASSIS),
  ]);
  const input = await assembleWithPlans(seeded, [mondayAll(SOURCE_INJECTION)], [SOURCE_INJECTION]);
  assert.equal(input.privateNotesOwnerTeacherId, undefined);
  assert.equal(input.includePrivateNotes, true);
  assert.deepEqual(input.sourceItems.map((entry) => entry.annualCourseId), [SOURCE_INJECTION]);
  assert.deepEqual((input.sourceNotes ?? []).map((entry) => entry.annualCourseId), [SOURCE_INJECTION]);
  assert.equal(
    input.targetCourses.some((entry) => entry.contextId === CTX_CHASSIS && entry.schoolYearId === TARGET_YEAR),
    false,
  );
  const preview = buildYearTransitionPreview(input);
  assert.equal(preview.entries.length, 1);
  assert.equal(preview.entries[0]?.sourceAnnualCourseId, SOURCE_INJECTION);
  assert.equal(preview.privateNotes?.length, 1);
  assert.equal(
    preview.entries.some((entry) => entry.reason === "TARGET_COURSE_MISSING" || entry.sourceAnnualCourseId === SOURCE_CHASSIS),
    false,
  );
  assert.equal(
    preview.privateNotes?.some((entry) => entry.reason === "TARGET_COURSE_UNRESOLVED"),
    false,
  );
  assert.equal(previewHasBlockingEntries(preview), false);
});

test("classe sélectionnée, tous les cours décochés : zéro contenu, PREVIEW non bloqué", async () => {
  const seeded = await world();
  seeded.deps.notes.replaceAllNotes([note("n-a", TEACHER_A)]);
  const input = await assembleWithPlans(seeded, [], []);
  assert.equal(input.sourceItems.length, 0);
  assert.equal((input.sourceNotes ?? []).length, 0);
  const preview = buildYearTransitionPreview(input);
  assert.equal(preview.entries.length, 0);
  assert.equal(preview.privateNotes?.length ?? 0, 0);
  assert.equal(previewHasBlockingEntries(preview), false);
});

test("MeetingDays PREVIEW sans sessionTeacherId charge toutes les notes du cours", async () => {
  const seeded = await world();
  seeded.deps.notes.replaceAllNotes([note("n-a", TEACHER_A), note("n-b", TEACHER_B)]);
  const parsed = parseYearTransitionPreviewRequest({
    sourceSchoolYearId: SOURCE_YEAR,
    targetSchoolYearId: TARGET_YEAR,
    selectedSourceClassIds: [SOURCE_CLASS],
    selectedSourceAnnualCourseIds: [SOURCE_INJECTION],
    targetMeetingDayPlans: [mondayAll(SOURCE_INJECTION)],
  }, "");
  assert.equal(parsed.includePrivateNotes, true);
  assert.equal(parsed.privateNotesOwnerTeacherId, undefined);
  const input = await assembleLiveYearTransitionPreviewInput(
    {
      ...parsed,
      classMappings: seeded.mappings,
    },
    seeded.deps,
  );
  assert.equal(input.privateNotesOwnerTeacherId, undefined);
  assert.deepEqual(
    (input.sourceNotes ?? []).map((entry) => entry.ownerTeacherId).sort(),
    [TEACHER_A, TEACHER_B],
  );
  const preview = previewPrivateNotes(input);
  assert.equal(preview.length, 2);
});
