import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { AnnualCourse, TeacherCourseAssignment } from "../src/features/annual-courses/types.ts";
import { runtimeClassroomIdForSchoolClass } from "../src/features/agenda-bridge/ids.ts";
import {
  getControlPlanning,
  listAssignedStructuredPlanningClassrooms,
  listControlPlanningFilterSubjects,
  resolveControlPlanningAssignmentAt,
  resolveControlPlanningSubjectFilter,
  type ControlPlanningServiceDeps,
} from "../src/features/control-planning/index.ts";
import type { PedagogicalContextRecord } from "../src/features/school-catalog/profession-types.ts";
import type { SchoolBranchRecord, SchoolClassRecord } from "../src/features/school-catalog/types.ts";
import type { SchoolYearWithWeeks } from "../src/features/school-year/types.ts";
import { assignedSchoolClassIdsFromTeacherCourses, buildTeacherCourseWorkspace } from "../src/features/teacher-workspace/index.ts";
import { APP_VERSION } from "../src/lib/app-version.ts";
import { SQL_MIGRATION_FILES } from "../src/lib/persistence/sql/migrate.ts";

const FRANCOIS = "teacher-francois";
const PATRICK = "teacher-patrick";
const ACTIVE_ID = "year-2026";
const DRAFT_ID = "year-2028";
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

function schoolClass(id: string, code: string, schoolYearId: string, schoolYearLabel: string): SchoolClassRecord {
  return {
    id,
    code,
    label: code,
    sortOrder: 1,
    isActive: true,
    schoolYearId,
    schoolYearLabel,
    professionId: "prof-mecauto",
    trainingYear: 3,
    parallelCode: code.endsWith("B") ? "B" : "A",
    isArchived: false,
    archivedAt: null,
  };
}

function course(id: string, classId: string, contextId: string, schoolYearId: string): AnnualCourse {
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
): TeacherCourseAssignment {
  return {
    id,
    annualCourseId,
    teacherId,
    role,
    validFrom,
    validTo: null,
    createdByAdminId: "admin-1",
    createdAt: validFrom,
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
  {
    id: "br-electro",
    code: "ELE",
    label: "Electrotechnique",
    sortOrder: 3,
    isActive: true,
    adminCode: "BR-0003",
    isArchived: false,
    archivedAt: null,
    teachingType: "TECHNICAL",
  },
];

const contexts: PedagogicalContextRecord[] = [
  {
    id: "ctx-moteur",
    adminCode: "CTX-0001",
    professionId: "prof-mecauto",
    trainingYear: 3,
    branchId: "br-moteur",
    isActive: true,
    isArchived: false,
    archivedAt: null,
  },
  {
    id: "ctx-trans",
    adminCode: "CTX-0002",
    professionId: "prof-mecauto",
    trainingYear: 3,
    branchId: "br-trans",
    isActive: true,
    isArchived: false,
    archivedAt: null,
  },
  {
    id: "ctx-electro",
    adminCode: "CTX-0003",
    professionId: "prof-mecauto",
    trainingYear: 3,
    branchId: "br-electro",
    isActive: true,
    isArchived: false,
    archivedAt: null,
  },
];

const active = yearRecord(ACTIVE_ID, "2026-2027", "active");
const draft = yearRecord(DRAFT_ID, "2028-2029", "draft");
const mecauto3a = schoolClass("sc-mecauto3a", "MECAUTO3A", ACTIVE_ID, "2026-2027");
const mecauto3b = schoolClass("sc-mecauto3b", "MECAUTO3B", ACTIVE_ID, "2026-2027");
const draftClass = schoolClass("sc-mecauto-draft", "MECAUTO3A", DRAFT_ID, "2028-2029");

const ac3aMoteur = course("ac-3a-moteur", mecauto3a.id, "ctx-moteur", ACTIVE_ID);
const ac3aTrans = course("ac-3a-trans", mecauto3a.id, "ctx-trans", ACTIVE_ID);
const ac3bMoteur = course("ac-3b-moteur", mecauto3b.id, "ctx-moteur", ACTIVE_ID);
const ac3bElectro = course("ac-3b-electro", mecauto3b.id, "ctx-electro", ACTIVE_ID);
const acDraft = course("ac-draft-moteur", draftClass.id, "ctx-moteur", DRAFT_ID);

const assignments: TeacherCourseAssignment[] = [
  tca("a-3a-moteur", ac3aMoteur.id, FRANCOIS, "PRIMARY"),
  tca("a-3a-trans-patrick", ac3aTrans.id, PATRICK, "PRIMARY"),
  tca("a-3b-moteur", ac3bMoteur.id, FRANCOIS, "PRIMARY"),
  tca("a-3b-electro", ac3bElectro.id, PATRICK, "PRIMARY"),
  tca("a-draft", acDraft.id, FRANCOIS, "PRIMARY"),
];

const courses = [ac3aMoteur, ac3aTrans, ac3bMoteur, ac3bElectro, acDraft];
const classes = [mecauto3a, mecauto3b, draftClass];

/** MECAUTO3B n’a volontairement pas de classroom runtime — bug observé en production. */
const rooms = [{ id: "rt-mecauto3a", name: "MECAUTO3A", schoolClassId: mecauto3a.id }];

function planningDeps(
  items: Array<Record<string, unknown>> = [],
  assignmentList: TeacherCourseAssignment[] = assignments,
): ControlPlanningServiceDeps {
  return {
    agenda: {
      listAgendaItems: async (classroomId: string) => items.filter((item) => item.classroomId === classroomId),
    },
    adapters: {
      listClassrooms: async () => rooms,
      listSubjects: async () => [
        { id: "subject-global-maths", name: "Mathématiques" },
        { id: "subject-global-fr", name: "Français" },
        { id: "subject-moteur", name: "Moteur VL" },
      ],
    },
    catalog: {
      ensureSeeded: async () => undefined,
      seedDefaultCatalogIfEmpty: async () => undefined,
      listClasses: async () => classes,
      listContexts: async () => contexts,
      listBranches: async () => branches,
    },
    courses: {
      listCourses: async () => courses,
      listAssignments: async () => assignmentList,
    },
    years: {
      listSchoolYears: async () => [active, draft],
      getActiveSchoolYear: async () => active,
      getSchoolYearById: async (id: string) =>
        id === ACTIVE_ID ? active : id === DRAFT_ID ? draft : null,
      listDayExceptions: async () => [],
    },
    teachers: {
      listAccounts: async () => [
        { id: FRANCOIS, displayName: "François Martin", initials: "FM" },
        { id: PATRICK, displayName: "Patrick Favre", initials: "PF" },
      ],
    },
    schedules: { listSlots: async () => [] },
  } as unknown as ControlPlanningServiceDeps;
}

function assignedForFrancois() {
  return listAssignedStructuredPlanningClassrooms({
    teacherId: FRANCOIS,
    classrooms: rooms,
    classes,
    courses,
    assignments,
    years: [active, draft],
    contexts,
    branches,
    schoolYearId: ACTIVE_ID,
    at: AT,
  });
}

test("version 2.52.1 — affectations à maintenant et matières du professeur, sans migration", async () => {
  assert.equal(APP_VERSION, "2.53.1");
  assert.equal(SQL_MIGRATION_FILES.at(-1), "0029_admin_mfa.sql");
  const [classroomsSrc, serviceSrc, panel, filterSrc, route] = await Promise.all([
    readFile(new URL("../src/features/control-planning/classrooms.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/control-planning/service.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/app/components/control-planning-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/control-planning/filter-subjects.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/app/api/teacher/controls/planning/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(classroomsSrc, /seenSchoolClassIds/);
  assert.match(classroomsSrc, /runtimeClassroomIdForSchoolClass/);
  assert.match(classroomsSrc, /schoolClassId: schoolClass\.id/);
  assert.doesNotMatch(classroomsSrc, /if \(!classroom \|\| seen\.has\(classroom\.id\)\) continue/);
  assert.match(serviceSrc, /listControlPlanningFilterSubjects/);
  assert.match(serviceSrc, /resolveControlPlanningAssignmentAt/);
  assert.match(serviceSrc, /at: assignmentAt/);
  assert.doesNotMatch(serviceSrc, /\$\{todayIso\}T12:00:00\.000Z/);
  assert.match(serviceSrc, /entry\.schoolClassId/);
  assert.match(filterSrc, /isAssignmentActiveAt/);
  assert.match(filterSrc, /assignment\.teacherId !== options\.teacherId/);
  assert.match(filterSrc, /info\.branch\.id/);
  assert.match(panel, /view\?\.filterSubjects/);
  assert.match(panel, /resolveControlPlanningSubjectFilter/);
  assert.match(panel, /Toutes les matières/);
  assert.doesNotMatch(route, /searchParams\.get\("at"\)/);
});

test("François ACTIVE — MECAUTO3A et MECAUTO3B même sans classroom runtime 3B", async () => {
  const mesCours = buildTeacherCourseWorkspace({
    teacherId: FRANCOIS,
    schoolYearId: ACTIVE_ID,
    at: AT,
    assignments,
    courses,
    classes,
    contexts,
    branches,
    years: [active, draft],
  });
  assert.deepEqual(
    assignedSchoolClassIdsFromTeacherCourses(mesCours.courses).sort(),
    [mecauto3a.id, mecauto3b.id].sort(),
  );

  const assigned = assignedForFrancois();
  assert.deepEqual(assigned.map((entry) => entry.name).sort(), ["MECAUTO3A", "MECAUTO3B"]);
  assert.equal(assigned.length, 2);
  assert.deepEqual(
    assigned.map((entry) => entry.schoolClassId).sort(),
    [mecauto3a.id, mecauto3b.id].sort(),
  );
  const class3b = assigned.find((entry) => entry.schoolClassId === mecauto3b.id);
  assert.equal(class3b?.id, runtimeClassroomIdForSchoolClass(mecauto3b.id));

  const planning = await getControlPlanning(planningDeps(), {
    teacherId: FRANCOIS,
    todayIso: TODAY,
    at: AT,
    view: "semester",
  });
  assert.equal(planning.ok, true);
  if (!planning.ok) return;
  assert.deepEqual(planning.view.classes.map((entry) => entry.name).sort(), ["MECAUTO3A", "MECAUTO3B"]);
  assert.equal(planning.view.allClassesSelected, true);
});

test("plusieurs affectations dans MECAUTO3A — une seule entrée, SchoolClass.id", () => {
  const assigned = assignedForFrancois();
  const matches = assigned.filter((entry) => entry.schoolClassId === mecauto3a.id);
  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.name, "MECAUTO3A");
});

test("matières = branches attribuées au professeur, pas celles des collègues", async () => {
  const deps = planningDeps();
  const class3a = assignedForFrancois().find((entry) => entry.schoolClassId === mecauto3a.id)!;
  const class3b = assignedForFrancois().find((entry) => entry.schoolClassId === mecauto3b.id)!;

  const all = await getControlPlanning(deps, { teacherId: FRANCOIS, todayIso: TODAY, at: AT });
  const only3a = await getControlPlanning(deps, {
    teacherId: FRANCOIS,
    classroomId: class3a.id,
    todayIso: TODAY,
    at: AT,
  });
  const only3b = await getControlPlanning(deps, {
    teacherId: FRANCOIS,
    classroomId: class3b.id,
    todayIso: TODAY,
    at: AT,
  });
  assert.equal(all.ok && only3a.ok && only3b.ok, true);
  if (!all.ok || !only3a.ok || !only3b.ok) return;

  assert.deepEqual(only3a.view.filterSubjects.map((entry) => entry.label), ["Moteur VL"]);
  assert.deepEqual(only3b.view.filterSubjects.map((entry) => entry.label), ["Moteur VL"]);
  assert.deepEqual(all.view.filterSubjects.map((entry) => entry.label), ["Moteur VL"]);
  assert.equal(all.view.filterSubjects.some((entry) => entry.label === "Transmission"), false);
  assert.equal(all.view.filterSubjects.some((entry) => entry.label === "Electrotechnique"), false);
  assert.equal(
    all.view.filterSubjects.some((entry) => entry.label === "Mathématiques" || entry.label === "Français"),
    false,
  );
  assert.deepEqual(only3a.view.filterSubjects.map((entry) => entry.id), ["br-moteur"]);
});

test("Toutes mes classes — union des matières du professeur, sans doublon", async () => {
  const unionAssignments = [
    ...assignments,
    tca("a-3b-electro-francois", ac3bElectro.id, FRANCOIS, "CO_TEACHER"),
  ];
  const deps = planningDeps([], unionAssignments);
  const class3a = assignedForFrancois().find((entry) => entry.schoolClassId === mecauto3a.id)!;
  const class3b = assignedForFrancois().find((entry) => entry.schoolClassId === mecauto3b.id)!;

  const only3a = await getControlPlanning(deps, {
    teacherId: FRANCOIS,
    classroomId: class3a.id,
    todayIso: TODAY,
    at: AT,
  });
  const only3b = await getControlPlanning(deps, {
    teacherId: FRANCOIS,
    classroomId: class3b.id,
    todayIso: TODAY,
    at: AT,
  });
  const all = await getControlPlanning(deps, { teacherId: FRANCOIS, todayIso: TODAY, at: AT });
  assert.equal(only3a.ok && only3b.ok && all.ok, true);
  if (!only3a.ok || !only3b.ok || !all.ok) return;

  assert.deepEqual(only3a.view.filterSubjects.map((entry) => entry.label), ["Moteur VL"]);
  assert.deepEqual(only3b.view.filterSubjects.map((entry) => entry.label), ["Moteur VL", "Electrotechnique"]);
  assert.deepEqual(all.view.filterSubjects.map((entry) => entry.label), ["Moteur VL", "Electrotechnique"]);
  assert.equal(all.view.filterSubjects.filter((entry) => entry.id === "br-moteur").length, 1);
  assert.equal(all.view.filterSubjects.some((entry) => entry.label === "Transmission"), false);
});

test("matière invalide après changement de classe → Toutes les matières", () => {
  const unionAssignments = [
    ...assignments,
    tca("a-3b-electro-francois", ac3bElectro.id, FRANCOIS, "CO_TEACHER"),
  ];
  const subjectOptions = {
    teacherId: FRANCOIS,
    courses,
    assignments: unionAssignments,
    contexts,
    branches,
    at: AT,
  };
  const subjects3a = listControlPlanningFilterSubjects({
    ...subjectOptions,
    schoolClassIds: [mecauto3a.id],
  });
  const subjects3b = listControlPlanningFilterSubjects({
    ...subjectOptions,
    schoolClassIds: [mecauto3b.id],
  });
  const subjectsAll = listControlPlanningFilterSubjects({
    ...subjectOptions,
    schoolClassIds: [mecauto3a.id, mecauto3b.id],
  });
  assert.equal(resolveControlPlanningSubjectFilter("br-moteur", subjects3a), "br-moteur");
  assert.equal(resolveControlPlanningSubjectFilter("br-electro", subjects3a), null);
  assert.equal(resolveControlPlanningSubjectFilter("br-electro", subjects3b), "br-electro");
  assert.equal(resolveControlPlanningSubjectFilter("br-electro", subjectsAll), "br-electro");
  assert.equal(resolveControlPlanningSubjectFilter("br-trans", subjectsAll), null);
  assert.equal(resolveControlPlanningSubjectFilter("", subjects3b), null);
});

test("portée Mes contrôles / Tous — matières inchangées, contrôles filtrés", async () => {
  const class3a = assignedForFrancois().find((entry) => entry.schoolClassId === mecauto3a.id)!;
  const items = [
    {
      id: 11,
      classroomId: class3a.id,
      subjectId: "subject-moteur",
      authorTeacherId: FRANCOIS,
      day: 0,
      hour: 8,
      weekOffset: 0,
      schoolWeekNumber: 1,
      type: "TEST",
      title: "Contrôle Moteur VL",
      detail: "",
      schoolYearId: ACTIVE_ID,
      annualCourseId: ac3aMoteur.id,
    },
    {
      id: 12,
      classroomId: class3a.id,
      subjectId: "subject-trans",
      authorTeacherId: PATRICK,
      day: 1,
      hour: 8,
      weekOffset: 0,
      schoolWeekNumber: 1,
      type: "TEST",
      title: "Contrôle Transmission",
      detail: "",
      schoolYearId: ACTIVE_ID,
      annualCourseId: ac3aTrans.id,
    },
  ];
  const deps = planningDeps(items);
  const mine = await getControlPlanning(deps, {
    teacherId: FRANCOIS,
    classroomId: class3a.id,
    mode: "mine",
    todayIso: TODAY,
    at: AT,
    week: 1,
    view: "week",
  });
  const allClass = await getControlPlanning(deps, {
    teacherId: FRANCOIS,
    classroomId: class3a.id,
    mode: "class-all",
    todayIso: TODAY,
    at: AT,
    week: 1,
    view: "week",
  });
  assert.equal(mine.ok && allClass.ok, true);
  if (!mine.ok || !allClass.ok) return;
  assert.deepEqual(
    mine.view.filterSubjects.map((entry) => entry.id),
    allClass.view.filterSubjects.map((entry) => entry.id),
  );
  assert.deepEqual(mine.view.filterSubjects.map((entry) => entry.label), ["Moteur VL"]);
  assert.equal(mine.view.filterSubjects.some((entry) => entry.label === "Transmission"), false);
  const mineTitles = (mine.view.week?.days ?? []).flatMap((day) => day.controls.map((card) => card.title));
  const allTitles = (allClass.view.week?.days ?? []).flatMap((day) => day.controls.map((card) => card.title));
  assert.deepEqual(mineTitles, ["Contrôle Moteur VL"]);
  assert.deepEqual(allTitles.sort(), ["Contrôle Moteur VL", "Contrôle Transmission"]);
});

test("année DRAFT 2028-2029 invisible dans Contrôles enseignant", async () => {
  const assignedDraft = listAssignedStructuredPlanningClassrooms({
    teacherId: FRANCOIS,
    classrooms: rooms,
    classes,
    courses,
    assignments,
    years: [active, draft],
    contexts,
    branches,
    schoolYearId: DRAFT_ID,
    at: AT,
  });
  assert.deepEqual(assignedDraft.map((entry) => entry.schoolClassId), [draftClass.id]);

  const planning = await getControlPlanning(planningDeps(), {
    teacherId: FRANCOIS,
    todayIso: TODAY,
    at: AT,
  });
  assert.equal(planning.ok, true);
  if (!planning.ok) return;
  assert.equal(planning.view.schoolYearId, ACTIVE_ID);
  assert.equal(planning.view.classes.some((entry) => entry.schoolClassId === draftClass.id), false);
  assert.equal(planning.view.years.some((year) => year.id === DRAFT_ID), false);
  assert.ok(planning.view.years.every((year) => year.status === "active" || year.status === "archived"));

  const requestedDraft = await getControlPlanning(planningDeps(), {
    teacherId: FRANCOIS,
    schoolYearId: DRAFT_ID,
    todayIso: TODAY,
    at: AT,
  });
  assert.equal(requestedDraft.ok, false);
  if (!requestedDraft.ok) assert.equal(requestedDraft.status, 404);
});

test("attribution du jour même après 12:00 UTC — MECAUTO3A et MECAUTO3B visibles à 18:30Z", async () => {
  const sameDayAssignments = [
    tca("a-3a-old", ac3aMoteur.id, FRANCOIS, "PRIMARY", "2026-08-01T00:00:00.000Z"),
    tca("a-3b-1800", ac3bMoteur.id, FRANCOIS, "PRIMARY", "2026-09-11T18:00:00.000Z"),
    tca("a-3a-trans-patrick", ac3aTrans.id, PATRICK, "PRIMARY"),
  ];
  const now = "2026-09-11T18:30:00.000Z";
  const noon = "2026-09-11T12:00:00.000Z";

  const atNoon = listAssignedStructuredPlanningClassrooms({
    teacherId: FRANCOIS,
    classrooms: rooms,
    classes,
    courses,
    assignments: sameDayAssignments,
    years: [active, draft],
    contexts,
    branches,
    schoolYearId: ACTIVE_ID,
    at: noon,
  });
  assert.deepEqual(atNoon.map((entry) => entry.name), ["MECAUTO3A"]);

  const planning = await getControlPlanning(planningDeps([], sameDayAssignments), {
    teacherId: FRANCOIS,
    todayIso: "2026-09-11",
    at: now,
  });
  assert.equal(planning.ok, true);
  if (!planning.ok) return;
  assert.deepEqual(planning.view.classes.map((entry) => entry.name).sort(), ["MECAUTO3A", "MECAUTO3B"]);
  assert.deepEqual(planning.view.filterSubjects.map((entry) => entry.label), ["Moteur VL"]);
});

test("attribution prévue à 21:00Z — encore invisible à 18:30Z", async () => {
  const futureAssignments = [
    tca("a-3a-old", ac3aMoteur.id, FRANCOIS, "PRIMARY", "2026-08-01T00:00:00.000Z"),
    tca("a-3b-2100", ac3bMoteur.id, FRANCOIS, "PRIMARY", "2026-09-11T21:00:00.000Z"),
  ];
  const planning = await getControlPlanning(planningDeps([], futureAssignments), {
    teacherId: FRANCOIS,
    todayIso: "2026-09-11",
    at: "2026-09-11T18:30:00.000Z",
  });
  assert.equal(planning.ok, true);
  if (!planning.ok) return;
  assert.deepEqual(planning.view.classes.map((entry) => entry.name), ["MECAUTO3A"]);
  assert.equal(planning.view.classes.some((entry) => entry.name === "MECAUTO3B"), false);
});

test("resolveControlPlanningAssignmentAt — instant injecté ou horloge réelle, jamais midi UTC du jour", () => {
  assert.equal(resolveControlPlanningAssignmentAt("2026-09-11T18:30:00.000Z"), "2026-09-11T18:30:00.000Z");
  const now = resolveControlPlanningAssignmentAt();
  assert.match(now, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});
