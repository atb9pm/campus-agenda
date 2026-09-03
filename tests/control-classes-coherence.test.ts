import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { AnnualCourse, TeacherCourseAssignment } from "../src/features/annual-courses/types.ts";
import {
  getControlPlanning,
  listAssignedStructuredPlanningClassrooms,
  type ControlPlanningServiceDeps,
} from "../src/features/control-planning/index.ts";
import { computeCourseSessions } from "../src/features/course-sessions/index.ts";
import type { CourseScheduleSlot } from "../src/features/course-schedule/types.ts";
import type { PedagogicalContextRecord } from "../src/features/school-catalog/profession-types.ts";
import type { SchoolBranchRecord, SchoolClassRecord } from "../src/features/school-catalog/types.ts";
import type { SchoolYearWithWeeks } from "../src/features/school-year/types.ts";
import {
  assignedSchoolClassIdsFromTeacherCourses,
  buildTeacherCourseWorkspace,
} from "../src/features/teacher-workspace/index.ts";
import { APP_VERSION } from "../src/lib/app-version.ts";
import { SQL_MIGRATION_FILES } from "../src/lib/persistence/sql/migrate.ts";

const TEACHER_ID = "teacher-coherence";
const OTHER_ID = "teacher-other";
const YEAR_ID = "year-2026";
const PREV_YEAR_ID = "year-2025";
const AT = "2026-09-15T12:00:00.000Z";
const TODAY = "2026-09-15";

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

const WEEKS = mondayWeeks("2026-08-17", 8);

function yearRecord(id: string, label: string, status: SchoolYearWithWeeks["status"]): SchoolYearWithWeeks {
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
    weeks: WEEKS,
  };
}

function schoolClass(id: string, code: string, schoolYearId: string): SchoolClassRecord {
  return {
    id,
    code,
    label: code,
    sortOrder: 1,
    isActive: true,
    schoolYearId,
    schoolYearLabel: schoolYearId === YEAR_ID ? "2026-2027" : "2025-2026",
    professionId: "prof-mma",
    trainingYear: 3,
    parallelCode: "A",
    isArchived: false,
    archivedAt: null,
  };
}

function course(id: string, classId: string, contextId: string, schoolYearId = YEAR_ID): AnnualCourse {
  return {
    id,
    schoolYearId,
    classId,
    contextId,
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

const branches: SchoolBranchRecord[] = [
  {
    id: "br-moteur",
    code: "MOT",
    label: "Moteur VL",
    sortOrder: 1,
    isActive: true,
    adminCode: "BR-0001",
    isArchived: false,
    archivedAt: null,
    teachingType: "TECHNICAL",
  },
  {
    id: "br-trans",
    code: "TRA",
    label: "Transmission",
    sortOrder: 2,
    isActive: true,
    adminCode: "BR-0002",
    isArchived: false,
    archivedAt: null,
    teachingType: "TECHNICAL",
  },
];

const contexts: PedagogicalContextRecord[] = [
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
  {
    id: "ctx-trans",
    adminCode: "CTX-0002",
    professionId: "prof-mma",
    trainingYear: 3,
    branchId: "br-trans",
    isActive: true,
    isArchived: false,
    archivedAt: null,
  },
];

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

test("version 2.38.0 — classes Contrôles = Mes cours, pas de migration", async () => {
  assert.equal(APP_VERSION, "2.42.0");
  assert.equal(SQL_MIGRATION_FILES.at(-1), "0024_structured_agenda_bridge.sql");
  const [classroomsSrc, serviceSrc, panel] = await Promise.all([
    readFile(new URL("../src/features/control-planning/classrooms.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/control-planning/service.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/app/components/control-planning-panel.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(classroomsSrc, /buildTeacherCourseWorkspace/);
  assert.match(classroomsSrc, /assignedSchoolClassIdsFromTeacherCourses/);
  assert.match(classroomsSrc, /Les CourseSessions ne sont pas une source d’autorité pour cette liste/);
  assert.doesNotMatch(classroomsSrc, /teacherHasStructuredPublishAccess\(\{[\s\S]*function listAssignedStructuredPlanningClassrooms/);
  assert.match(serviceSrc, /listAssignedStructuredPlanningClassrooms/);
  assert.match(serviceSrc, /at: assignmentAt/);
  assert.match(panel, /Toutes mes classes/);
  assert.match(panel, /view\.classes/);
});

test("3 AnnualCourse / 2 classes — Mes cours et Contrôles alignés", async () => {
  const year = yearRecord(YEAR_ID, "2026-2027", "active");
  const prevYear = yearRecord(PREV_YEAR_ID, "2025-2026", "archived");
  const mecauto = schoolClass("sc-mecauto", "MECAUTO3A", YEAR_ID);
  const mma1a = schoolClass("sc-mma1a", "MMA1A", YEAR_ID);
  const ama2a = schoolClass("sc-ama2a", "AMA2A", YEAR_ID);
  const prevMma1a = schoolClass("sc-mma1a-prev", "MMA1A", PREV_YEAR_ID);
  const acMecauto = course("ac-mecauto-moteur", mecauto.id, "ctx-moteur");
  const acMma1aMoteur = course("ac-mma1a-moteur", mma1a.id, "ctx-moteur");
  const acMma1aTrans = course("ac-mma1a-trans", mma1a.id, "ctx-trans");
  const acAma2a = course("ac-ama2a-moteur", ama2a.id, "ctx-moteur");
  const acPrev = course("ac-mma1a-prev", prevMma1a.id, "ctx-moteur", PREV_YEAR_ID);
  const assignments = [
    tca("a-mecauto", acMecauto.id, TEACHER_ID, "PRIMARY"),
    tca("a-mma1a-moteur", acMma1aMoteur.id, TEACHER_ID, "CO_TEACHER"),
    tca("a-mma1a-trans", acMma1aTrans.id, TEACHER_ID, "PRIMARY"),
    tca("a-ama2a-other", acAma2a.id, OTHER_ID, "PRIMARY"),
    tca("a-prev", acPrev.id, TEACHER_ID, "PRIMARY"),
    tca("a-expired", acAma2a.id, TEACHER_ID, "PRIMARY", "2025-08-01T00:00:00.000Z", "2026-06-30T23:59:59.000Z"),
    tca("a-future", acAma2a.id, TEACHER_ID, "REPLACEMENT", "2027-01-01T00:00:00.000Z", "2027-01-31T23:59:59.000Z"),
  ];
  const courses = [acMecauto, acMma1aMoteur, acMma1aTrans, acAma2a, acPrev];
  const classes = [mecauto, mma1a, ama2a, prevMma1a];
  const rooms = [
    { id: "rt-mecauto", name: "MECAUTO3A", schoolClassId: mecauto.id },
    { id: "rt-mma1a", name: "MMA1A", schoolClassId: mma1a.id },
    { id: "rt-ama2a", name: "AMA2A", schoolClassId: ama2a.id },
    { id: "rt-mma1a-prev", name: "MMA1A", schoolClassId: prevMma1a.id },
    { id: "rt-legacy", name: "PAI" },
  ];
  const slots = [
    slotFor(acMecauto.id, { id: "s-mecauto", dayOfWeek: 1 }),
    slotFor(acMma1aMoteur.id, { id: "s-mma1a-m", dayOfWeek: 2 }),
    slotFor(acMma1aTrans.id, { id: "s-mma1a-t", dayOfWeek: 3 }),
    slotFor(acAma2a.id, { id: "s-ama2a", dayOfWeek: 4 }),
    slotFor(acPrev.id, { id: "s-prev", dayOfWeek: 1 }),
  ];

  const mesCours = buildTeacherCourseWorkspace({
    teacherId: TEACHER_ID,
    schoolYearId: YEAR_ID,
    at: AT,
    assignments,
    courses,
    classes,
    contexts,
    branches,
    years: [year, prevYear],
  });
  assert.equal(mesCours.courses.length, 3);
  assert.deepEqual(
    mesCours.courses.map((entry) => entry.annualCourseId).sort(),
    [acMecauto.id, acMma1aMoteur.id, acMma1aTrans.id].sort(),
  );
  assert.deepEqual(assignedSchoolClassIdsFromTeacherCourses(mesCours.courses).sort(), [mecauto.id, mma1a.id].sort());

  const assigned = listAssignedStructuredPlanningClassrooms({
    teacherId: TEACHER_ID,
    classrooms: rooms,
    classes,
    courses,
    assignments,
    years: [year, prevYear],
    contexts,
    branches,
    schoolYearId: YEAR_ID,
    at: AT,
  });
  assert.deepEqual(assigned.map((entry) => entry.name).sort(), ["MECAUTO3A", "MMA1A"]);
  assert.equal(assigned.some((entry) => entry.name === "AMA2A"), false);
  assert.equal(assigned.some((entry) => entry.name === "PAI"), false);
  assert.equal(assigned.some((entry) => entry.id === "rt-mma1a-prev"), false);

  const sessions = computeCourseSessions({
    schoolYearId: YEAR_ID,
    courses: courses
      .filter((entry) => entry.schoolYearId === YEAR_ID)
      .map((entry) => ({ id: entry.id, classId: entry.classId, contextId: entry.contextId })),
    slots: slots.filter((slot) => slot.annualCourseId !== acPrev.id),
    weeks: WEEKS,
  });
  assert.ok(sessions.some((session) => session.classId === ama2a.id));

  const deps: ControlPlanningServiceDeps = {
    agenda: {
      listAgendaItems: async () => [],
      teacherCanAccessClassroom: async (_teacherId: string, classroomId: string) =>
        classroomId === "rt-legacy" || classroomId === "rt-ama2a",
    },
    adapters: {
      listClassrooms: async () => rooms,
      listSubjects: async () => [
        { id: "subject-moteur", name: "Moteur VL" },
        { id: "subject-trans", name: "Transmission" },
      ],
    },
    catalog: {
      ensureSeeded: async () => undefined,
      listClasses: async () => classes,
      listContexts: async () => contexts,
      listBranches: async () => branches,
    },
    courses: {
      listCourses: async () => courses,
      listAssignments: async () => assignments,
    },
    years: {
      listSchoolYears: async () => [year, prevYear],
      getActiveSchoolYear: async () => year,
      getSchoolYearById: async (id: string) =>
        id === YEAR_ID ? year : id === PREV_YEAR_ID ? prevYear : null,
      listDayExceptions: async () => [],
    },
    teachers: {
      listAccounts: async () => [
        { id: TEACHER_ID, displayName: "François Martin", initials: "FM" },
        { id: OTHER_ID, displayName: "Autre", initials: "AU" },
      ],
    },
    schedules: { listSlots: async () => slots },
  } as unknown as ControlPlanningServiceDeps;

  const planning = await getControlPlanning(deps, {
    teacherId: TEACHER_ID,
    todayIso: TODAY,
    view: "semester",
  });
  assert.equal(planning.ok, true);
  if (!planning.ok) return;
  assert.deepEqual(planning.view.classes.map((entry) => entry.name).sort(), ["MECAUTO3A", "MMA1A"]);
  assert.equal(planning.view.classes.length, 2);
  assert.equal(mesCours.courses.length, 3);
  const placementOptions = (planning.view.semester?.weeks ?? []).flatMap((week) =>
    week.days.flatMap((day) => day.placementOptions),
  );
  assert.ok(placementOptions.length > 0);
  assert.ok(placementOptions.every((option) => option.annualCourseId && option.courseSessionKey));
  assert.equal(placementOptions.some((option) => option.annualCourseId === acAma2a.id), false);

  const forged = await getControlPlanning(deps, {
    teacherId: TEACHER_ID,
    classroomId: "rt-ama2a",
    todayIso: TODAY,
  });
  assert.equal(forged.ok, false);
  if (!forged.ok) assert.equal(forged.status, 403);

  const membershipOnly = await getControlPlanning(deps, {
    teacherId: TEACHER_ID,
    classroomId: "rt-legacy",
    todayIso: TODAY,
  });
  assert.equal(membershipOnly.ok, false);
  if (!membershipOnly.ok) assert.equal(membershipOnly.status, 403);

  const otherYear = await getControlPlanning(deps, {
    teacherId: TEACHER_ID,
    schoolYearId: PREV_YEAR_ID,
    todayIso: TODAY,
  });
  assert.equal(otherYear.ok, true);
  if (otherYear.ok) {
    assert.equal(otherYear.view.classes.some((entry) => entry.id === "rt-mecauto"), false);
    assert.equal(otherYear.view.classes.some((entry) => entry.id === "rt-mma1a"), false);
  }
});

test("rôles PRIMARY / CO_TEACHER / REPLACEMENT selon Mes cours", () => {
  const year = yearRecord(YEAR_ID, "2026-2027", "active");
  const primaryClass = schoolClass("sc-p", "MA3A", YEAR_ID);
  const coClass = schoolClass("sc-c", "MA3A-B", YEAR_ID);
  const repClass = schoolClass("sc-r", "MMA2C", YEAR_ID);
  const expiredClass = schoolClass("sc-e", "MMA3A", YEAR_ID);
  const courses = [
    course("ac-p", primaryClass.id, "ctx-moteur"),
    course("ac-c", coClass.id, "ctx-moteur"),
    course("ac-r", repClass.id, "ctx-moteur"),
    course("ac-e", expiredClass.id, "ctx-moteur"),
  ];
  const assignments = [
    tca("a-p", "ac-p", TEACHER_ID, "PRIMARY"),
    tca("a-c", "ac-c", TEACHER_ID, "CO_TEACHER"),
    tca("a-r", "ac-r", TEACHER_ID, "REPLACEMENT", "2026-09-01T00:00:00.000Z", "2026-09-30T23:59:59.000Z"),
    tca("a-e", "ac-e", TEACHER_ID, "PRIMARY", "2025-08-01T00:00:00.000Z", "2026-06-01T00:00:00.000Z"),
  ];
  const rooms = [
    { id: "rt-p", name: "MA3A", schoolClassId: primaryClass.id },
    { id: "rt-c", name: "MA3A-B", schoolClassId: coClass.id },
    { id: "rt-r", name: "MMA2C", schoolClassId: repClass.id },
    { id: "rt-e", name: "MMA3A", schoolClassId: expiredClass.id },
  ];
  const assigned = listAssignedStructuredPlanningClassrooms({
    teacherId: TEACHER_ID,
    classrooms: rooms,
    classes: [primaryClass, coClass, repClass, expiredClass],
    courses,
    assignments,
    years: [year],
    contexts,
    branches,
    schoolYearId: YEAR_ID,
    at: AT,
  });
  assert.deepEqual(assigned.map((entry) => entry.name).sort(), ["MA3A", "MA3A-B", "MMA2C"]);
  assert.equal(assigned.some((entry) => entry.name === "MMA3A"), false);
});

test("non-régression PR61–PR65 — APIs dédiées et planning multi-classes", async () => {
  const [createRoute, moveRoute, itemRoute, panel, semester] = await Promise.all([
    readFile(new URL("../web/app/api/teacher/controls/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/app/api/teacher/controls/[agendaItemId]/move/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/app/api/teacher/controls/[agendaItemId]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/app/components/control-planning-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/control-planning/service.ts", import.meta.url), "utf8"),
  ]);
  assert.match(createRoute, /publishManualControlToAgenda/);
  assert.match(moveRoute, /moveStructuredControlToCourseSession/);
  assert.match(itemRoute, /updateStructuredControlContent/);
  assert.match(itemRoute, /deleteStructuredControl/);
  assert.match(panel, /createTeacherControlApi/);
  assert.match(panel, /moveTeacherControlApi/);
  assert.match(panel, /updateTeacherControlApi/);
  assert.match(panel, /deleteTeacherControlApi/);
  assert.match(panel, /toggleControlPlanningClassroomSelection/);
  assert.match(semester, /resolveAssignedClassroomSelection/);
  assert.match(semester, /listControlPlacementOptions/);
});
