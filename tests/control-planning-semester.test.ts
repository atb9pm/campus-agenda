import assert from "node:assert/strict";
import test from "node:test";

import type { PrototypeAgendaItem } from "../src/features/agenda/demo-items.ts";
import type { AnnualCourse, TeacherCourseAssignment } from "../src/features/annual-courses/types.ts";
import {
  buildControlPlanningView,
  classDayControlsForPlacementOption,
  confirmationRequiredForPlacementOption,
  getControlPlanning,
  listAssignedStructuredPlanningClassrooms,
  listControlPlacementOptions,
  parseControlPlanningClassroomIds,
  resolveAssignedClassroomSelection,
  splitControlPlanningPeriods,
  toggleControlPlanningClassroomSelection,
  type ControlPlacementOption,
  type ControlPlanningServiceDeps,
} from "../src/features/control-planning/index.ts";
import { TEST_ALERT_THRESHOLD } from "../src/features/evaluations/index.ts";
import { computeCourseSessions } from "../src/features/course-sessions/index.ts";
import type { CourseScheduleSlot } from "../src/features/course-schedule/types.ts";
import type { SchoolClassRecord } from "../src/features/school-catalog/types.ts";
import type { SchoolYearWithWeeks } from "../src/features/school-year/types.ts";
import { APP_VERSION } from "../src/lib/app-version.ts";
import { SQL_MIGRATION_FILES } from "../src/lib/persistence/sql/migrate.ts";

const TEACHER_ID = "teacher-demo-martin";
const OTHER_ID = "teacher-demo-dupont";
const YEAR_ID = "year-2026";

function mondayWeeks(startMonday: string, count: number) {
  const weeks: Array<{ number: number; kind: "A" | "B"; monday: string }> = [];
  const [year, month, day] = startMonday.split("-").map(Number);
  const cursor = new Date(year!, month! - 1, day, 12);
  for (let number = 1; number <= count; number += 1) {
    const iso = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
    weeks.push({ number, kind: number % 2 === 1 ? "A" : "B", monday: iso });
    cursor.setDate(cursor.getDate() + 7);
  }
  return weeks;
}

const WEEKS = mondayWeeks("2026-08-17", 5);

function yearRecord(id: string, label: string, status: SchoolYearWithWeeks["status"], weeks = WEEKS): SchoolYearWithWeeks {
  return {
    id,
    label,
    status,
    startsOn: `${label.slice(0, 4)}-08-17`,
    endsOn: `${label.slice(5)}-07-02`,
    sourceFilename: "seed",
    importedAt: "2026-08-01T00:00:00.000Z",
    activatedAt: status === "active" ? "2026-08-01T00:00:00.000Z" : null,
    createdAt: "2026-08-01T00:00:00.000Z",
    weeks,
  };
}

function schoolClass(id: string, code: string, schoolYearId: string, archived = false): SchoolClassRecord {
  return {
    id,
    code,
    label: code,
    sortOrder: 1,
    isActive: !archived,
    schoolYearId,
    schoolYearLabel: "2026-2027",
    professionId: "prof-mma",
    trainingYear: 3,
    parallelCode: "A",
    isArchived: archived,
    archivedAt: archived ? "2026-08-01T00:00:00.000Z" : null,
  };
}

function course(id: string, classId: string, schoolYearId = YEAR_ID): AnnualCourse {
  return {
    id,
    schoolYearId,
    classId,
    contextId: "ctx-moteur",
    isArchived: false,
    archivedAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

function tca(
  id: string,
  annualCourseId: string,
  teacherId: string,
  role: TeacherCourseAssignment["role"] = "PRIMARY",
  validFrom = "2026-08-01T00:00:00.000Z",
  validTo: string | null = null,
): TeacherCourseAssignment {
  return {
    id,
    annualCourseId,
    teacherId,
    role,
    validFrom,
    validTo,
    createdByAdminId: "admin-1",
    createdAt: "2026-08-01T00:00:00.000Z",
    endedAt: null,
    overrideReason: null,
    overrideByAdminId: null,
  };
}

function slotFor(courseId: string, patch: Partial<CourseScheduleSlot> & { id: string }): CourseScheduleSlot {
  return {
    annualCourseId: courseId,
    dayOfWeek: 1,
    periodStart: 4,
    periodEnd: 4,
    weekKind: "all",
    validFrom: null,
    validTo: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...patch,
  };
}

function testItem(input: {
  id: number;
  classroomId: string;
  title: string;
  teacherId?: string;
  type?: PrototypeAgendaItem["type"];
  day?: number;
  schoolWeekNumber?: number;
  annualCourseId?: string;
  courseSessionKey?: string;
  courseSessionDate?: string;
}): PrototypeAgendaItem {
  return {
    id: input.id,
    classroomId: input.classroomId,
    subjectId: "subject-moteur",
    authorTeacherId: input.teacherId ?? TEACHER_ID,
    day: input.day ?? 0,
    hour: 9,
    weekOffset: 0,
    schoolWeekNumber: input.schoolWeekNumber ?? 1,
    type: input.type ?? "TEST",
    title: input.title,
    detail: "Contrôle",
    schoolYearId: YEAR_ID,
    annualCourseId: input.annualCourseId ?? null,
    courseSessionKey: input.courseSessionKey ?? null,
    courseSessionDate: input.courseSessionDate ?? null,
  };
}

test("version 2.38.0 — semestre visuel, pas de migration", () => {
  assert.equal(APP_VERSION, "2.41.0");
  assert.equal(SQL_MIGRATION_FILES.at(-1), "0024_structured_agenda_bridge.sql");
  assert.equal(SQL_MIGRATION_FILES.some((file) => file.startsWith("0025")), false);
});

test("semestres — tri par monday, coupe continue, aucune semaine inventée", () => {
  const odd = splitControlPlanningPeriods(mondayWeeks("2026-08-17", 5));
  assert.equal(odd[0]?.id, "semester-1");
  assert.equal(odd[0]?.weeks.length, 3);
  assert.equal(odd[1]?.weeks.length, 2);
  assert.deepEqual(
    odd[0]?.weeks.map((week) => week.number),
    [1, 2, 3],
  );
  assert.deepEqual(
    odd[1]?.weeks.map((week) => week.number),
    [4, 5],
  );
  const shuffled = splitControlPlanningPeriods([
    { number: 3, kind: "A", monday: "2026-08-31" },
    { number: 1, kind: "A", monday: "2026-08-17" },
    { number: 2, kind: "B", monday: "2026-08-24" },
    { number: 4, kind: "B", monday: "2026-09-07" },
  ]);
  assert.deepEqual(
    shuffled.flatMap((period) => period.weeks.map((week) => week.monday)),
    ["2026-08-17", "2026-08-24", "2026-08-31", "2026-09-07"],
  );
});

test("multi-sélection — Toutes, cumul, pas de vide, parse classroomIds", () => {
  const assigned = ["ma3a", "mecauto", "mma2a"];
  assert.equal(toggleControlPlanningClassroomSelection(null, assigned, "ma3a")?.join(), "ma3a");
  const two = toggleControlPlanningClassroomSelection(["ma3a"], assigned, "mecauto");
  assert.deepEqual(two, ["ma3a", "mecauto"]);
  const three = toggleControlPlanningClassroomSelection(two, assigned, "mma2a");
  assert.deepEqual(three, ["ma3a", "mecauto", "mma2a"]);
  const removed = toggleControlPlanningClassroomSelection(three, assigned, "mecauto");
  assert.deepEqual(removed, ["ma3a", "mma2a"]);
  assert.deepEqual(toggleControlPlanningClassroomSelection(["ma3a"], assigned, "ma3a"), ["ma3a"]);
  assert.deepEqual(parseControlPlanningClassroomIds({ classroomIds: "ma3a,mecauto,ma3a", classroomId: "mma2a" }), [
    "ma3a",
    "mecauto",
    "mma2a",
  ]);
  const all = resolveAssignedClassroomSelection({ requestedIds: [], assignedIds: assigned });
  assert.equal(all.ok, true);
  if (all.ok) {
    assert.equal(all.allSelected, true);
    assert.deepEqual(all.selectedIds, assigned);
  }
  const forged = resolveAssignedClassroomSelection({ requestedIds: ["forged"], assignedIds: assigned });
  assert.equal(forged.ok, false);
});

test("classes attribuées — AnnualCourse Mes cours, pas membership ni CourseSession", () => {
  const year = yearRecord(YEAR_ID, "2026-2027", "active");
  const ma3a = schoolClass("sc-ma3a", "MA3A", YEAR_ID);
  const mecauto = schoolClass("sc-mecauto", "MECAUTO3A", YEAR_ID);
  const mma2a = schoolClass("sc-mma2a", "MMA2A", YEAR_ID);
  const mma1a = schoolClass("sc-mma1a", "MMA1A", YEAR_ID);
  const prev = schoolClass("sc-mma1a-prev", "MMA1A", "year-2025");
  const courseMa3a = course("ac-ma3a", ma3a.id);
  const courseMecauto = course("ac-mecauto", mecauto.id);
  const courseMma2a = course("ac-mma2a", mma2a.id);
  const courseMma1a = course("ac-mma1a", mma1a.id);
  const coursePrev = course("ac-mma1a-prev", prev.id, "year-2025");
  const rooms = [
    { id: "rt-ma3a", name: "MA3A", schoolClassId: ma3a.id },
    { id: "rt-mecauto", name: "MECAUTO3A", schoolClassId: mecauto.id },
    { id: "rt-mma2a", name: "MMA2A", schoolClassId: mma2a.id },
    { id: "rt-mma1a", name: "MMA1A", schoolClassId: mma1a.id },
    { id: "rt-legacy", name: "Legacy" },
    { id: "rt-mma1a-prev", name: "MMA1A", schoolClassId: prev.id },
  ];
  const contexts = [
    {
      id: "ctx-moteur",
      adminCode: "CTX-0001",
      professionId: "prof-mma",
      trainingYear: 3,
      branchId: "br-moteur",
      isActive: true,
      isArchived: false,
      archivedAt: null,
    },
  ];
  const branches = [
    {
      id: "br-moteur",
      code: "MOT",
      label: "Moteur",
      sortOrder: 1,
      isActive: true,
      adminCode: "BR-0001",
      isArchived: false,
      archivedAt: null,
      teachingType: "TECHNICAL" as const,
    },
  ];
  const at = "2026-09-15T12:00:00.000Z";

  const assigned = listAssignedStructuredPlanningClassrooms({
    teacherId: TEACHER_ID,
    classrooms: rooms,
    classes: [ma3a, mecauto, mma2a, mma1a, prev],
    courses: [courseMa3a, courseMecauto, courseMma2a, courseMma1a, coursePrev],
    assignments: [
      tca("a-ma3a", courseMa3a.id, TEACHER_ID),
      tca("a-mecauto", courseMecauto.id, TEACHER_ID, "CO_TEACHER"),
      tca("a-mma2a-other", courseMma2a.id, OTHER_ID),
      tca("a-mma1a-none", courseMma1a.id, OTHER_ID),
    ],
    years: [year],
    contexts,
    branches,
    schoolYearId: YEAR_ID,
    at,
  });
  assert.deepEqual(
    assigned.map((entry) => entry.id).sort(),
    ["rt-ma3a", "rt-mecauto"].sort(),
  );
  assert.equal(assigned.some((entry) => entry.id === "rt-mma1a"), false);
  assert.equal(assigned.some((entry) => entry.id === "rt-legacy"), false);
  assert.equal(assigned.some((entry) => entry.id === "rt-mma2a"), false);
  assert.equal(assigned.some((entry) => entry.id === "rt-mma1a-prev"), false);

  const replacementOk = listAssignedStructuredPlanningClassrooms({
    teacherId: TEACHER_ID,
    classrooms: rooms,
    classes: [mma2a],
    courses: [courseMma2a],
    assignments: [
      tca("a-rep", courseMma2a.id, TEACHER_ID, "REPLACEMENT", "2026-09-01T00:00:00.000Z", "2026-09-30T23:59:59.000Z"),
    ],
    years: [year],
    contexts,
    branches,
    schoolYearId: YEAR_ID,
    at,
  });
  assert.ok(replacementOk.some((entry) => entry.id === "rt-mma2a"));

  const replacementMiss = listAssignedStructuredPlanningClassrooms({
    teacherId: TEACHER_ID,
    classrooms: rooms,
    classes: [mma2a],
    courses: [courseMma2a],
    assignments: [
      tca("a-rep-miss", courseMma2a.id, TEACHER_ID, "REPLACEMENT", "2027-01-01T00:00:00.000Z", "2027-01-31T23:59:59.000Z"),
    ],
    years: [year],
    contexts,
    branches,
    schoolYearId: YEAR_ID,
    at,
  });
  assert.equal(replacementMiss.some((entry) => entry.id === "rt-mma2a"), false);
});

function structuredWorld() {
  const year = yearRecord(YEAR_ID, "2026-2027", "active");
  const ma3a = schoolClass("sc-ma3a", "MA3A", YEAR_ID);
  const mecauto = schoolClass("sc-mecauto", "MECAUTO3A", YEAR_ID);
  const mma2a = schoolClass("sc-mma2a", "MMA2A", YEAR_ID);
  const mma1a = schoolClass("sc-mma1a", "MMA1A", YEAR_ID);
  const courseMa3a = course("ac-ma3a", ma3a.id);
  const courseMecauto = course("ac-mecauto", mecauto.id);
  const courseMma2a = course("ac-mma2a", mma2a.id);
  const courseChassis = course("ac-chassis", ma3a.id);
  const rooms = [
    { id: "rt-ma3a", name: "MA3A", schoolClassId: ma3a.id },
    { id: "rt-mecauto", name: "MECAUTO3A", schoolClassId: mecauto.id },
    { id: "rt-mma2a", name: "MMA2A", schoolClassId: mma2a.id },
    { id: "rt-mma1a", name: "MMA1A", schoolClassId: mma1a.id },
    { id: "rt-legacy", name: "Legacy" },
  ];
  const courses = [courseMa3a, courseMecauto, courseMma2a, courseChassis];
  const assignments = [
    tca("a-ma3a", courseMa3a.id, TEACHER_ID),
    tca("a-chassis", courseChassis.id, TEACHER_ID),
    tca("a-mecauto", courseMecauto.id, TEACHER_ID),
    tca("a-mma2a", courseMma2a.id, TEACHER_ID),
  ];
  const slots = [
    slotFor(courseMa3a.id, { id: "s-ma3a", dayOfWeek: 1 }),
    slotFor(courseChassis.id, { id: "s-chassis", dayOfWeek: 1, periodStart: 6, periodEnd: 6 }),
    slotFor(courseMecauto.id, { id: "s-mecauto-p4", dayOfWeek: 4, periodStart: 4, periodEnd: 4 }),
    slotFor(courseMecauto.id, { id: "s-mecauto-p6", dayOfWeek: 4, periodStart: 6, periodEnd: 6 }),
    slotFor(courseMma2a.id, { id: "s-mma2a", dayOfWeek: 2 }),
  ];
  const items: PrototypeAgendaItem[] = [
    testItem({ id: 1, classroomId: "rt-ma3a", title: "Contrôle MA3A", day: 0, schoolWeekNumber: 1 }),
    testItem({
      id: 2,
      classroomId: "rt-mecauto",
      title: "Contrôle injection",
      day: 3,
      schoolWeekNumber: 1,
      annualCourseId: courseMecauto.id,
    }),
    testItem({
      id: 3,
      classroomId: "rt-mecauto",
      title: "Contrôle collègue",
      teacherId: OTHER_ID,
      day: 3,
      schoolWeekNumber: 1,
    }),
    testItem({ id: 4, classroomId: "rt-mma1a", title: "Contrôle MMA1A membership", day: 2 }),
    testItem({ id: 5, classroomId: "rt-ma3a", title: "Devoir", type: "HOMEWORK" }),
    testItem({ id: 6, classroomId: "rt-ma3a", title: "Info", type: "INFORMATION" }),
    testItem({ id: 7, classroomId: "rt-mma2a", title: "Contrôle MMA2A", day: 1, schoolWeekNumber: 3 }),
  ];
  const deps: ControlPlanningServiceDeps = {
    agenda: {
      listAgendaItems: async (classroomId: string) => items.filter((item) => item.classroomId === classroomId),
      teacherCanAccessClassroom: async (_teacherId: string, classroomId: string) =>
        classroomId === "rt-mma1a" || classroomId === "rt-legacy" || rooms.some((room) => room.id === classroomId),
    },
    adapters: {
      listClassrooms: async () => rooms,
      listSubjects: async () => [
        { id: "subject-moteur", name: "Moteur" },
        { id: "subject-chassis", name: "Châssis" },
      ],
    },
    catalog: {
      ensureSeeded: async () => undefined,
      listClasses: async () => [ma3a, mecauto, mma2a, mma1a],
      listContexts: async () => [
        {
          id: "ctx-moteur",
          adminCode: "CTX-0001",
          professionId: "prof-mma",
          trainingYear: 3,
          branchId: "br-moteur",
          isActive: true,
          isArchived: false,
          archivedAt: null,
        },
      ],
      listBranches: async () => [
        {
          id: "br-moteur",
          code: "MOT",
          label: "Moteur",
          sortOrder: 1,
          isActive: true,
          adminCode: "BR-0001",
          isArchived: false,
          archivedAt: null,
          teachingType: "TECHNICAL",
        },
      ],
    },
    courses: {
      listCourses: async () => courses,
      listAssignments: async () => assignments,
    },
    years: {
      listSchoolYears: async () => [year],
      getActiveSchoolYear: async () => year,
      getSchoolYearById: async (id: string) => (id === year.id ? year : null),
      listDayExceptions: async () => [],
    },
    teachers: {
      listAccounts: async () => [
        { id: TEACHER_ID, displayName: "François Martin", initials: "FM" },
        { id: OTHER_ID, displayName: "Mme Dupont", initials: "MD" },
      ],
    },
    schedules: { listSlots: async () => slots },
  } as unknown as ControlPlanningServiceDeps;
  return { deps, year, rooms, items, slots, courses };
}

test("service — semestre, multi-classes, MMA1A exclue, class-all, 403 forgé", async () => {
  const { deps } = structuredWorld();
  const all = await getControlPlanning(deps, {
    teacherId: TEACHER_ID,
    todayIso: "2026-08-17",
    view: "semester",
  });
  assert.equal(all.ok, true);
  if (!all.ok) return;
  assert.equal(all.view.layout, "semester");
  assert.equal(all.view.periodId, "semester-1");
  assert.equal(all.view.allClassesSelected, true);
  assert.deepEqual(
    all.view.classes.map((entry) => entry.name).sort(),
    ["MA3A", "MECAUTO3A", "MMA2A"],
  );
  assert.equal(all.view.classes.some((entry) => entry.name === "MMA1A"), false);
  assert.equal(all.view.classes.some((entry) => entry.name === "Legacy"), false);
  assert.ok(all.view.semester);
  assert.deepEqual(
    all.view.semester!.weeks.map((week) => week.number),
    [1, 2, 3],
  );
  assert.ok(all.view.semester!.weeks.every((week) => week.kind === "A" || week.kind === "B"));
  assert.equal(all.view.semester!.weeks.length, splitControlPlanningPeriods(WEEKS)[0]!.weeks.length);
  assert.deepEqual(all.view.semester!.visibleDayIndexes, [0, 1, 3]);
  const weekWithoutCourse = all.view.semester!.weeks.find((week) => !week.hasCourse);
  if (weekWithoutCourse) {
    assert.equal(weekWithoutCourse.days.every((day) => day.hasCourse === false || day.controls.length >= 0), true);
  }
  assert.equal(
    all.view.semester!.weeks.flatMap((week) => week.days).some((day) => day.controls.some((card) => card.title === "Devoir")),
    false,
  );
  assert.equal(
    all.view.semester!.weeks
      .flatMap((week) => week.days)
      .some((day) => day.controls.some((card) => card.title === "Contrôle collègue")),
    false,
  );
  assert.equal(
    all.view.semester!.weeks
      .flatMap((week) => week.days)
      .some((day) => day.controls.some((card) => card.title === "Contrôle MMA1A membership")),
    false,
  );

  const monday = all.view.semester!.weeks[0]!.days.find((day) => day.dayIndex === 0);
  assert.ok(monday?.hasCourse);
  assert.ok(monday!.placementOptions.length >= 2);
  assert.ok(monday!.placementOptions.every((option) => option.annualCourseId && option.courseSessionKey && option.date));
  const thursday = all.view.semester!.weeks[0]!.days.find((day) => day.dayIndex === 3);
  assert.equal(thursday?.placementOptions.filter((option) => option.classroomName === "MECAUTO3A").length, 1);
  assert.ok(thursday?.controls.some((card) => card.title === "Contrôle injection"));
  assert.ok(thursday?.controls[0]?.courseSessionDate || thursday?.controls[0]?.date);

  const two = await getControlPlanning(deps, {
    teacherId: TEACHER_ID,
    classroomIds: "rt-ma3a,rt-mecauto",
    mode: "class-all",
    view: "semester",
    todayIso: "2026-08-17",
  });
  assert.equal(two.ok, true);
  if (!two.ok) return;
  assert.equal(two.view.mode, "class-all");
  assert.equal(two.view.allClassesSelected, false);
  assert.deepEqual(two.view.classroomIds.sort(), ["rt-ma3a", "rt-mecauto"].sort());
  const classAllCards = two.view.semester!.weeks.flatMap((week) => week.days.flatMap((day) => day.controls));
  assert.ok(classAllCards.some((card) => card.title === "Contrôle collègue"));
  assert.equal(classAllCards.some((card) => card.title === "Contrôle MMA2A"), false);

  const forged = await getControlPlanning(deps, {
    teacherId: TEACHER_ID,
    classroomIds: "rt-ma3a,rt-mma1a",
  });
  assert.equal(forged.ok, false);
  if (!forged.ok) assert.equal(forged.status, 403);

  const unknown = await getControlPlanning(deps, {
    teacherId: TEACHER_ID,
    classroomId: "classe-inconnue",
  });
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.equal(unknown.status, 403);

  const archivedYear = { ...yearRecord(YEAR_ID, "2026-2027", "archived"), weeks: WEEKS };
  const archived = await getControlPlanning(
    {
      ...deps,
      years: {
        listSchoolYears: async () => [archivedYear],
        getActiveSchoolYear: async () => null,
        getSchoolYearById: async (id: string) => (id === archivedYear.id ? archivedYear : null),
        listDayExceptions: async () => [],
      },
    } as unknown as ControlPlanningServiceDeps,
    { teacherId: TEACHER_ID, schoolYearId: YEAR_ID, todayIso: "2026-08-17" },
  );
  assert.equal(archived.ok, true);
  if (archived.ok) {
    assert.equal(archived.view.yearStatus, "archived");
    assert.equal(archived.view.canCreate, false);
    assert.equal(archived.view.periodId, "semester-1");
    assert.ok(archived.view.semester?.weeks.every((week) => week.days.every((day) => day.canPlan === false)));
  }
});

test("semestre — férié inactif, exception attribuable, P4+P6 unique, semaine vide conservée", () => {
  const weeks = mondayWeeks("2026-08-17", 3);
  const holidays = [
    { date: "2026-08-20", label: "Fête" },
    { date: "2026-08-24", label: "Vacances" },
    { date: "2026-08-25", label: "Vacances" },
    { date: "2026-08-26", label: "Vacances" },
    { date: "2026-08-27", label: "Vacances" },
    { date: "2026-08-28", label: "Vacances" },
  ];
  const sessions = computeCourseSessions({
    schoolYearId: YEAR_ID,
    courses: [
      { id: "ac-moteur", classId: "sc-mecauto", contextId: "ctx-moteur" },
      { id: "ac-chassis", classId: "sc-ma3a", contextId: "ctx-chassis" },
    ],
    slots: [
      slotFor("ac-moteur", { id: "s-p4", dayOfWeek: 4, periodStart: 4, periodEnd: 4 }),
      slotFor("ac-moteur", { id: "s-p6", dayOfWeek: 4, periodStart: 6, periodEnd: 6 }),
      slotFor("ac-chassis", { id: "s-mon", dayOfWeek: 1 }),
    ],
    weeks,
    holidays,
    exceptions: [{ date: "2026-08-20", state: "class", label: "Cours rattrapé" }],
  });
  const thursday = sessions.filter((session) => session.date === "2026-08-20" && session.annualCourseId === "ac-moteur");
  assert.equal(thursday.length, 1);
  assert.equal(thursday[0]?.segments.length, 2);
  const holidayOnly = computeCourseSessions({
    schoolYearId: YEAR_ID,
    courses: [{ id: "ac-moteur", classId: "sc-mecauto", contextId: "ctx-moteur" }],
    slots: [slotFor("ac-moteur", { id: "s-hol", dayOfWeek: 4 })],
    weeks,
    holidays,
  });
  assert.equal(holidayOnly.some((session) => session.date === "2026-08-20"), false);
  const options = listControlPlacementOptions({
    sessions,
    assignments: [tca("a1", "ac-moteur", TEACHER_ID), tca("a2", "ac-chassis", TEACHER_ID)],
    teacherId: TEACHER_ID,
    branchByCourseId: new Map([
      ["ac-moteur", "Moteur"],
      ["ac-chassis", "Châssis"],
    ]),
    yearStatus: "active",
    classroomSelected: true,
    structured: true,
    classroomByClassId: new Map([
      ["sc-mecauto", { id: "rt-mecauto", name: "MECAUTO3A" }],
      ["sc-ma3a", { id: "rt-ma3a", name: "MA3A" }],
    ]),
  });
  assert.equal(options.filter((entry) => entry.date === "2026-08-20" && entry.annualCourseId === "ac-moteur").length, 1);
  assert.ok(options.some((entry) => entry.classroomName === "MECAUTO3A" && entry.courseSessionKey));
  assert.ok(options.some((entry) => entry.classroomName === "MA3A"));

  const view = buildControlPlanningView({
    teacherId: TEACHER_ID,
    items: [
      testItem({
        id: 11,
        classroomId: "rt-mecauto",
        title: "Contrôle injection",
        day: 3,
        schoolWeekNumber: 1,
        annualCourseId: "ac-moteur",
        courseSessionKey: thursday[0]?.key,
        courseSessionDate: "2026-08-20",
      }),
    ],
    catalog: {
      classrooms: [
        { id: "rt-mecauto", name: "MECAUTO3A" },
        { id: "rt-ma3a", name: "MA3A" },
      ],
      subjects: [{ id: "subject-moteur", name: "Moteur" }],
      teachers: [{ id: TEACHER_ID, displayName: "François Martin", initials: "FM" }],
    },
    accessibleClasses: [
      { id: "rt-mecauto", name: "MECAUTO3A" },
      { id: "rt-ma3a", name: "MA3A" },
    ],
    weeks,
    schoolYearId: YEAR_ID,
    schoolYearLabel: "2026-2027",
    years: [{ id: YEAR_ID, label: "2026-2027", status: "active" }],
    classroomId: null,
    classroomIds: ["rt-mecauto", "rt-ma3a"],
    requestedMode: "mine",
    schoolWeekNumber: 1,
    todayIso: "2026-08-17",
    includeUnscopedYearItems: true,
    yearStatus: "active",
    placementOptions: options,
    canCreate: true,
    guidedPlanningReason: null,
    sessions,
    assignments: [tca("a1", "ac-moteur", TEACHER_ID), tca("a2", "ac-chassis", TEACHER_ID)],
    selectedSchoolClassIds: ["sc-mecauto", "sc-ma3a"],
    layout: "semester",
    periodId: "semester-1",
  });
  assert.equal(view.semester?.weeks.length, 2);
  assert.equal(view.semester?.weeks.some((week) => week.number === 2 && week.hasCourse === false), true);
  assert.deepEqual(view.semester?.visibleDayIndexes, [0, 3]);
  const card = view.semester?.weeks[0]?.days.find((day) => day.dayIndex === 3)?.controls[0];
  assert.equal(card?.title, "Contrôle injection");
  assert.equal(card?.annualCourseId, "ac-moteur");
  assert.equal(card?.courseSessionKey, thursday[0]?.key);
  assert.equal(view.week?.days.map((day) => day.weekdayLabel).join(), "Lundi,Jeudi");
});

function thursdayOption(classroomId: string, classroomName: string, annualCourseId: string): ControlPlacementOption {
  return {
    annualCourseId,
    courseSessionKey: `${YEAR_ID}|${annualCourseId}|2026-08-20`,
    date: "2026-08-20",
    schoolWeekNumber: 1,
    dayIndex: 3,
    branchLabel: "Moteur",
    classroomId,
    classroomName,
  };
}

function coordinationFixture(items: PrototypeAgendaItem[], layout: "week" | "semester") {
  const weeks = mondayWeeks("2026-08-17", 2);
  const ma3a = thursdayOption("rt-ma3a", "MA3A", "ac-ma3a");
  const mecauto = thursdayOption("rt-mecauto", "MECAUTO3A", "ac-mecauto");
  return {
    ma3a,
    mecauto,
    view: buildControlPlanningView({
      teacherId: TEACHER_ID,
      items,
      catalog: {
        classrooms: [
          { id: "rt-ma3a", name: "MA3A" },
          { id: "rt-mecauto", name: "MECAUTO3A" },
        ],
        subjects: [{ id: "subject-moteur", name: "Moteur" }],
        teachers: [
          { id: TEACHER_ID, displayName: "François Martin", initials: "FM" },
          { id: OTHER_ID, displayName: "Mme Dupont", initials: "MD" },
        ],
      },
      accessibleClasses: [
        { id: "rt-ma3a", name: "MA3A" },
        { id: "rt-mecauto", name: "MECAUTO3A" },
      ],
      weeks,
      schoolYearId: YEAR_ID,
      schoolYearLabel: "2026-2027",
      years: [{ id: YEAR_ID, label: "2026-2027", status: "active" }],
      classroomId: null,
      classroomIds: ["rt-ma3a", "rt-mecauto"],
      requestedMode: "class-all",
      schoolWeekNumber: 1,
      todayIso: "2026-08-17",
      includeUnscopedYearItems: true,
      yearStatus: "active",
      placementOptions: [ma3a, mecauto],
      canCreate: true,
      guidedPlanningReason: null,
      layout,
      periodId: "semester-1",
    }),
  };
}

function thursdayClassDayControls(view: ReturnType<typeof buildControlPlanningView>, layout: "week" | "semester") {
  if (layout === "week") {
    return view.week?.days.find((day) => day.dayIndex === 3)?.classDayControls ?? [];
  }
  return (
    view.semester?.weeks
      .find((week) => week.number === 1)
      ?.days.find((day) => day.dayIndex === 3)?.classDayControls ?? []
  );
}

function assertTargetCoordination(
  classDayControls: ReturnType<typeof thursdayClassDayControls>,
  option: ControlPlacementOption,
  expectedTitles: string[],
  confirmationRequired: boolean,
) {
  const target = classDayControlsForPlacementOption(classDayControls, option);
  assert.deepEqual(
    target.map((card) => card.title).sort(),
    [...expectedTitles].sort(),
  );
  assert.equal(target.every((card) => card.classroomId === option.classroomId), true);
  assert.equal(confirmationRequiredForPlacementOption(classDayControls, option), confirmationRequired);
}

test("coordination multi-classes — Semestre et Semaine, cible uniquement", () => {
  assert.equal(TEST_ALERT_THRESHOLD, 3);
  const caseA = [
    testItem({ id: 1, classroomId: "rt-ma3a", title: "MA3A-1", day: 3, schoolWeekNumber: 1 }),
    testItem({ id: 2, classroomId: "rt-mecauto", title: "MECAUTO-1", day: 3, schoolWeekNumber: 1 }),
  ];
  const caseB = [
    testItem({ id: 1, classroomId: "rt-ma3a", title: "MA3A-1", day: 3, schoolWeekNumber: 1 }),
    testItem({ id: 2, classroomId: "rt-ma3a", title: "MA3A-2", day: 3, schoolWeekNumber: 1 }),
    testItem({ id: 3, classroomId: "rt-mecauto", title: "MECAUTO-1", day: 3, schoolWeekNumber: 1 }),
  ];
  const caseC = [
    testItem({ id: 1, classroomId: "rt-mecauto", title: "MECAUTO-1", day: 3, schoolWeekNumber: 1 }),
    testItem({ id: 2, classroomId: "rt-mecauto", title: "MECAUTO-2", day: 3, schoolWeekNumber: 1 }),
  ];

  for (const layout of ["week", "semester"] as const) {
    const a = coordinationFixture(caseA, layout);
    const aDay = thursdayClassDayControls(a.view, layout);
    assert.equal(aDay.length, 2, `${layout} CAS A : la cellule visualise les 2 classes`);
    assertTargetCoordination(aDay, a.ma3a, ["MA3A-1"], false);
    assertTargetCoordination(aDay, a.mecauto, ["MECAUTO-1"], false);
    assert.equal(a.view.teacherWeekControls.map((card) => card.title).sort().join(), "MA3A-1,MECAUTO-1");

    const b = coordinationFixture(caseB, layout);
    const bDay = thursdayClassDayControls(b.view, layout);
    assertTargetCoordination(bDay, b.ma3a, ["MA3A-1", "MA3A-2"], true);
    assertTargetCoordination(bDay, b.mecauto, ["MECAUTO-1"], false);
    assert.equal(
      b.view.teacherWeekControls.map((card) => card.classroomId).sort().join(),
      "rt-ma3a,rt-ma3a,rt-mecauto",
    );

    const c = coordinationFixture(caseC, layout);
    const cDay = thursdayClassDayControls(c.view, layout);
    assertTargetCoordination(cDay, c.ma3a, [], false);
    assert.equal(
      classDayControlsForPlacementOption(cDay, c.ma3a).some((card) => card.classroomId === "rt-mecauto"),
      false,
    );
    assertTargetCoordination(cDay, c.mecauto, ["MECAUTO-1", "MECAUTO-2"], true);
    assert.equal(c.view.teacherWeekControls.map((card) => card.title).sort().join(), "MECAUTO-1,MECAUTO-2");
  }
});

test("année change — aucune classroomId précédente dans la sélection résolue", () => {
  const nextYearAssigned = ["rt-new"];
  const resolved = resolveAssignedClassroomSelection({
    requestedIds: [],
    assignedIds: nextYearAssigned,
  });
  assert.equal(resolved.ok, true);
  if (resolved.ok) {
    assert.deepEqual(resolved.selectedIds, ["rt-new"]);
    assert.equal(resolved.selectedIds.includes("rt-ma3a"), false);
  }
});
