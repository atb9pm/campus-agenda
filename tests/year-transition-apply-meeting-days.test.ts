import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { PrototypeAgendaItem } from "../src/features/agenda/demo-items.ts";
import type { AnnualCourseMeetingDayInput } from "../src/features/annual-courses/meeting-days.ts";
import type { AnnualCourse, TeacherCourseAssignment } from "../src/features/annual-courses/types.ts";
import { computeCourseSessions } from "../src/features/course-sessions/compute.ts";
import type { CourseScheduleSlot } from "../src/features/course-schedule/types.ts";
import type { AnnualCourseNote } from "../src/features/pedagogical-path/annual-notes.ts";
import { valaisHolidaysForSchoolYear } from "../src/features/school-days/holidays-valais.ts";
import type { SchoolWeekEntry } from "../src/features/school-year/types.ts";
import {
  applyAuthorizedYearTransition,
  applyPersistedYearTransition,
  assembleLiveYearTransitionPreviewInput,
  createAuthorizedYearTransitionPreview,
  createPersistedYearTransitionPreview,
  loadYearTransitionPrepareState,
  pendingTargetClassId,
  pendingTargetCourseId,
  yearTransitionPreviewFingerprint,
  YEAR_TRANSITION_REIMPORT_APPLY_PENDING,
  YEAR_TRANSITION_REIMPORT_NOT_IMPORTED,
  YEAR_TRANSITION_REIMPORT_REQUIRES_PLAN,
  type ApplyPersistedYearTransitionDeps,
  type YearTransitionPrepareDeps,
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
import { MemoryRuntimeAgendaAdapterStore } from "../src/lib/persistence/memory-runtime-adapter-store.ts";
import { MemorySchoolCatalogStore } from "../src/lib/persistence/memory-school-catalog-store.ts";
import {
  MemorySchoolYearStore,
  replaceMemorySchoolYears,
  resetMemorySchoolYearStore,
} from "../src/lib/persistence/memory-school-year-store.ts";
import { MemoryYearTransitionApplyStore } from "../src/lib/persistence/memory-year-transition-apply-store.ts";
import { MemoryYearTransitionPreviewStore } from "../src/lib/persistence/memory-year-transition-preview-store.ts";
import {
  replaceMemoryLegacySchool,
  resetMemoryLegacySchool,
} from "../src/lib/persistence/memory-legacy-school.ts";

const SOURCE_YEAR = "year-n";
const TARGET_YEAR = "year-n1";
const SOURCE_CLASS = "class-ma1a-n";
const SOURCE_INJECTION = "ac-injection-n";
const SOURCE_CHASSIS = "ac-chassis-n";
const SOURCE_ELECTRO = "ac-electro-n";
const CTX_INJECTION = "ctx-injection";
const CTX_CHASSIS = "ctx-chassis";
const CTX_ELECTRO = "ctx-electro";
const TEACHER_A = "teacher-a";
const TEACHER_B = "teacher-b";
const PROFESSION = "prf-meca";
const BRANCH = "br-injection";

function mondayWeeks(startMonday: string, count: number): SchoolWeekEntry[] {
  const weeks: SchoolWeekEntry[] = [];
  const [year, month, day] = startMonday.split("-").map(Number);
  const cursor = new Date(year!, month! - 1, day!, 12);
  let number = 1;
  while (weeks.length < count) {
    const iso = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
    weeks.push({
      number,
      kind: number % 2 === 1 ? "A" : "B",
      monday: iso,
    });
    number += 1;
    cursor.setDate(cursor.getDate() + 7);
  }
  return weeks;
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

function plan(
  sourceAnnualCourseId: string,
  days: AnnualCourseMeetingDayInput[],
): YearTransitionTargetMeetingDayPlan {
  return { sourceAnnualCourseId, days };
}

function thursdayB(sourceAnnualCourseId: string): YearTransitionTargetMeetingDayPlan {
  return plan(sourceAnnualCourseId, [{ dayOfWeek: 4, weekKind: "B", role: "PRIMARY" }]);
}

function mondayAll(sourceAnnualCourseId: string): YearTransitionTargetMeetingDayPlan {
  return plan(sourceAnnualCourseId, [{ dayOfWeek: 1, weekKind: "all", role: "PRIMARY" }]);
}

function item(
  patch: Partial<PrototypeAgendaItem> & Pick<PrototypeAgendaItem, "id" | "title">,
): PrototypeAgendaItem {
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
    courseSessionKey: `${SOURCE_YEAR}|${annualCourseId}|2027-08-23`,
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
  extraItems?: PrototypeAgendaItem[];
  extraNotes?: AnnualCourseNote[];
  extraSlots?: CourseScheduleSlot[];
  /** Classes de N listées avant SOURCE_CLASS dans le catalogue. */
  leadingClasses?: { id: string; code: string; trainingYear: number }[];
} = {}) {
  resetMemorySchoolYearStore();
  resetMemoryLegacySchool();
  replaceMemoryLegacySchool({ classrooms: [], subjects: [], memberships: [], studentAccesses: [] });
  const weeks = mondayWeeks("2027-08-23", 6);
  replaceMemorySchoolYears([
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
  ]);

  const catalog = new MemorySchoolCatalogStore();
  catalog.replaceSnapshot({
    professions: [
      {
        id: PROFESSION,
        adminCode: "PRF-0001",
        label: "Mécanicien",
        classCodePrefix: "MA",
        durationYears: 4,
        sortOrder: 1,
        isActive: true,
        isArchived: false,
        archivedAt: null,
      },
    ],
    branches: [
      {
        id: BRANCH,
        code: "INJ",
        label: "Injection",
        sortOrder: 1,
        isActive: true,
        adminCode: "BR-0001",
        isArchived: false,
        archivedAt: null,
        teachingType: "TECHNICAL",
      },
    ],
    contexts: [
      {
        id: CTX_INJECTION,
        adminCode: "CTX-0001",
        professionId: PROFESSION,
        trainingYear: 1,
        branchId: BRANCH,
        isActive: true,
        isArchived: false,
        archivedAt: null,
      },
      {
        id: CTX_CHASSIS,
        adminCode: "CTX-0002",
        professionId: PROFESSION,
        trainingYear: 1,
        branchId: BRANCH,
        isActive: true,
        isArchived: false,
        archivedAt: null,
      },
      {
        id: CTX_ELECTRO,
        adminCode: "CTX-0003",
        professionId: PROFESSION,
        trainingYear: 1,
        branchId: BRANCH,
        isActive: true,
        isArchived: false,
        archivedAt: null,
      },
    ],
    classes: [
      ...(options.leadingClasses ?? []).map((entry, index) => ({
        id: entry.id,
        code: entry.code,
        label: entry.code,
        sortOrder: 10 + index,
        isActive: true,
        schoolYearId: SOURCE_YEAR,
        schoolYearLabel: "2026-2027",
        professionId: PROFESSION,
        trainingYear: entry.trainingYear,
        parallelCode: "A",
        isArchived: false,
        archivedAt: null,
      })),
      {
        id: SOURCE_CLASS,
        code: "MA1A",
        label: "MA 1A",
        sortOrder: 1,
        isActive: true,
        schoolYearId: SOURCE_YEAR,
        schoolYearLabel: "2026-2027",
        professionId: PROFESSION,
        trainingYear: 1,
        parallelCode: "A",
        isArchived: false,
        archivedAt: null,
      },
    ],
  });

  const courses = new MemoryAnnualCourseStore();
  await courses.createCourse(course(SOURCE_INJECTION, CTX_INJECTION));
  for (const extra of options.extraCourses ?? []) await courses.createCourse(extra);
  await courses.createAssignment({
    id: "asg-source-a",
    annualCourseId: SOURCE_INJECTION,
    teacherId: TEACHER_A,
    role: "PRIMARY",
    validFrom: "2026-08-01T00:00:00.000Z",
    validTo: null,
    createdByAdminId: "admin-1",
    createdAt: "2026-08-01T00:00:00.000Z",
    endedAt: null,
    overrideReason: null,
    overrideByAdminId: null,
  } satisfies TeacherCourseAssignment);

  const schedules = new MemoryCourseScheduleStore();
  await schedules.createSlot({
    id: "slot-injection-n",
    annualCourseId: SOURCE_INJECTION,
    dayOfWeek: 1,
    periodStart: 1,
    periodEnd: 4,
    weekKind: "all",
    validFrom: null,
    validTo: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  });
  for (const extra of options.extraSlots ?? []) await schedules.createSlot(extra);
  await schedules.replaceAttendanceDaysForClass(SOURCE_CLASS, [
    {
      id: "att-source-mon",
      classId: SOURCE_CLASS,
      dayOfWeek: 1,
      weekKind: "all",
      role: "PRIMARY",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    },
  ]);

  const notes = new MemoryAnnualCourseNotesStore();
  notes.replaceAllNotes(options.extraNotes ?? [note("n-a", TEACHER_A), note("n-b", TEACHER_B)]);

  const agenda = new MemoryAgendaStore(
    options.extraItems ?? [
      item({ id: 10, title: "Devoir injection" }),
      item({ id: 11, title: "Contrôle injection", type: "TEST" }),
      item({ id: 12, title: "Info injection", type: "INFORMATION" }),
    ],
  );
  const years = new MemorySchoolYearStore();
  const previews = new MemoryYearTransitionPreviewStore();
  const applyStore = new MemoryYearTransitionApplyStore(agenda, notes);
  const deps: ApplyPersistedYearTransitionDeps = {
    notes,
    previews,
    applyStore,
    years,
    catalog,
    courses,
    agenda,
    paths: new MemoryPedagogicalPathStore(),
    schedules,
    adapters: new MemoryRuntimeAgendaAdapterStore(),
    now: () => "2027-03-01T00:00:00.000Z",
  };

  return {
    deps,
    catalog,
    courses,
    schedules,
    notes,
    agenda,
    previews,
    years,
    mappings: [{ sourceClassId: SOURCE_CLASS, targetClassId: pendingTargetClassId(SOURCE_CLASS) }],
  };
}

async function persistPreview(
  seeded: Awaited<ReturnType<typeof world>>,
  plans?: YearTransitionTargetMeetingDayPlan[],
  id = "transition-apply-md",
  selectedSourceAnnualCourseIds?: readonly string[],
) {
  const input = await assembleLiveYearTransitionPreviewInput(
    {
      includePrivateNotes: true,
      privateNotesOwnerTeacherId: TEACHER_A,
      sourceSchoolYearId: SOURCE_YEAR,
      targetSchoolYearId: TARGET_YEAR,
      classMappings: seeded.mappings,
      selectedSourceClassIds: [SOURCE_CLASS],
      ...(plans ? { targetMeetingDayPlans: plans } : {}),
      ...(selectedSourceAnnualCourseIds !== undefined
        ? { selectedSourceAnnualCourseIds: [...selectedSourceAnnualCourseIds] }
        : {}),
    },
    seeded.deps,
  );
  return {
    input,
    persisted: await createPersistedYearTransitionPreview(input, {
      store: seeded.previews,
      idGenerator: () => id,
      now: () => "2027-02-01T00:00:00.000Z",
    }),
  };
}

async function targetCourseOf(
  seeded: Awaited<ReturnType<typeof world>>,
  contextId = CTX_INJECTION,
) {
  const courses = await seeded.courses.listCourses();
  const found = courses.find(
    (entry) => entry.schoolYearId === TARGET_YEAR && entry.contextId === contextId && !entry.isArchived,
  );
  assert.ok(found);
  return found;
}

test("cas explicite — N lundi P1-P4 Prof A → N+1 jeudi B, zéro horaire/enseignant/attendance", async () => {
  const seeded = await world();
  const { input, persisted } = await persistPreview(seeded, [thursdayB(SOURCE_INJECTION)]);
  const previewSessions = input.targetCourseSessions.filter(
    (session) => session.annualCourseId === pendingTargetCourseId(SOURCE_INJECTION),
  );
  assert.ok(previewSessions.every((session) => session.dayOfWeek === 4 && session.weekKind === "B"));
  assert.ok(previewSessions.length > 0);

  const result = await applyPersistedYearTransition(persisted.id, seeded.deps);
  assert.equal(result.ok, true, JSON.stringify(result));

  const classes = await seeded.catalog.listClasses();
  const targetClass = classes.find((entry) => entry.schoolYearId === TARGET_YEAR);
  assert.ok(targetClass, "1 — classe cible créée");
  const targetCourse = await targetCourseOf(seeded);
  assert.equal(targetCourse.contextId, CTX_INJECTION, "2 — même contextId");
  assert.notEqual(targetCourse.id, SOURCE_INJECTION);

  const days = await seeded.schedules.listMeetingDaysByAnnualCourse(targetCourse.id);
  assert.equal(days.length, 1, "3 — MeetingDay PRIMARY persisté");
  assert.equal(days[0]?.dayOfWeek, 4);
  assert.equal(days[0]?.weekKind, "B");
  assert.equal(days[0]?.role, "PRIMARY");
  assert.equal(days[0]?.annualCourseId, targetCourse.id);

  assert.equal((await seeded.schedules.listSlotsByAnnualCourse(targetCourse.id)).length, 0, "6 — zéro slot");
  assert.equal((await seeded.courses.listAssignments(targetCourse.id)).length, 0, "7 — zéro enseignant");
  assert.equal((await seeded.schedules.listAttendanceDaysByClass(targetClass.id)).length, 0, "8 — zéro attendance");

  const copied = (await seeded.agenda.exportAllItems()).filter((entry) => entry.schoolYearId === TARGET_YEAR);
  assert.equal(copied.length, 3);
  assert.ok(copied.some((entry) => entry.type === "HOMEWORK"));
  assert.ok(copied.some((entry) => entry.type === "TEST" && entry.studentVisible === false));
  assert.ok(copied.some((entry) => entry.type === "INFORMATION"));
  assert.ok(copied.every((entry) => entry.studentVisible === false));
  assert.ok(copied.every((entry) => entry.courseSessionDate && !entry.courseSessionDate.startsWith("2027-08-23")));
  assert.ok(copied.every((entry) => entry.annualCourseId === targetCourse.id));

  const copiedNotes = await seeded.notes.listNotesByAnnualCourse(targetCourse.id);
  assert.equal(copiedNotes.length, 2, "9 — toutes les notes du cours");
  assert.deepEqual(copiedNotes.map((entry) => entry.ownerTeacherId).sort(), [TEACHER_A, TEACHER_B]);
  assert.ok(copiedNotes.every((entry) => entry.sourceNoteId));
  assert.ok(copiedNotes.every((entry) => entry.inheritedAt));

  const year = await seeded.years.getSchoolYearById(TARGET_YEAR);
  assert.ok(year);
  const recomputed = computeCourseSessions({
    schoolYearId: TARGET_YEAR,
    courses: [{ id: targetCourse.id, classId: targetCourse.classId, contextId: targetCourse.contextId }],
    slots: [],
    weeks: year.weeks,
    holidays: valaisHolidaysForSchoolYear(year.label),
    meetingDays: days.map((day) => ({
      annualCourseId: day.annualCourseId,
      dayOfWeek: day.dayOfWeek,
      weekKind: day.weekKind,
    })),
  });
  assert.deepEqual(
    recomputed.map((session) => `${session.date}|${session.sequenceNumber}|${session.dayOfWeek}|${session.weekKind}`),
    previewSessions.map((session) => `${session.date}|${session.sequenceNumber}|${session.dayOfWeek}|${session.weekKind}`),
  );
  assert.deepEqual(
    recomputed.map((session) => session.key),
    previewSessions.map((session) => session.key.replace(pendingTargetCourseId(SOURCE_INJECTION), targetCourse.id)),
  );
  assert.ok(recomputed.every((session) => session.segments.length === 0));
});

test("PRIMARY + ADDITIONAL persistés indépendamment de N", async () => {
  const seeded = await world();
  const mixed = plan(SOURCE_INJECTION, [
    { dayOfWeek: 2, weekKind: "all", role: "PRIMARY" },
    { dayOfWeek: 5, weekKind: "A", role: "ADDITIONAL" },
  ]);
  const result = await applyPersistedYearTransition(
    (await persistPreview(seeded, [mixed])).persisted.id,
    seeded.deps,
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  const targetCourse = await targetCourseOf(seeded);
  const days = [...(await seeded.schedules.listMeetingDaysByAnnualCourse(targetCourse.id))].sort(
    (left, right) => left.dayOfWeek - right.dayOfWeek,
  );
  assert.equal(days.length, 2);
  assert.equal(days[0]?.dayOfWeek, 2);
  assert.equal(days[0]?.weekKind, "all");
  assert.equal(days[0]?.role, "PRIMARY");
  assert.equal(days[1]?.dayOfWeek, 5);
  assert.equal(days[1]?.weekKind, "A");
  assert.equal(days[1]?.role, "ADDITIONAL");
});

test("deux cours de la même classe : plans persistés indépendamment", async () => {
  const seeded = await world({
    extraCourses: [course(SOURCE_CHASSIS, CTX_CHASSIS)],
    extraItems: [
      item({ id: 10, title: "Injection" }),
      item({
        id: 20,
        title: "Châssis",
        annualCourseId: SOURCE_CHASSIS,
        courseSessionKey: `${SOURCE_YEAR}|${SOURCE_CHASSIS}|2027-08-23`,
      }),
    ],
  });
  const result = await applyPersistedYearTransition(
    (
      await persistPreview(seeded, [thursdayB(SOURCE_INJECTION), mondayAll(SOURCE_CHASSIS)])
    ).persisted.id,
    seeded.deps,
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  const injection = await targetCourseOf(seeded, CTX_INJECTION);
  const chassis = await targetCourseOf(seeded, CTX_CHASSIS);
  const injectionDays = await seeded.schedules.listMeetingDaysByAnnualCourse(injection.id);
  const chassisDays = await seeded.schedules.listMeetingDaysByAnnualCourse(chassis.id);
  assert.deepEqual(
    injectionDays.map((day) => `${day.dayOfWeek}|${day.weekKind}|${day.role}`),
    ["4|B|PRIMARY"],
  );
  assert.deepEqual(
    chassisDays.map((day) => `${day.dayOfWeek}|${day.weekKind}|${day.role}`),
    ["1|all|PRIMARY"],
  );
});

test("plan MeetingDays modifié après PREVIEW → APPLY refusé", async () => {
  const seeded = await world();
  const { persisted } = await persistPreview(seeded, [mondayAll(SOURCE_INJECTION)]);
  const loaded = await seeded.previews.getById(persisted.id);
  assert.ok(loaded);
  const snapshot = JSON.parse(loaded.snapshotJson) as {
    targetMeetingDayPlans: YearTransitionTargetMeetingDayPlan[];
  };
  snapshot.targetMeetingDayPlans[0]!.days[0]!.dayOfWeek = 2;
  await seeded.previews.create(
    { ...loaded, id: "tampered-plan", snapshotJson: JSON.stringify(snapshot) },
    [],
  );
  const result = await applyPersistedYearTransition("tampered-plan", seeded.deps);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "PREVIEW_CORRUPTED");
  assert.equal((await seeded.courses.listCourses()).filter((entry) => entry.schoolYearId === TARGET_YEAR).length, 0);
});

test("fingerprints lundi vs mardi distincts, APPLY du PREVIEW lundi conserve le lundi", async () => {
  const seeded = await world();
  const monday = await persistPreview(seeded, [mondayAll(SOURCE_INJECTION)], "preview-monday");
  const tuesdayInput = await assembleLiveYearTransitionPreviewInput(
    {
      includePrivateNotes: true,
      privateNotesOwnerTeacherId: TEACHER_A,
      sourceSchoolYearId: SOURCE_YEAR,
      targetSchoolYearId: TARGET_YEAR,
      classMappings: seeded.mappings,
      selectedSourceClassIds: [SOURCE_CLASS],
      targetMeetingDayPlans: [plan(SOURCE_INJECTION, [{ dayOfWeek: 2, weekKind: "all", role: "PRIMARY" }])],
    },
    seeded.deps,
  );
  assert.notEqual(yearTransitionPreviewFingerprint(monday.input), yearTransitionPreviewFingerprint(tuesdayInput));
  assert.notEqual(
    yearTransitionSourceMaterialFingerprint(monday.input),
    yearTransitionSourceMaterialFingerprint(tuesdayInput),
  );
  const result = await applyPersistedYearTransition(monday.persisted.id, seeded.deps);
  assert.equal(result.ok, true, JSON.stringify(result));
  const days = await seeded.schedules.listMeetingDaysByAnnualCourse((await targetCourseOf(seeded)).id);
  assert.equal(days[0]?.dayOfWeek, 1);
});

test("APPLY répété : idempotence, pas de second slot ni second enseignant", async () => {
  const seeded = await world();
  const { persisted } = await persistPreview(seeded, [thursdayB(SOURCE_INJECTION)]);
  const first = await applyPersistedYearTransition(persisted.id, seeded.deps);
  const retry = await applyPersistedYearTransition(persisted.id, seeded.deps);
  assert.equal(first.ok, true);
  assert.ok(retry.ok && retry.code === "ALREADY_APPLIED", JSON.stringify(retry));
  const targetCourse = await targetCourseOf(seeded);
  assert.equal((await seeded.courses.listCourses()).filter((entry) => entry.schoolYearId === TARGET_YEAR).length, 1);
  assert.equal((await seeded.schedules.listSlotsByAnnualCourse(targetCourse.id)).length, 0);
  assert.equal((await seeded.courses.listAssignments(targetCourse.id)).length, 0);
  assert.equal((await seeded.notes.listNotesByAnnualCourse(targetCourse.id)).length, 2);
  assert.equal((await seeded.agenda.exportAllItems()).filter((entry) => entry.schoolYearId === TARGET_YEAR).length, 3);
});

test("legacy sans targetMeetingDayPlans : copie encore slots / enseignants / attendance", async () => {
  const seeded = await world();
  const { persisted } = await persistPreview(seeded, undefined, "legacy-apply");
  const result = await applyPersistedYearTransition(persisted.id, seeded.deps);
  assert.equal(result.ok, true, JSON.stringify(result));
  const targetCourse = await targetCourseOf(seeded);
  const targetClass = (await seeded.catalog.listClasses()).find((entry) => entry.schoolYearId === TARGET_YEAR);
  assert.ok(targetClass);
  assert.ok((await seeded.schedules.listSlotsByAnnualCourse(targetCourse.id)).length > 0);
  assert.ok((await seeded.courses.listAssignments(targetCourse.id)).length > 0);
  assert.ok((await seeded.schedules.listAttendanceDaysByClass(targetClass.id)).length > 0);
  assert.equal((await seeded.schedules.listMeetingDaysByAnnualCourse(targetCourse.id)).length, 0);
});

function countTarget(seeded: Awaited<ReturnType<typeof world>>, contextId: string) {
  return seeded.courses.listCourses().then((courses) =>
    courses.filter((entry) => entry.schoolYearId === TARGET_YEAR && entry.contextId === contextId && !entry.isArchived),
  );
}

test("cours décoché : APPLY ne crée ni ne copie CP2", async () => {
  const seeded = await world({
    extraCourses: [course(SOURCE_CHASSIS, CTX_CHASSIS)],
    extraItems: [
      item({ id: 10, title: "CP1" }),
      item({
        id: 21,
        title: "CP2 A",
        annualCourseId: SOURCE_CHASSIS,
        courseSessionKey: `${SOURCE_YEAR}|${SOURCE_CHASSIS}|2027-08-23`,
      }),
      item({
        id: 22,
        title: "CP2 B",
        annualCourseId: SOURCE_CHASSIS,
        courseSessionKey: `${SOURCE_YEAR}|${SOURCE_CHASSIS}|2027-08-30`,
      }),
    ],
    extraNotes: [
      note("n-cp1", TEACHER_A),
      note("n-cp2-a", TEACHER_A, SOURCE_CHASSIS, CTX_CHASSIS),
      note("n-cp2-b", TEACHER_B, SOURCE_CHASSIS, CTX_CHASSIS),
    ],
  });
  const { input, persisted } = await persistPreview(
    seeded,
    [mondayAll(SOURCE_INJECTION)],
    "omit-cp2",
    [SOURCE_INJECTION],
  );
  assert.equal(input.sourceItems.length, 1);
  assert.equal((input.sourceNotes ?? []).length, 1);
  const result = await applyPersistedYearTransition(persisted.id, seeded.deps);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal((await countTarget(seeded, CTX_INJECTION)).length, 1);
  assert.equal((await countTarget(seeded, CTX_CHASSIS)).length, 0);
  const targetCourse = await targetCourseOf(seeded, CTX_INJECTION);
  assert.equal((await seeded.agenda.exportAllItems()).filter((entry) => entry.schoolYearId === TARGET_YEAR).length, 1);
  assert.equal((await seeded.notes.listNotesByAnnualCourse(targetCourse.id)).length, 1);
  assert.equal((await seeded.schedules.listMeetingDaysByAnnualCourse(targetCourse.id)).length, 1);
});

test("MeetingDays : admin sans enseignant, second admin peut APPLY", async () => {
  const seeded = await world();
  const deps = seeded.deps as YearTransitionPrepareDeps;
  const created = await createAuthorizedYearTransitionPreview(
    {
      sourceSchoolYearId: SOURCE_YEAR,
      targetSchoolYearId: TARGET_YEAR,
      selectedSourceClassIds: [SOURCE_CLASS],
      selectedSourceAnnualCourseIds: [SOURCE_INJECTION],
      targetMeetingDayPlans: [thursdayB(SOURCE_INJECTION)],
    },
    "",
    deps,
  );
  assert.equal(created.blocking, false, JSON.stringify(created.preview.mappingIssues));
  assert.equal(created.preview.includePrivateNotes, true);
  const first = await applyAuthorizedYearTransition(
    { transitionId: created.transitionId, confirm: true },
    "admin-b",
    deps,
  );
  assert.equal(first.ok, true, JSON.stringify(first));
});

test("APPLY : plusieurs classes en N, ordre du catalogue différent de l’aperçu", async () => {
  const seeded = await world({
    leadingClasses: [
      { id: "class-zz-ma3a-n", code: "MA3A", trainingYear: 3 },
      { id: "class-mm-ma2a-n", code: "MA2A", trainingYear: 2 },
    ],
  });
  const deps = seeded.deps as YearTransitionPrepareDeps;
  const catalogOrder = (await deps.catalog!.listClasses()).map((entry) => entry.id);
  assert.notDeepEqual(catalogOrder, [...catalogOrder].sort((left, right) => left.localeCompare(right)));
  const created = await createAuthorizedYearTransitionPreview(
    {
      sourceSchoolYearId: SOURCE_YEAR,
      targetSchoolYearId: TARGET_YEAR,
      selectedSourceClassIds: [SOURCE_CLASS],
      selectedSourceAnnualCourseIds: [SOURCE_INJECTION],
      targetMeetingDayPlans: [thursdayB(SOURCE_INJECTION)],
    },
    "",
    deps,
  );
  assert.equal(created.blocking, false, JSON.stringify(created.preview.mappingIssues));
  const applied = await applyAuthorizedYearTransition(
    { transitionId: created.transitionId, confirm: true },
    "admin-b",
    deps,
  );
  assert.equal(applied.ok, true, JSON.stringify(applied));
  const targetCourse = await targetCourseOf(seeded, CTX_INJECTION);
  const copied = (await seeded.agenda.exportAllItems()).filter((entry) => entry.schoolYearId === TARGET_YEAR);
  assert.ok(copied.length > 0);
  assert.ok(copied.every((entry) => entry.annualCourseId === targetCourse.id));
  assert.equal(
    (await seeded.notes.listNotesByAnnualCourse(targetCourse.id)).filter((entry) => entry.schoolYearId === TARGET_YEAR).length,
    2,
  );
});

test("MECAUTO3A : CP2 décoché absent du PREVIEW/APPLY, admin sans enseignant", async () => {
  const pubs = (courseId: string, count: number, startId: number) =>
    Array.from({ length: count }, (_, index) =>
      item({
        id: startId + index,
        title: `${courseId}-${index}`,
        annualCourseId: courseId,
        courseSessionKey: `${SOURCE_YEAR}|${courseId}|2027-08-${String(23 + (index % 4)).padStart(2, "0")}`,
      }),
    );
  const notesFor = (courseId: string, contextId: string, count: number, prefix: string) =>
    Array.from({ length: count }, (_, index) =>
      note(`${prefix}-${index}`, index % 2 === 0 ? TEACHER_A : TEACHER_B, courseId, contextId),
    );
  const seeded = await world({
    extraCourses: [
      course(SOURCE_CHASSIS, CTX_CHASSIS),
      course(SOURCE_ELECTRO, CTX_ELECTRO),
    ],
    extraItems: [
      ...pubs(SOURCE_ELECTRO, 10, 100),
      ...pubs(SOURCE_CHASSIS, 5, 200),
      ...pubs(SOURCE_INJECTION, 8, 300),
    ],
    extraNotes: [
      ...notesFor(SOURCE_ELECTRO, CTX_ELECTRO, 3, "n-cp1"),
      ...notesFor(SOURCE_CHASSIS, CTX_CHASSIS, 4, "n-cp2"),
      ...notesFor(SOURCE_INJECTION, CTX_INJECTION, 2, "n-cp3"),
    ],
  });
  const deps = seeded.deps as YearTransitionPrepareDeps;
  const created = await createAuthorizedYearTransitionPreview(
    {
      sourceSchoolYearId: SOURCE_YEAR,
      targetSchoolYearId: TARGET_YEAR,
      selectedSourceClassIds: [SOURCE_CLASS],
      selectedSourceAnnualCourseIds: [SOURCE_ELECTRO, SOURCE_INJECTION],
      targetMeetingDayPlans: [mondayAll(SOURCE_ELECTRO), thursdayB(SOURCE_INJECTION)],
    },
    "",
    deps,
  );
  assert.equal(created.blocking, false, JSON.stringify(created.preview.mappingIssues));
  assert.equal(created.preview.publications.projectable.length
    + created.preview.publications.toReclassify.length
    + created.preview.publications.alreadyPresent.length
    + created.preview.publications.excluded.length
    + created.preview.publications.blocking.length, 18);
  assert.equal(
    (created.preview.notes?.projectable.length ?? 0)
      + (created.preview.notes?.toReclassify.length ?? 0)
      + (created.preview.notes?.alreadyPresent.length ?? 0)
      + (created.preview.notes?.excluded.length ?? 0)
      + (created.preview.notes?.blocking.length ?? 0),
    5,
  );
  assert.equal(created.preview.publications.blocking.length, 0);
  assert.doesNotMatch(JSON.stringify(created.preview), /ac-chassis-n/);
  const applied = await applyAuthorizedYearTransition(
    { transitionId: created.transitionId, confirm: true },
    "admin-c",
    deps,
  );
  assert.equal(applied.ok, true, JSON.stringify(applied));
  assert.equal((await countTarget(seeded, CTX_ELECTRO)).length, 1);
  assert.equal((await countTarget(seeded, CTX_INJECTION)).length, 1);
  assert.equal((await countTarget(seeded, CTX_CHASSIS)).length, 0);
  const copied = (await seeded.agenda.exportAllItems()).filter((entry) => entry.schoolYearId === TARGET_YEAR);
  assert.equal(copied.length, 18);
  const allowed = new Set(
    [...(await countTarget(seeded, CTX_ELECTRO)), ...(await countTarget(seeded, CTX_INJECTION))].map((entry) => entry.id),
  );
  assert.ok(copied.every((entry) => entry.annualCourseId && allowed.has(entry.annualCourseId)));
  assert.equal(
    (await seeded.notes.listNotesByAnnualCourse(SOURCE_CHASSIS)).filter((entry) => entry.schoolYearId === TARGET_YEAR).length,
    0,
  );
});

test("sources — nouveau flux n’appelle pas les copies N", async () => {
  const src = await readFile(new URL("../src/features/year-transition/materialize-continuations.ts", import.meta.url), "utf8");
  assert.match(src, /usesExplicitTargetMeetingDayPlans\(options\.targetMeetingDayPlans\)/);
  assert.match(src, /persistTargetMeetingDayPlans/);
  assert.match(src, /if \(newFlow\) continue;/);
  const applySrc = await readFile(new URL("../src/features/year-transition/apply.ts", import.meta.url), "utf8");
  assert.match(applySrc, /legacyOwnedNotesForApply/);
  assert.match(applySrc, /notesInputForApply/);
  assert.doesNotMatch(applySrc, /notesOwnedBySessionTeacher/);
});

test("état d’import : seuls les cours appliqués sont « Déjà importé », plan lu sur le cours N+1", async () => {
  const seeded = await world({
    extraCourses: [course(SOURCE_CHASSIS, CTX_CHASSIS)],
    extraItems: [item({ id: 10, title: "CP1" })],
    extraNotes: [note("n-cp1", TEACHER_A)],
  });
  const deps = seeded.deps as YearTransitionPrepareDeps;
  const { persisted } = await persistPreview(seeded, [mondayAll(SOURCE_INJECTION)], "import-inj", [SOURCE_INJECTION]);

  const beforeApply = await loadYearTransitionPrepareState(deps, "admin-1");
  assert.deepEqual(beforeApply.courseImports, [], "un aperçu non appliqué n’importe rien");

  assert.equal((await applyPersistedYearTransition(persisted.id, seeded.deps)).ok, true);
  const targetInjection = await targetCourseOf(seeded, CTX_INJECTION);
  const afterFirst = await loadYearTransitionPrepareState(deps, "admin-1");
  assert.deepEqual(
    afterFirst.courseImports.map((state) => state.sourceAnnualCourseId),
    [SOURCE_INJECTION],
    "CP2 décoché reste « Non importé »",
  );
  const [injection] = afterFirst.courseImports;
  assert.equal(injection!.sourceSchoolYearId, SOURCE_YEAR);
  assert.equal(injection!.targetSchoolYearId, TARGET_YEAR);
  assert.equal(injection!.targetAnnualCourseId, targetInjection.id);
  assert.deepEqual(injection!.currentPlan, [{ dayOfWeek: 1, weekKind: "all", role: "PRIMARY" }]);
  assert.equal(injection!.currentPlanOrigin, "target-course");
  assert.equal(injection!.matchesLastPreparation, true);
  assert.deepEqual(injection!.preparations.map((entry) => entry.transitionId), ["import-inj"]);

  const second = await persistPreview(seeded, [thursdayB(SOURCE_CHASSIS)], "import-chassis", [SOURCE_CHASSIS]);
  assert.equal((await applyPersistedYearTransition(second.persisted.id, seeded.deps)).ok, true);
  const same = await persistPreview(seeded, [mondayAll(SOURCE_INJECTION)], "import-inj-again", [SOURCE_INJECTION]);
  assert.equal((await applyPersistedYearTransition(same.persisted.id, seeded.deps)).ok, true);

  const afterAll = await loadYearTransitionPrepareState(deps, "admin-1");
  const bySource = new Map(afterAll.courseImports.map((state) => [state.sourceAnnualCourseId, state]));
  assert.deepEqual(
    bySource.get(SOURCE_CHASSIS)?.currentPlan,
    [{ dayOfWeek: 4, weekKind: "B", role: "PRIMARY" }],
  );
  assert.deepEqual(
    bySource.get(SOURCE_INJECTION)?.preparations.map((entry) => entry.transitionId),
    ["import-inj", "import-inj-again"],
    "première et dernière préparation conservées",
  );
  assert.deepEqual(
    bySource.get(SOURCE_INJECTION)?.currentPlan,
    [{ dayOfWeek: 1, weekKind: "all", role: "PRIMARY" }],
    "la préparation CP2 ne touche pas au plan CP1",
  );
});

test("état d’import : année cible activée → plus rien à préparer", async () => {
  const seeded = await world();
  const deps = seeded.deps as YearTransitionPrepareDeps;
  const { persisted } = await persistPreview(seeded, [mondayAll(SOURCE_INJECTION)]);
  assert.equal((await applyPersistedYearTransition(persisted.id, seeded.deps)).ok, true);
  assert.equal((await loadYearTransitionPrepareState(deps, "admin-1")).courseImports.length, 1);
  const target = await seeded.years.getSchoolYearById(TARGET_YEAR);
  replaceMemorySchoolYears([
    { ...(await seeded.years.getSchoolYearById(SOURCE_YEAR))!, status: "archived" },
    { ...target!, status: "active", activatedAt: "2027-08-01T00:00:00.000Z" },
  ]);
  assert.deepEqual((await loadYearTransitionPrepareState(deps, "admin-1")).courseImports, []);
});

async function adminPreview(
  seeded: Awaited<ReturnType<typeof world>>,
  plans: YearTransitionTargetMeetingDayPlan[],
  extra: { reimport?: string[]; selected?: string[] } = {},
) {
  return createAuthorizedYearTransitionPreview(
    {
      sourceSchoolYearId: SOURCE_YEAR,
      targetSchoolYearId: TARGET_YEAR,
      selectedSourceClassIds: [SOURCE_CLASS],
      selectedSourceAnnualCourseIds: extra.selected ?? plans.map((entry) => entry.sourceAnnualCourseId),
      targetMeetingDayPlans: plans,
      ...(extra.reimport ? { reimportSourceAnnualCourseIds: extra.reimport } : {}),
    },
    "",
    seeded.deps as YearTransitionPrepareDeps,
  );
}

async function adminImport(seeded: Awaited<ReturnType<typeof world>>, plans: YearTransitionTargetMeetingDayPlan[]) {
  const created = await adminPreview(seeded, plans);
  assert.equal(created.blocking, false, JSON.stringify(created.preview.mappingIssues));
  const applied = await applyAuthorizedYearTransition(
    { transitionId: created.transitionId, confirm: true },
    "admin-1",
    seeded.deps as YearTransitionPrepareDeps,
  );
  assert.equal(applied.ok, true, JSON.stringify(applied));
  return created.transitionId;
}

function sixthMondayItem(id: number, title: string) {
  return item({
    id,
    title,
    courseSessionKey: `${SOURCE_YEAR}|${SOURCE_INJECTION}|2027-09-27`,
    courseSessionDate: "2027-09-27",
    schoolWeekNumber: 6,
  });
}

test("réimportation : lundi → jeudi B, contenu hérité remplacé et reprojeté depuis N", async () => {
  const seeded = await world();
  await adminImport(seeded, [mondayAll(SOURCE_INJECTION)]);
  const targetCourse = await targetCourseOf(seeded);
  const beforeItems = (await seeded.agenda.exportAllItems()).filter((entry) => entry.schoolYearId === TARGET_YEAR);
  const beforeNotes = await seeded.notes.listNotesByAnnualCourse(targetCourse.id);
  assert.equal(beforeItems.length, 3);
  assert.equal(beforeNotes.length, 2);

  const created = await adminPreview(seeded, [thursdayB(SOURCE_INJECTION)], { reimport: [SOURCE_INJECTION] });
  assert.equal(created.blocking, false, JSON.stringify(created.preview));
  assert.deepEqual(created.reimport.unchangedSourceAnnualCourseIds, []);
  const [summary] = created.reimport.courses;
  assert.ok(summary);
  assert.equal(summary.sourceAnnualCourseId, SOURCE_INJECTION);
  assert.equal(summary.targetAnnualCourseId, targetCourse.id);
  assert.deepEqual(summary.replaced, { publications: 3, notes: 2 });
  assert.deepEqual(summary.positioned, { publications: 3, notes: 2 });
  assert.deepEqual(summary.toReclassify, { publications: 0, notes: 0 });
  assert.deepEqual(summary.lost, { publications: 0, notes: 0 });
  assert.deepEqual(summary.blocking, { publications: 0, notes: 0 });
  assert.equal(summary.adminPlacementsRecalculated, 0);
  assert.deepEqual(summary.manualContent, { kept: 0, onVanishedSession: 0 });
  assert.doesNotMatch(JSON.stringify(created.preview), /TARGET_EXISTING_DIVERGED/);
  for (const entry of created.preview.publications.projectable) {
    assert.match(entry.sessionLabel ?? "", /jeudi 02\.09\.2027/, "première séance jeudi B");
  }

  const after = (await seeded.agenda.exportAllItems()).filter((entry) => entry.schoolYearId === TARGET_YEAR);
  assert.deepEqual(after, beforeItems, "l’aperçu n’écrit rien");
  assert.deepEqual(await seeded.notes.listNotesByAnnualCourse(targetCourse.id), beforeNotes);
});

test("réimportation : plan identique → aucun remplacement, cours signalé inchangé", async () => {
  const seeded = await world();
  await adminImport(seeded, [mondayAll(SOURCE_INJECTION)]);
  const created = await adminPreview(seeded, [mondayAll(SOURCE_INJECTION)], { reimport: [SOURCE_INJECTION] });
  assert.deepEqual(created.reimport.unchangedSourceAnnualCourseIds, [SOURCE_INJECTION]);
  assert.deepEqual(created.reimport.courses, []);
  assert.equal(created.preview.publications.alreadyPresent.length, 3);
  assert.equal(created.blocking, false);
});

test("réimportation : cours jamais importé ou ancien flux refusés côté serveur", async () => {
  const seeded = await world();
  await assert.rejects(
    adminPreview(seeded, [thursdayB(SOURCE_INJECTION)], { reimport: [SOURCE_INJECTION] }),
    { message: YEAR_TRANSITION_REIMPORT_NOT_IMPORTED },
  );
  await assert.rejects(
    createAuthorizedYearTransitionPreview(
      {
        sourceSchoolYearId: SOURCE_YEAR,
        targetSchoolYearId: TARGET_YEAR,
        selectedSourceClassIds: [SOURCE_CLASS],
        reimportSourceAnnualCourseIds: [SOURCE_INJECTION],
      },
      "",
      seeded.deps as YearTransitionPrepareDeps,
    ),
    { message: YEAR_TRANSITION_REIMPORT_REQUIRES_PLAN },
  );
});

test("réimportation : placement admin recalculé, contenu manuel et créneau signalés", async () => {
  const seeded = await world({
    extraItems: [item({ id: 10, title: "Devoir S1" }), sixthMondayItem(13, "Devoir S6")],
    extraNotes: [note("n-a", TEACHER_A)],
  });
  const firstTransition = await adminImport(seeded, [thursdayB(SOURCE_INJECTION)]);
  const targetCourse = await targetCourseOf(seeded);
  const targetYear = (await seeded.years.getSchoolYearById(TARGET_YEAR))!;
  const sessions = computeCourseSessions({
    schoolYearId: TARGET_YEAR,
    courses: [{ id: targetCourse.id, classId: targetCourse.classId, contextId: targetCourse.contextId }],
    slots: [],
    weeks: targetYear.weeks,
    holidays: valaisHolidaysForSchoolYear(targetYear.label),
    meetingDays: (await seeded.schedules.listMeetingDaysByAnnualCourse(targetCourse.id)).map((day) => ({
      annualCourseId: day.annualCourseId,
      dayOfWeek: day.dayOfWeek,
      weekKind: day.weekKind,
    })),
  });
  const thursdays = sessions.map((session) => session.key);
  assert.ok(thursdays.length >= 2);

  const items = await seeded.agenda.exportAllItems();
  const unplaced = items.find((entry) => entry.sourceAgendaItemId === 13);
  assert.ok(unplaced, "S6 copiée");
  assert.equal(unplaced.courseSessionKey ?? null, null, "S6 laissée « À reclasser »");
  assert.equal(unplaced.sourceTransitionId, firstTransition);
  await seeded.agenda.replaceAllItems([
    ...items.map((entry) => (entry.id === unplaced.id ? { ...entry, courseSessionKey: thursdays[1]! } : entry)),
    item({
      id: 900,
      title: "Ajout manuel",
      schoolYearId: TARGET_YEAR,
      annualCourseId: targetCourse.id,
      courseSessionKey: thursdays[0]!,
      courseSessionDate: thursdays[0]!.split("|")[2]!,
    }),
  ]);
  await seeded.schedules.createSlot({
    id: "slot-target-thursday",
    annualCourseId: targetCourse.id,
    dayOfWeek: 4,
    periodStart: 5,
    periodEnd: 6,
    weekKind: "B",
    validFrom: null,
    validTo: null,
    createdAt: "2027-03-01T00:00:00.000Z",
    updatedAt: "2027-03-01T00:00:00.000Z",
  });

  const created = await adminPreview(seeded, [mondayAll(SOURCE_INJECTION)], { reimport: [SOURCE_INJECTION] });
  const [summary] = created.reimport.courses;
  assert.ok(summary);
  assert.deepEqual(summary.replaced, { publications: 2, notes: 1 });
  assert.deepEqual(summary.positioned, { publications: 2, notes: 1 });
  assert.equal(summary.adminPlacementsRecalculated, 1);
  assert.deepEqual(summary.manualContent, { kept: 1, onVanishedSession: 1 });
  assert.deepEqual(summary.unusedSlots.map((slot) => slot.slotId), ["slot-target-thursday"]);
  assert.ok(
    (await seeded.schedules.listSlotsByAnnualCourse(targetCourse.id)).some((slot) => slot.id === "slot-target-thursday"),
    "le créneau n’est jamais déplacé",
  );
});

test("réimportation : APPLY refusé tant que la confirmation dédiée n’existe pas, aucune écriture", async () => {
  const seeded = await world({ extraCourses: [course(SOURCE_CHASSIS, CTX_CHASSIS)] });
  await adminImport(seeded, [mondayAll(SOURCE_INJECTION)]);
  const targetCourse = await targetCourseOf(seeded);
  const meetingDaysBefore = await seeded.schedules.listMeetingDaysByAnnualCourse(targetCourse.id);
  const itemsBefore = await seeded.agenda.exportAllItems();
  const coursesBefore = await seeded.courses.listCourses();

  const created = await adminPreview(
    seeded,
    [thursdayB(SOURCE_INJECTION), mondayAll(SOURCE_CHASSIS)],
    { reimport: [SOURCE_INJECTION] },
  );
  assert.equal(created.reimport.courses.length, 1, "CP2 non importé n’est pas une réimportation");
  const outcome = await applyPersistedYearTransition(created.transitionId, seeded.deps);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.ok ? null : outcome.code, "APPLY_BLOCKED");
  assert.ok(JSON.stringify(outcome).includes(YEAR_TRANSITION_REIMPORT_APPLY_PENDING));
  assert.deepEqual(await seeded.schedules.listMeetingDaysByAnnualCourse(targetCourse.id), meetingDaysBefore);
  assert.deepEqual(await seeded.agenda.exportAllItems(), itemsBefore);
  assert.deepEqual(await seeded.courses.listCourses(), coursesBefore, "CP2 n’est pas créé non plus");
});

test("réimportation : l’empreinte dépend du contenu hérité remplacé", async () => {
  const seeded = await world();
  await adminImport(seeded, [mondayAll(SOURCE_INJECTION)]);
  const fingerprintOf = async () => {
    const created = await adminPreview(seeded, [thursdayB(SOURCE_INJECTION)], { reimport: [SOURCE_INJECTION] });
    const persisted = await seeded.previews.getById(created.transitionId);
    assert.ok(persisted);
    assert.match(persisted.snapshotJson, /"reimport"/);
    return persisted.fingerprint;
  };
  const first = await fingerprintOf();
  assert.equal(await fingerprintOf(), first, "même état → même empreinte");
  const items = await seeded.agenda.exportAllItems();
  await seeded.agenda.replaceAllItems(
    items.map((entry) => (entry.schoolYearId === TARGET_YEAR && entry.type === "TEST" ? { ...entry, title: "Modifié" } : entry)),
  );
  assert.notEqual(await fingerprintOf(), first);
});
