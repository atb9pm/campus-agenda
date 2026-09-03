import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { teacherHasStructuredClassroomReadAccess } from "../src/features/agenda-bridge/access.ts";
import { DEMO_PROTOTYPE_ITEMS, type PrototypeAgendaItem } from "../src/features/agenda/demo-items.ts";
import { isAssignmentActiveAt } from "../src/features/annual-courses/assignments.ts";
import { SCHOOL_WEEK_MONDAYS } from "../src/features/calendar/school-week-dates.ts";
import { DEMO_CATALOG, TEACHER_DEMO_ID } from "../src/features/classes/index.ts";
import { getMembershipsForTeacher } from "../src/features/classes/queries.ts";
import {
  buildControlPlanningView,
  countOwnControlsForWeek,
  formatControlPlanningYearLabel,
  formatControlTeacherName,
  getControlPlanning,
  isControlAgendaItem,
  listAccessibleControlPlanningClassrooms,
  listAccessibleRuntimeClassroomsForTeacher,
  listConsultablePlanningYears,
  listControlPlacementOptions,
  listVisibleControlPlanningDayIndexes,
  emptyControlPlanningWeekMessage,
  teacherHasControlPlanningClassAccess,
  resolveControlPlanningMode,
  selectControlItems,
  type BuildControlPlanningInput,
  type ControlPlanningServiceDeps,
} from "../src/features/control-planning/index.ts";
import { computeCourseSessions } from "../src/features/course-sessions/index.ts";
import type { CourseSession } from "../src/features/course-sessions/types.ts";
import type { CourseScheduleSlot } from "../src/features/course-schedule/types.ts";
import { TEST_ALERT_THRESHOLD } from "../src/features/evaluations/index.ts";
import { valaisHolidaysForSchoolYear } from "../src/features/school-days/holidays-valais.ts";
import { TEACHER_NAV_LABELS, TEACHER_NAV_SECTIONS } from "../src/features/teacher/index.ts";
import { APP_VERSION } from "../src/lib/app-version.ts";
import { SQL_MIGRATION_FILES } from "../src/lib/persistence/sql/migrate.ts";
import type { PedagogicalContextRecord } from "../src/features/school-catalog/profession-types.ts";
import type { SchoolBranchRecord, SchoolClassRecord } from "../src/features/school-catalog/types.ts";
import type { AnnualCourse, TeacherCourseAssignment } from "../src/features/annual-courses/types.ts";
import type { SchoolYearRecord, SchoolYearWithWeeks } from "../src/features/school-year/types.ts";

const TEACHER_ID = TEACHER_DEMO_ID;
const CLASS_2A = "classe-demo-tma-2a";
const CLASS_1A = "classe-demo-tma-1a";
const YEAR_ID = "year-2026";
const WEEK_12 = 12;

const WEEKS = SCHOOL_WEEK_MONDAYS.map((entry) => ({
  number: entry.number,
  kind: entry.kind,
  monday: entry.monday,
}));

function cardsFromView(view: { week: { days: Array<{ controls: Array<{ title: string; classroomName: string; teacherId: string; isOwn: boolean }> }> } | null }) {
  return view.week?.days.flatMap((day) => day.controls) ?? [];
}

function planningInput(
  overrides: Partial<BuildControlPlanningInput> = {},
): BuildControlPlanningInput {
  return {
    teacherId: TEACHER_ID,
    items: DEMO_PROTOTYPE_ITEMS,
    catalog: {
      classrooms: DEMO_CATALOG.classrooms.map((entry) => ({ id: entry.id, name: entry.name })),
      subjects: DEMO_CATALOG.subjects.map((entry) => ({ id: entry.id, name: entry.name })),
      teachers: DEMO_CATALOG.teachers.map((entry) => ({
        id: entry.id,
        displayName: entry.displayName,
        initials: entry.initials,
      })),
    },
    accessibleClasses: [
      { id: CLASS_2A, name: "2e TMA" },
      { id: CLASS_1A, name: "1re TMA" },
    ],
    weeks: WEEKS,
    schoolYearId: YEAR_ID,
    schoolYearLabel: "2026-2027",
    years: [{ id: YEAR_ID, label: "2026-2027", status: "active" }],
    classroomId: null,
    requestedMode: "mine",
    schoolWeekNumber: WEEK_12,
    todayIso: "2026-11-18",
    includeUnscopedYearItems: true,
    yearStatus: "active",
    placementOptions: [],
    canCreate: false,
    guidedPlanningReason: null,
    ...overrides,
  };
}

function activeYear(): SchoolYearWithWeeks {
  return {
    id: YEAR_ID,
    label: "2026-2027",
    status: "active",
    startsOn: "2026-08-17",
    endsOn: "2027-07-02",
    sourceFilename: "seed",
    importedAt: "2026-08-01T00:00:00.000Z",
    activatedAt: "2026-08-01T00:00:00.000Z",
    createdAt: "2026-08-01T00:00:00.000Z",
    weeks: WEEKS,
  };
}

function planningDeps(items: PrototypeAgendaItem[] = DEMO_PROTOTYPE_ITEMS): ControlPlanningServiceDeps {
  const year = activeYear();
  return {
    agenda: {
      listAgendaItems: async (classroomId: string) => items.filter((item) => item.classroomId === classroomId),
      teacherCanAccessClassroom: async (teacherId: string, classroomId: string) =>
        getMembershipsForTeacher(DEMO_CATALOG, teacherId).some((membership) => membership.classroomId === classroomId),
    },
    adapters: {
      listClassrooms: async () => DEMO_CATALOG.classrooms,
      listSubjects: async () => DEMO_CATALOG.subjects,
    },
    catalog: {
      ensureSeeded: async () => undefined,
      listClasses: async () => [],
      listContexts: async () => [],
      listBranches: async () => [],
    },
    courses: {
      listCourses: async () => [],
      listAssignments: async () => [],
    },
    years: {
      listSchoolYears: async () => [year],
      getActiveSchoolYear: async () => year,
      getSchoolYearById: async (id: string) => (id === year.id ? year : null),
    },
    teachers: {
      listAccounts: async () =>
        DEMO_CATALOG.teachers.map((teacher) => ({
          id: teacher.id,
          displayName: teacher.displayName,
          initials: teacher.initials,
        })),
    },
  } as unknown as ControlPlanningServiceDeps;
}

test("version 2.37.0 — planning semestriel, sans table dédiée", () => {
  assert.equal(APP_VERSION, "2.37.0");
  assert.equal(TEACHER_NAV_LABELS.controles, "Contrôles");
  assert.deepEqual([...TEACHER_NAV_SECTIONS], [
    "mes-cours",
    "controles",
    "ma-semaine",
    "configuration",
    "administration",
  ]);
  assert.equal(formatControlPlanningYearLabel("2026-2027"), "2026–2027");
  assert.equal(formatControlTeacherName("François Martin", "FM"), "F. Martin");
  assert.equal(SQL_MIGRATION_FILES.at(-1), "0024_structured_agenda_bridge.sql");
  assert.equal(SQL_MIGRATION_FILES.some((file) => file.startsWith("0025")), false);
  assert.equal(TEST_ALERT_THRESHOLD, 3);
});

test("projection — seules les publications TEST remontent", () => {
  assert.equal(isControlAgendaItem({ type: "TEST" }), true);
  assert.equal(isControlAgendaItem({ type: "HOMEWORK" }), false);
  assert.equal(isControlAgendaItem({ type: "INFORMATION" }), false);

  const selected = selectControlItems({
    items: DEMO_PROTOTYPE_ITEMS,
    teacherId: TEACHER_ID,
    accessibleClassroomIds: [CLASS_2A, CLASS_1A],
    classroomId: null,
    mode: "mine",
    schoolYearId: YEAR_ID,
    includeUnscopedYearItems: true,
  });
  assert.ok(selected.length > 0);
  assert.ok(selected.every((item) => item.type === "TEST"));
  assert.equal(selected.some((item) => item.title === "Système de freinage"), false);
  assert.equal(selected.some((item) => item.title === "Dossier technique"), false);
});

test("projection — Toutes mes classes n’affiche que les contrôles du professeur", () => {
  assert.equal(resolveControlPlanningMode(null, "class-all"), "mine");
  assert.equal(resolveControlPlanningMode(null, "class-all", 0), "mine");
  assert.equal(resolveControlPlanningMode("c-ma3a", "class-all", 2), "class-all");

  const view = buildControlPlanningView(planningInput({ classroomId: null, requestedMode: "mine" }));
  assert.equal(view.mode, "mine");
  assert.equal(view.classroomId, null);
  assert.equal(view.allClassesSelected, true);
  const cards = cardsFromView(view);
  assert.deepEqual(
    cards.map((card) => card.title).sort(),
    ["Géométrie des trains", "Injection électronique"],
  );
  assert.ok(cards.every((card) => card.teacherId === TEACHER_ID && card.isOwn));
  assert.equal(cards.some((card) => card.title === "Freinage et adhérence"), false);
});

test("projection — le filtre par classe ne garde que cette classe", () => {
  const view = buildControlPlanningView(
    planningInput({ classroomId: CLASS_2A, requestedMode: "mine" }),
  );
  const cards = cardsFromView(view);
  assert.equal(cards.length, 1);
  assert.equal(cards[0]?.title, "Injection électronique");
  assert.equal(cards[0]?.classroomName, "2e TMA");
  assert.equal(cards.some((card) => card.title === "Géométrie des trains"), false);
});

test("projection — Tous les contrôles de la classe inclut les collègues", () => {
  const view = buildControlPlanningView(
    planningInput({ classroomId: CLASS_2A, requestedMode: "class-all" }),
  );
  assert.equal(view.mode, "class-all");
  const cards = cardsFromView(view);
  const titles = cards.map((card) => card.title).sort();
  assert.deepEqual(titles, ["Calculs de couples", "Freinage et adhérence", "Injection électronique"]);
  assert.ok(cards.some((card) => card.teacherId === TEACHER_ID && card.isOwn));
  assert.ok(cards.some((card) => card.teacherId === "teacher-demo-dupont" && !card.isOwn));
  assert.ok(cards.some((card) => card.teacherId === "teacher-demo-martin" && !card.isOwn));
  assert.equal(cards.some((card) => card.title === "Géométrie des trains"), false);
});

test("projection — la classe apparaît sur chaque carte, jours sans CourseSession absents, pas d’heure", () => {
  const view = buildControlPlanningView(planningInput());
  assert.ok(view.week);
  assert.deepEqual(
    view.week!.days.map((day) => day.weekdayLabel),
    ["Jeudi"],
  );

  const thursday = view.week!.days.find((day) => day.dayIndex === 3);
  assert.ok(thursday);
  assert.ok(thursday!.controls.length >= 1);
  for (const card of cardsFromView(view)) {
    assert.ok(card.classroomName.trim());
    assert.equal("hour" in card, false);
    assert.equal("hour" in card ? (card as { hour?: unknown }).hour : undefined, undefined);
  }

  assert.equal(view.week!.days.some((day) => day.weekdayLabel === "Vendredi"), false);
  assert.equal(view.alerts.some((alert) => /Vendredi/.test(alert.message)), false);
  assert.ok(view.alerts.some((alert) => alert.kind === "teacher-load"));
});

test("service — planning prêt pour la vue, erreurs de filtre", async () => {
  const mine = await getControlPlanning(planningDeps(), {
    teacherId: TEACHER_ID,
    mode: "mine",
    week: WEEK_12,
    todayIso: "2026-11-18",
  });
  assert.equal(mine.ok, true);
  if (!mine.ok) return;
  assert.equal(mine.view.mode, "mine");
  assert.deepEqual(mine.view.classes, []);
  assert.deepEqual(mine.view.classroomIds, []);
  assert.equal(mine.view.layout, "semester");

  const filtered = await getControlPlanning(planningDeps(), {
    teacherId: TEACHER_ID,
    classroomId: CLASS_2A,
    mode: "mine",
    week: WEEK_12,
    todayIso: "2026-11-18",
  });
  assert.equal(filtered.ok, false);
  if (!filtered.ok) assert.equal(filtered.status, 403);

  const classAll = await getControlPlanning(planningDeps(), {
    teacherId: TEACHER_ID,
    classroomId: CLASS_2A,
    mode: "class-all",
    week: WEEK_12,
    todayIso: "2026-11-18",
  });
  assert.equal(classAll.ok, false);
  if (!classAll.ok) assert.equal(classAll.status, 403);

  const forbidden = await getControlPlanning(planningDeps(), {
    teacherId: TEACHER_ID,
    classroomId: "classe-inconnue",
    mode: "mine",
  });
  assert.equal(forbidden.ok, false);
  if (!forbidden.ok) {
    assert.equal(forbidden.status, 403);
  }

  const invalidMode = await getControlPlanning(planningDeps(), {
    teacherId: TEACHER_ID,
    mode: "everyone",
  });
  assert.equal(invalidMode.ok, false);
  if (!invalidMode.ok) {
    assert.equal(invalidMode.status, 400);
  }
});

test("sources — vue journalière sans axe horaire, Agenda inchangé, pas de table controls", async () => {
  const [
    panel,
    css,
    page,
    nav,
    route,
    createRoute,
    service,
    agenda,
    agendaId,
    classrooms,
    accessSrc,
    timelineSrc,
    workspaceSrc,
    mesCoursRoute,
  ] = await Promise.all([
    readFile(new URL("../web/app/components/control-planning-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../web/app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/teacher/navigation.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/app/api/teacher/controls/planning/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/app/api/teacher/controls/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/control-planning/service.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/app/api/agenda/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/app/api/agenda/[id]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/app/api/teacher/classrooms/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/agenda-bridge/access.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/course-timeline/service.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/teacher-workspace/queries.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/app/api/teacher/courses/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(nav, /controles: "Contrôles"/);
  assert.match(page, /ControlPlanningPanel/);
  assert.match(page, /activeSection === "controles"/);
  assert.match(page, /Planification des contrôles publiés dans l’agenda/);
  assert.match(panel, /Toutes mes classes/);
  assert.match(panel, /Mes contrôles/);
  assert.match(panel, /Tous les contrôles de la classe/);
  assert.match(panel, /Tous les contrôles des classes/);
  assert.match(panel, /Année scolaire/);
  assert.match(panel, /data-control-year/);
  assert.match(panel, /data-control-semester/);
  assert.match(panel, /data-control-layout="semester"/);
  assert.match(panel, /Semestre 1/);
  assert.match(panel, /function selectYear/);
  assert.match(panel, /setClassroomIds\(null\)/);
  assert.match(panel, /setMode\("mine"\)/);
  assert.match(panel, /setWeek\(null\)/);
  assert.match(panel, /aria-pressed/);
  assert.match(panel, /schoolYearId/);
  assert.match(panel, /card\.classroomName/);
  assert.match(panel, /Aucun contrôle/);
  assert.match(panel, /Alertes de coordination/);
  assert.match(panel, /Charge enseignant/);
  assert.match(panel, /\+ Planifier un contrôle/);
  assert.match(panel, /data-control-plan/);
  assert.match(panel, /data-control-modal/);
  assert.match(panel, /data-control-title/);
  assert.match(panel, /data-control-detail/);
  assert.match(panel, /Publier quand même/);
  assert.match(panel, /createTeacherControlApi/);
  assert.match(panel, /confirmCoordination/);
  assert.match(panel, /classDayControlsForPlacementOption/);
  assert.match(panel, /confirmationRequiredForPlacementOption/);
  assert.match(panel, /targetClassDayControls/);
  assert.doesNotMatch(panel, /modalDay\?\.confirmationRequired/);
  assert.doesNotMatch(panel, /<span>Classe<\/span>/);
  assert.match(panel, /onDragStart/);
  assert.match(panel, /onDrop/);
  assert.match(panel, /moveTeacherControlApi/);
  assert.match(panel, /data-control-move/);
  assert.doesNotMatch(panel, /dnd-kit/);
  assert.doesNotMatch(panel, /react-beautiful-dnd/);
  assert.doesNotMatch(panel, /type === "HOMEWORK"/);
  assert.doesNotMatch(panel, /Devoir/);
  assert.doesNotMatch(panel, /Information/);
  assert.doesNotMatch(panel, /08h00/);
  assert.doesNotMatch(panel, /10h00/);
  assert.doesNotMatch(panel, /hour-axis/);
  assert.match(panel, /onDeleteClick/);
  assert.match(panel, /onEditClick/);
  assert.match(panel, /updateTeacherControlApi/);
  assert.match(panel, /deleteTeacherControlApi/);
  assert.match(panel, /data-control-menu/);
  assert.match(panel, /Supprimer ce contrôle \? Cette action est définitive\./);
  assert.match(page, /upsertAgendaItem/);
  assert.match(page, /onPublicationCreated/);
  assert.match(css, /control-planning-week/);
  assert.match(css, /control-planning-semester/);
  assert.match(css, /--control-day-count/);
  assert.doesNotMatch(css, /\.control-planning-week\s*\{[^}]*repeat\(5,/s);
  assert.doesNotMatch(css, /\.control-planning-week[^{]*08h/);
  assert.match(panel, /data-control-empty-week/);

  assert.match(route, /requireTeacherSession/);
  assert.match(route, /getControlPlanning/);
  assert.match(route, /withApiObservability\("\/api\/teacher\/controls\/planning"/);
  assert.doesNotMatch(route, /searchParams\.get\("teacherId"\)/);
  assert.match(service, /schoolYearId: year\.id/);
  assert.match(service, /isConsultablePlanningYear/);
  assert.match(service, /listControlPlacementOptions/);
  assert.match(service, /assignmentInstantForSessionDate|listControlPlacementOptions/);
  assert.doesNotMatch(route, /export const POST/);
  assert.doesNotMatch(route, /CREATE TABLE/);
  assert.match(createRoute, /publishManualControlToAgenda/);
  assert.match(createRoute, /auth\.session!.teacherId/);
  assert.match(createRoute, /confirmCoordination/);
  assert.match(agenda, /CONTROL_COORDINATION_CONFIRM_CODE/);
  assert.match(agenda, /parseConfirmCoordination/);
  assert.match(agenda, /export async function GET/);
  assert.match(agenda, /export async function POST/);
  assert.match(agenda, /listAgendaItems/);
  assert.match(agendaId, /export async function PATCH/);
  assert.match(agendaId, /export async function DELETE/);
  assert.match(classrooms, /listAccessibleRuntimeClassroomsForTeacher/);
  assert.doesNotMatch(
    classrooms,
    /listAccessibleControlPlanningClassrooms/,
    "GET /api/teacher/classrooms must keep runtime access, not control-planning access",
  );
  assert.match(service, /listAssignedStructuredPlanningClassrooms/);
  assert.match(service, /at: assignmentAt/);
  assert.doesNotMatch(service, /sessions: yearSessions,\s*schoolYearId: year\.id/);
  assert.doesNotMatch(service, /listAccessibleRuntimeClassroomsForTeacher/);
  assert.doesNotMatch(service, /listAccessibleControlPlanningClassrooms/);
  assert.match(accessSrc, /options\.at \?\? new Date\(\)\.toISOString\(\)/);
  assert.doesNotMatch(
    accessSrc,
    /listComputedCourseSessions/,
    "generic structured classroom read access must stay at 'now' on an active year",
  );
  assert.match(timelineSrc, /listTeacherCourses\(/);
  assert.doesNotMatch(
    timelineSrc,
    /teacherHasControlPlanningClassAccess/,
    "CourseTimeline must keep listTeacherCourses access",
  );
  assert.match(workspaceSrc, /isAssignmentActiveAt/);
  assert.match(workspaceSrc, /assignedSchoolClassIdsFromTeacherCourses/);
  assert.match(mesCoursRoute, /listTeacherCourses/);
  assert.doesNotMatch(mesCoursRoute, /teacherHasControlPlanningClassAccess/);
});

function yearRecord(
  id: string,
  label: string,
  status: SchoolYearRecord["status"],
  weeks = WEEKS,
): SchoolYearWithWeeks {
  const startsOn = `${label.slice(0, 4)}-08-17`;
  return {
    id,
    label,
    status,
    startsOn,
    endsOn: `${label.slice(5)}-07-02`,
    sourceFilename: "seed",
    importedAt: "2026-01-01T00:00:00.000Z",
    activatedAt: status === "active" ? "2026-08-01T00:00:00.000Z" : null,
    createdAt: "2026-01-01T00:00:00.000Z",
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
    schoolYearLabel: schoolYearId === "year-2026" ? "2026-2027" : "2025-2026",
    professionId: "prof-mma",
    trainingYear: 1,
    parallelCode: "A",
    isArchived: archived,
    archivedAt: archived ? "2026-08-01T00:00:00.000Z" : null,
  };
}

function course(id: string, schoolYearId: string, classId: string): AnnualCourse {
  return {
    id,
    schoolYearId,
    classId,
    contextId: "ctx-moteur",
    isArchived: false,
    archivedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function assignment(id: string, annualCourseId: string, teacherId: string): TeacherCourseAssignment {
  return {
    id,
    annualCourseId,
    teacherId,
    role: "PRIMARY",
    validFrom: "2025-08-01T00:00:00.000Z",
    validTo: null,
    createdByAdminId: "admin-1",
    createdAt: "2025-08-01T00:00:00.000Z",
    endedAt: null,
    overrideReason: null,
    overrideByAdminId: null,
  };
}

function testItem(input: {
  id: number;
  classroomId: string;
  teacherId?: string;
  title: string;
  type?: PrototypeAgendaItem["type"];
  schoolYearId?: string | null;
  day?: number;
  schoolWeekNumber?: number;
}): PrototypeAgendaItem {
  return {
    id: input.id,
    classroomId: input.classroomId,
    subjectId: "subject-moteur",
    authorTeacherId: input.teacherId ?? TEACHER_ID,
    day: input.day ?? 0,
    hour: 9,
    weekOffset: 0,
    schoolWeekNumber: input.schoolWeekNumber ?? WEEK_12,
    type: input.type ?? "TEST",
    title: input.title,
    detail: "Contrôle",
    schoolYearId: input.schoolYearId ?? null,
  };
}

test("années consultables — active et archivées, jamais draft", () => {
  const years = listConsultablePlanningYears([
    yearRecord("year-draft", "2027-2028", "draft"),
    yearRecord("year-2025", "2025-2026", "archived"),
    yearRecord("year-2026", "2026-2027", "active"),
  ]);
  assert.deepEqual(
    years.map((entry) => entry.id),
    ["year-2026", "year-2025"],
  );
  assert.equal(years[0]?.status, "active");
  assert.equal(
    years.some((entry) => entry.id === "year-draft"),
    false,
  );
});

test("service — classes structurées filtrées par année, même code MMA1A jamais mélangé", async () => {
  const active = yearRecord("year-2026", "2026-2027", "active");
  const archived = yearRecord("year-2025", "2025-2026", "archived");
  const draft = yearRecord("year-draft", "2027-2028", "draft");
  const class2026 = schoolClass("sc-mma1a-2026", "MMA1A", "year-2026");
  const class2025 = schoolClass("sc-mma1a-2025", "MMA1A", "year-2025");
  const room2026 = { id: "rt-mma1a-2026", name: "MMA1A", schoolClassId: "sc-mma1a-2026" };
  const room2025 = { id: "rt-mma1a-2025", name: "MMA1A", schoolClassId: "sc-mma1a-2025" };
  const course2026 = course("ac-2026", "year-2026", class2026.id);
  const course2025 = course("ac-2025", "year-2025", class2025.id);
  const items: PrototypeAgendaItem[] = [
    testItem({
      id: 101,
      classroomId: room2026.id,
      title: "Contrôle 2026",
      schoolYearId: "year-2026",
    }),
    testItem({
      id: 102,
      classroomId: room2025.id,
      title: "Contrôle 2025",
      schoolYearId: "year-2025",
    }),
    testItem({
      id: 103,
      classroomId: room2026.id,
      title: "Devoir 2026",
      type: "HOMEWORK",
      schoolYearId: "year-2026",
    }),
  ];

  const deps: ControlPlanningServiceDeps = {
    agenda: {
      listAgendaItems: async (classroomId: string) => items.filter((item) => item.classroomId === classroomId),
      teacherCanAccessClassroom: async () => false,
    },
    adapters: {
      listClassrooms: async () => [room2026, room2025],
      listSubjects: async () => [{ id: "subject-moteur", name: "Moteur" }],
    },
    catalog: {
      ensureSeeded: async () => undefined,
      listClasses: async () => [class2026, class2025],
      listContexts: async () => [motorContext()],
      listBranches: async () => [motorBranch()],
    },
    courses: {
      listCourses: async () => [course2026, course2025],
      listAssignments: async () => [
        assignment("asg-2026", course2026.id, TEACHER_ID),
        assignment("asg-2025", course2025.id, TEACHER_ID),
      ],
    },
    years: {
      listSchoolYears: async () => [active, archived, draft],
      getActiveSchoolYear: async () => active,
      getSchoolYearById: async (id: string) =>
        [active, archived, draft].find((entry) => entry.id === id) ?? null,
      listDayExceptions: async () => [],
    },
    teachers: {
      listAccounts: async () => [{ id: TEACHER_ID, displayName: "François Martin", initials: "FM" }],
    },
    schedules: {
      listSlots: async () => [
        slotFor(course2026.id, { id: "s-2026", dayOfWeek: 4 }),
        slotFor(course2025.id, { id: "s-2025", dayOfWeek: 4 }),
      ],
    },
  } as unknown as ControlPlanningServiceDeps;

  const current = await getControlPlanning(deps, {
    teacherId: TEACHER_ID,
    schoolYearId: "year-2026",
    week: WEEK_12,
    todayIso: "2026-11-18",
  });
  assert.equal(current.ok, true);
  if (!current.ok) return;
  assert.equal(current.view.schoolYearId, "year-2026");
  assert.deepEqual(
    current.view.classes.map((entry) => entry.id),
    ["rt-mma1a-2026"],
  );
  assert.equal(current.view.classes.some((entry) => entry.id === "rt-mma1a-2025"), false);
  assert.deepEqual(
    cardsFromView(current.view).map((card) => card.title),
    ["Contrôle 2026"],
  );
  assert.equal(cardsFromView(current.view).some((card) => card.title === "Contrôle 2025"), false);
  assert.equal(cardsFromView(current.view).some((card) => card.title === "Devoir 2026"), false);
  assert.deepEqual(
    current.view.years.map((entry) => entry.id),
    ["year-2026", "year-2025"],
  );

  const previous = await getControlPlanning(deps, {
    teacherId: TEACHER_ID,
    schoolYearId: "year-2025",
    week: WEEK_12,
    todayIso: "2026-11-18",
  });
  assert.equal(previous.ok, true);
  if (!previous.ok) return;
  assert.equal(previous.view.schoolYearId, "year-2025");
  assert.deepEqual(
    previous.view.classes.map((entry) => entry.id),
    ["rt-mma1a-2025"],
  );
  assert.deepEqual(
    cardsFromView(previous.view).map((card) => card.title),
    ["Contrôle 2025"],
  );

  const otherYearClass = await getControlPlanning(deps, {
    teacherId: TEACHER_ID,
    schoolYearId: "year-2026",
    classroomId: room2025.id,
  });
  assert.equal(otherYearClass.ok, false);
  if (!otherYearClass.ok) assert.equal(otherYearClass.status, 403);

  const draftYear = await getControlPlanning(deps, {
    teacherId: TEACHER_ID,
    schoolYearId: "year-draft",
  });
  assert.equal(draftYear.ok, false);
  if (!draftYear.ok) assert.equal(draftYear.status, 404);

  const accessible2026 = await listAccessibleRuntimeClassroomsForTeacher({
    teacherId: TEACHER_ID,
    classrooms: [room2026, room2025],
    classes: [class2026, class2025],
    courses: [course2026, course2025],
    assignments: [
      assignment("asg-2026", course2026.id, TEACHER_ID),
      assignment("asg-2025", course2025.id, TEACHER_ID),
    ],
    years: [active, archived],
    schoolYearId: "year-2026",
    teacherCanAccessClassroom: async () => false,
  });
  assert.deepEqual(
    accessible2026.map((entry) => entry.id),
    ["rt-mma1a-2026"],
  );
});

test("projection — charge enseignant globale indépendante du filtre classe", () => {
  const classes = [
    { id: "c-ma2a", name: "MA2A" },
    { id: "c-ma2b", name: "MA2B" },
    { id: "c-mma1a", name: "MMA1A" },
  ];
  const items: PrototypeAgendaItem[] = [
    testItem({ id: 1, classroomId: "c-ma2a", title: "Contrôle MA2A" }),
    testItem({ id: 2, classroomId: "c-ma2b", title: "Contrôle MA2B" }),
    testItem({ id: 3, classroomId: "c-mma1a", title: "Contrôle MMA1A" }),
    testItem({
      id: 4,
      classroomId: "c-ma2a",
      teacherId: "teacher-demo-dupont",
      title: "Contrôle collègue",
    }),
    testItem({
      id: 5,
      classroomId: "c-ma2a",
      title: "Info MA2A",
      type: "INFORMATION",
    }),
  ];
  const catalog = {
    classrooms: classes,
    subjects: [{ id: "subject-moteur", name: "Moteur" }],
    teachers: [
      { id: TEACHER_ID, displayName: "François Martin", initials: "FM" },
      { id: "teacher-demo-dupont", displayName: "Mme Dupont", initials: "MD" },
    ],
  };
  const base = planningInput({
    items,
    catalog,
    accessibleClasses: classes,
  });

  const allMine = buildControlPlanningView(base);
  assert.equal(allMine.teacherLoadThisWeek, 3);
  assert.equal(
    countOwnControlsForWeek({
      items,
      teacherId: TEACHER_ID,
      accessibleClassroomIds: classes.map((entry) => entry.id),
      schoolYearId: YEAR_ID,
      includeUnscopedYearItems: true,
      schoolWeekNumber: WEEK_12,
    }),
    3,
  );

  const mineClass = buildControlPlanningView({
    ...base,
    classroomId: "c-ma2a",
    requestedMode: "mine",
  });
  assert.deepEqual(
    cardsFromView(mineClass).map((card) => card.title),
    ["Contrôle MA2A"],
  );
  assert.equal(mineClass.teacherLoadThisWeek, 3);

  const classAll = buildControlPlanningView({
    ...base,
    classroomId: "c-ma2a",
    requestedMode: "class-all",
  });
  assert.deepEqual(
    cardsFromView(classAll).map((card) => card.title).sort(),
    ["Contrôle MA2A", "Contrôle collègue"],
  );
  assert.equal(classAll.teacherLoadThisWeek, 3);
  assert.equal(classAll.summary.controlCount, 2);
});

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

function tca(
  id: string,
  annualCourseId: string,
  teacherId: string,
  role: TeacherCourseAssignment["role"] = "PRIMARY",
  validFrom = "2026-08-01T00:00:00.000Z",
  validTo: string | null = null,
): TeacherCourseAssignment {
  return {
    ...assignment(id, annualCourseId, teacherId),
    role,
    validFrom,
    validTo,
  };
}

test("placements — classe non sélectionnée, archived, legacy, férié, exception, P4+P6, rôles", () => {
  const weeks = mondayWeeks("2026-08-10", 2);
  const moteur = "ac-moteur";
  const elec = "ac-elec";
  const sessions = computeCourseSessions({
    schoolYearId: "year-2026",
    courses: [
      { id: moteur, classId: "sc-ma2a", contextId: "ctx-moteur" },
      { id: elec, classId: "sc-ma2a", contextId: "ctx-elec" },
    ],
    slots: [
      slotFor(moteur, { id: "s-p4", periodStart: 4, periodEnd: 4 }),
      slotFor(moteur, { id: "s-p6", periodStart: 6, periodEnd: 6 }),
      slotFor(elec, { id: "s-elec", dayOfWeek: 1, periodStart: 2, periodEnd: 3 }),
      slotFor(moteur, { id: "s-thu", dayOfWeek: 4, periodStart: 1, periodEnd: 2 }),
    ],
    weeks,
    holidays: [{ date: "2026-08-13", label: "Fête" }],
    exceptions: [{ date: "2026-08-13", state: "class", label: "Cours rattrapé" }],
  });

  const week1Monday = sessions.filter((entry) => entry.schoolWeekNumber === 1);
  const p4p6 = week1Monday.filter((entry) => entry.annualCourseId === moteur && entry.date === "2026-08-10");
  assert.equal(p4p6.length, 1);
  assert.equal(p4p6[0]?.segments.length, 2);

  const noneSelected = listControlPlacementOptions({
    sessions,
    assignments: [tca("a1", moteur, TEACHER_ID)],
    teacherId: TEACHER_ID,
    schoolWeekNumber: 1,
    branchByCourseId: new Map([
      [moteur, "Moteur"],
      [elec, "Électricité"],
    ]),
    yearStatus: "active",
    classroomSelected: false,
    structured: true,
  });
  assert.equal(noneSelected.length, 0);

  const archived = listControlPlacementOptions({
    sessions,
    assignments: [tca("a1", moteur, TEACHER_ID)],
    teacherId: TEACHER_ID,
    schoolWeekNumber: 1,
    branchByCourseId: new Map([[moteur, "Moteur"]]),
    yearStatus: "archived",
    classroomSelected: true,
    structured: true,
  });
  assert.equal(archived.length, 0);

  const legacy = listControlPlacementOptions({
    sessions,
    assignments: [tca("a1", moteur, TEACHER_ID)],
    teacherId: TEACHER_ID,
    schoolWeekNumber: 1,
    branchByCourseId: new Map([[moteur, "Moteur"]]),
    yearStatus: "active",
    classroomSelected: true,
    structured: false,
  });
  assert.equal(legacy.length, 0);

  const primary = listControlPlacementOptions({
    sessions,
    assignments: [tca("a1", moteur, TEACHER_ID), tca("a2", elec, TEACHER_ID)],
    teacherId: TEACHER_ID,
    schoolWeekNumber: 1,
    branchByCourseId: new Map([
      [moteur, "Moteur"],
      [elec, "Électricité"],
    ]),
    yearStatus: "active",
    classroomSelected: true,
    structured: true,
  });
  const monday = primary.filter((entry) => entry.date === "2026-08-10");
  assert.equal(monday.length, 2);
  assert.equal(monday.filter((entry) => entry.annualCourseId === moteur).length, 1);
  assert.equal(
    monday.find((entry) => entry.annualCourseId === moteur)?.sessionLabel,
    "P4 · P6",
  );
  const thursdayRestored = primary.filter((entry) => entry.date === "2026-08-13");
  assert.equal(thursdayRestored.length, 1);

  const noCourseTuesday = primary.filter((entry) => entry.dayIndex === 1);
  assert.equal(noCourseTuesday.length, 0);

  const coteacher = listControlPlacementOptions({
    sessions,
    assignments: [tca("co", moteur, TEACHER_ID, "CO_TEACHER")],
    teacherId: TEACHER_ID,
    schoolWeekNumber: 1,
    branchByCourseId: new Map([[moteur, "Moteur"]]),
    yearStatus: "active",
    classroomSelected: true,
    structured: true,
  });
  assert.ok(coteacher.some((entry) => entry.annualCourseId === moteur));

  const replacementOk = listControlPlacementOptions({
    sessions,
    assignments: [tca("rep", moteur, TEACHER_ID, "REPLACEMENT", "2026-08-10T00:00:00.000Z", "2026-08-10T23:59:59.000Z")],
    teacherId: TEACHER_ID,
    schoolWeekNumber: 1,
    branchByCourseId: new Map([[moteur, "Moteur"]]),
    yearStatus: "active",
    classroomSelected: true,
    structured: true,
  });
  assert.ok(replacementOk.some((entry) => entry.date === "2026-08-10"));
  assert.equal(
    replacementOk.some((entry) => entry.date === "2026-08-13"),
    false,
  );

  const weekBOnly = computeCourseSessions({
    schoolYearId: "year-2026",
    courses: [{ id: moteur, classId: "sc-ma2a", contextId: "ctx-moteur" }],
    slots: [slotFor(moteur, { id: "s-b", dayOfWeek: 2, weekKind: "B", periodStart: 1, periodEnd: 2 })],
    weeks,
  });
  const weekA = listControlPlacementOptions({
    sessions: weekBOnly,
    assignments: [tca("a1", moteur, TEACHER_ID)],
    teacherId: TEACHER_ID,
    schoolWeekNumber: 1,
    branchByCourseId: new Map([[moteur, "Moteur"]]),
    yearStatus: "active",
    classroomSelected: true,
    structured: true,
  });
  const weekB = listControlPlacementOptions({
    sessions: weekBOnly,
    assignments: [tca("a1", moteur, TEACHER_ID)],
    teacherId: TEACHER_ID,
    schoolWeekNumber: 2,
    branchByCourseId: new Map([[moteur, "Moteur"]]),
    yearStatus: "active",
    classroomSelected: true,
    structured: true,
  });
  assert.equal(weekA.length, 0);
  assert.equal(weekB.length, 1);

  const holidayOnly = computeCourseSessions({
    schoolYearId: "year-2026",
    courses: [{ id: moteur, classId: "sc-ma2a", contextId: "ctx-moteur" }],
    slots: [slotFor(moteur, { id: "s-hol", dayOfWeek: 1 })],
    weeks,
    holidays: [{ date: "2026-08-10", label: "Fête" }],
  });
  const noHoliday = listControlPlacementOptions({
    sessions: holidayOnly,
    assignments: [tca("a1", moteur, TEACHER_ID)],
    teacherId: TEACHER_ID,
    schoolWeekNumber: 1,
    branchByCourseId: new Map([[moteur, "Moteur"]]),
    yearStatus: "active",
    classroomSelected: true,
    structured: true,
  });
  assert.equal(noHoliday.length, 0);

  const view = buildControlPlanningView(
    planningInput({
      classroomId: CLASS_2A,
      canCreate: true,
      placementOptions: primary,
      yearStatus: "active",
      sessions,
      assignments: [tca("a1", moteur, TEACHER_ID), tca("a2", elec, TEACHER_ID)],
      selectedSchoolClassId: "sc-ma2a",
      schoolWeekNumber: 1,
      items: [],
      weeks,
    }),
  );
  assert.equal(view.canCreate, true);
  const mondayDay = view.week?.days.find((day) => day.dayIndex === 0);
  assert.ok(mondayDay);
  assert.equal(mondayDay!.canPlan, mondayDay!.placementOptions.length > 0);

  const noClass = buildControlPlanningView(planningInput({ canCreate: false, placementOptions: primary }));
  assert.equal(noClass.week?.days.every((day) => day.canPlan === false), true);
});

function motorBranch(): SchoolBranchRecord {
  return {
    id: "br-moteur",
    code: "MOT",
    label: "Moteur",
    sortOrder: 1,
    isActive: true,
    adminCode: "BR-0001",
    isArchived: false,
    archivedAt: null,
    teachingType: "TECHNICAL",
  };
}

function motorContext(): PedagogicalContextRecord {
  return {
    id: "ctx-moteur",
    adminCode: "CTX-0001",
    professionId: "prof-mma",
    trainingYear: 2,
    branchId: "br-moteur",
    isActive: true,
    isArchived: false,
    archivedAt: null,
  };
}

test("service — getControlPlanning : liste = Mes cours, placements toujours calés sur la séance", async () => {
  const REPLACEMENT_ID = "teacher-replacement";
  const TODAY = "2026-09-02";
  const weeks = [
    { number: 8, kind: "A" as const, monday: "2026-10-19" },
    { number: 11, kind: "A" as const, monday: "2026-11-09" },
    { number: 14, kind: "B" as const, monday: "2026-11-30" },
  ];
  const year = yearRecord("year-2026", "2026-2027", "active", weeks);
  const classMa2a = schoolClass("sc-ma2a", "MA2A", year.id);
  const classMa2b = schoolClass("sc-ma2b", "MA2B", year.id);
  const roomMa2a = { id: "rt-ma2a", name: "MA2A", schoolClassId: classMa2a.id };
  const roomMa2b = { id: "rt-ma2b", name: "MA2B", schoolClassId: classMa2b.id };
  const courseMa2a = course("ac-ma2a", year.id, classMa2a.id);
  const courseMa2b = course("ac-ma2b", year.id, classMa2b.id);
  const replacementTca = tca(
    "asg-ma2a-rep",
    courseMa2a.id,
    REPLACEMENT_ID,
    "REPLACEMENT",
    "2026-11-01T00:00:00.000Z",
    "2026-11-30T23:59:59.000Z",
  );
  const primaryMa2b = tca("asg-ma2b", courseMa2b.id, REPLACEMENT_ID);
  const assignments = [replacementTca, primaryMa2b];
  const courses = [courseMa2a, courseMa2b];
  const classes = [classMa2a, classMa2b];
  const classrooms = [roomMa2a, roomMa2b];
  const slots = [
    slotFor(courseMa2a.id, { id: "s-ma2a-p4", dayOfWeek: 4, periodStart: 4, periodEnd: 4 }),
    slotFor(courseMa2a.id, { id: "s-ma2a-p6", dayOfWeek: 4, periodStart: 6, periodEnd: 6 }),
    slotFor(courseMa2b.id, { id: "s-ma2b-tue", dayOfWeek: 2, periodStart: 1, periodEnd: 2 }),
  ];
  const items: PrototypeAgendaItem[] = [
    testItem({
      id: 801,
      classroomId: roomMa2a.id,
      teacherId: REPLACEMENT_ID,
      title: "Contrôle MA2A octobre",
      schoolYearId: year.id,
      day: 3,
      schoolWeekNumber: 8,
    }),
    testItem({
      id: 1101,
      classroomId: roomMa2a.id,
      teacherId: REPLACEMENT_ID,
      title: "Contrôle MA2A jeudi",
      schoolYearId: year.id,
      day: 3,
      schoolWeekNumber: 11,
    }),
    testItem({
      id: 1102,
      classroomId: roomMa2b.id,
      teacherId: REPLACEMENT_ID,
      title: "Contrôle MA2B mardi",
      schoolYearId: year.id,
      day: 1,
      schoolWeekNumber: 11,
    }),
    testItem({
      id: 1103,
      classroomId: roomMa2a.id,
      teacherId: "teacher-colleague",
      title: "Contrôle collègue MA2A",
      schoolYearId: year.id,
      day: 3,
      schoolWeekNumber: 11,
    }),
  ];

  const deps: ControlPlanningServiceDeps = {
    agenda: {
      listAgendaItems: async (classroomId: string) => items.filter((item) => item.classroomId === classroomId),
      teacherCanAccessClassroom: async () => false,
    },
    adapters: {
      listClassrooms: async () => classrooms,
      listSubjects: async () => [{ id: "subject-moteur", name: "Moteur" }],
    },
    catalog: {
      ensureSeeded: async () => undefined,
      listClasses: async () => classes,
      listContexts: async () => [motorContext()],
      listBranches: async () => [motorBranch()],
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
        { id: REPLACEMENT_ID, displayName: "Remi Placement", initials: "RP" },
        { id: "teacher-colleague", displayName: "Collegue Martin", initials: "CM" },
      ],
    },
    schedules: {
      listSlots: async () => slots,
    },
  } as unknown as ControlPlanningServiceDeps;

  const yearSessions = computeCourseSessions({
    schoolYearId: year.id,
    courses: courses.map((entry) => ({ id: entry.id, classId: entry.classId, contextId: entry.contextId })),
    slots,
    weeks,
    holidays: valaisHolidaysForSchoolYear(year.label),
  });
  const ma2aDates = yearSessions
    .filter((session) => session.classId === classMa2a.id)
    .map((session) => session.date)
    .sort();
  assert.deepEqual(ma2aDates, ["2026-10-22", "2026-11-12", "2026-12-03"]);
  assert.equal(
    yearSessions.filter((session) => session.classId === classMa2a.id && session.date === "2026-11-12").length,
    1,
  );

  assert.equal(
    teacherHasStructuredClassroomReadAccess({
      teacherId: REPLACEMENT_ID,
      schoolClass: classMa2a,
      courses,
      assignments,
      years: [year],
      at: `${TODAY}T12:00:00.000Z`,
    }),
    false,
  );
  assert.equal(
    teacherHasControlPlanningClassAccess({
      teacherId: REPLACEMENT_ID,
      schoolClass: classMa2a,
      courses,
      assignments,
      years: [year],
      contexts: [motorContext()],
      branches: [motorBranch()],
      schoolYearId: year.id,
      at: `${TODAY}T12:00:00.000Z`,
    }),
    false,
  );
  assert.equal(isAssignmentActiveAt(replacementTca, `${TODAY}T12:00:00.000Z`), false);

  const runtimeNow = await listAccessibleRuntimeClassroomsForTeacher({
    teacherId: REPLACEMENT_ID,
    classrooms,
    classes,
    courses,
    assignments,
    years: [year],
    teacherCanAccessClassroom: async () => false,
    schoolYearId: year.id,
  });
  assert.equal(
    runtimeNow.some((entry) => entry.id === roomMa2a.id),
    isAssignmentActiveAt(replacementTca, new Date().toISOString()),
    "GET /api/teacher/classrooms reste calé sur la TCA à maintenant",
  );
  assert.ok(runtimeNow.some((entry) => entry.id === roomMa2b.id));

  const planningNow = await listAccessibleControlPlanningClassrooms({
    teacherId: REPLACEMENT_ID,
    classrooms,
    classes,
    courses,
    assignments,
    years: [year],
    contexts: [motorContext()],
    branches: [motorBranch()],
    schoolYearId: year.id,
    at: `${TODAY}T12:00:00.000Z`,
  });
  assert.deepEqual(planningNow.map((entry) => entry.id), [roomMa2b.id]);

  const selectable = await getControlPlanning(deps, {
    teacherId: REPLACEMENT_ID,
    todayIso: TODAY,
    week: 11,
  });
  assert.equal(selectable.ok, true);
  if (!selectable.ok) return;
  assert.equal(selectable.view.classes.some((entry) => entry.id === roomMa2a.id), false);
  assert.ok(selectable.view.classes.some((entry) => entry.id === roomMa2b.id));

  const forgedFuture = await getControlPlanning(deps, {
    teacherId: REPLACEMENT_ID,
    classroomId: roomMa2a.id,
    todayIso: TODAY,
    week: 11,
  });
  assert.equal(forgedFuture.ok, false);
  if (!forgedFuture.ok) assert.equal(forgedFuture.status, 403);

  const novemberAt = "2026-11-12";
  const novemberList = await getControlPlanning(deps, {
    teacherId: REPLACEMENT_ID,
    todayIso: novemberAt,
    week: 11,
  });
  assert.equal(novemberList.ok, true);
  if (!novemberList.ok) return;
  assert.ok(novemberList.view.classes.some((entry) => entry.id === roomMa2a.id));
  assert.ok(novemberList.view.classes.some((entry) => entry.id === roomMa2b.id));

  const october = await getControlPlanning(deps, {
    teacherId: REPLACEMENT_ID,
    classroomId: roomMa2a.id,
    todayIso: novemberAt,
    week: 8,
  });
  assert.equal(october.ok, true);
  if (!october.ok) return;
  const octoberOptions = october.view.week?.days.flatMap((day) => day.placementOptions) ?? [];
  assert.equal(octoberOptions.length, 0);
  assert.equal(october.view.week?.days.every((day) => day.canPlan === false), true);
  assert.equal(october.view.teacherLoadThisWeek, 0);
  assert.equal(
    october.view.teacherWeekControls.some((card) => card.classroomId === roomMa2a.id),
    false,
  );

  const november = await getControlPlanning(deps, {
    teacherId: REPLACEMENT_ID,
    classroomId: roomMa2a.id,
    mode: "mine",
    todayIso: novemberAt,
    week: 11,
  });
  assert.equal(november.ok, true);
  if (!november.ok) return;
  const novemberOptions = november.view.week?.days.flatMap((day) => day.placementOptions) ?? [];
  assert.equal(novemberOptions.length, 1);
  assert.equal(novemberOptions[0]?.date, "2026-11-12");
  assert.equal(novemberOptions[0]?.annualCourseId, courseMa2a.id);
  assert.equal(novemberOptions[0]?.sessionLabel, "P4 · P6");
  const thursday = november.view.week?.days.find((day) => day.dayIndex === 3);
  assert.equal(thursday?.canPlan, true);
  assert.equal(thursday?.date, "2026-11-12");
  assert.equal(november.view.teacherLoadThisWeek, 2);
  assert.deepEqual(
    november.view.teacherWeekControls.map((card) => card.title).sort(),
    ["Contrôle MA2A jeudi", "Contrôle MA2B mardi"],
  );

  const classAll = await getControlPlanning(deps, {
    teacherId: REPLACEMENT_ID,
    classroomId: roomMa2a.id,
    mode: "class-all",
    todayIso: novemberAt,
    week: 11,
  });
  assert.equal(classAll.ok, true);
  if (!classAll.ok) return;
  assert.equal(classAll.view.mode, "class-all");
  assert.ok(classAll.view.week?.days.some((day) => day.classDayControls.some((card) => !card.isOwn)));
  assert.equal(classAll.view.teacherLoadThisWeek, 2);

  const december = await getControlPlanning(deps, {
    teacherId: REPLACEMENT_ID,
    classroomId: roomMa2a.id,
    todayIso: novemberAt,
    week: 14,
  });
  assert.equal(december.ok, true);
  if (!december.ok) return;
  const decemberOptions = december.view.week?.days.flatMap((day) => day.placementOptions) ?? [];
  assert.equal(decemberOptions.length, 0);
  assert.equal(december.view.week?.days.every((day) => day.canPlan === false), true);

  const admin = await getControlPlanning(deps, {
    teacherId: "admin-sans-tca",
    classroomId: roomMa2b.id,
    todayIso: TODAY,
    week: 11,
  });
  assert.equal(admin.ok, false);
  if (!admin.ok) assert.equal(admin.status, 403);

  const archivedYear = { ...year, status: "archived" as const, activatedAt: null };
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
    {
      teacherId: REPLACEMENT_ID,
      schoolYearId: archivedYear.id,
      classroomId: roomMa2b.id,
      todayIso: TODAY,
      week: 11,
    },
  );
  assert.equal(archived.ok, true);
  if (archived.ok) {
    assert.equal(archived.view.yearStatus, "archived");
    assert.equal(archived.view.canCreate, false);
    assert.equal(archived.view.week?.days.every((day) => day.canPlan === false), true);
  }
});

function planningSession(
  patch: Pick<CourseSession, "annualCourseId" | "classId" | "date" | "dayOfWeek" | "schoolWeekNumber"> &
    Partial<CourseSession>,
): CourseSession {
  return {
    key: `${patch.schoolYearId ?? YEAR_ID}|${patch.annualCourseId}|${patch.date}`,
    schoolYearId: YEAR_ID,
    contextId: "ctx-moteur",
    weekKind: patch.schoolWeekNumber % 2 === 1 ? "A" : "B",
    sequenceNumber: 1,
    segments: [{ scheduleSlotId: "s1", periodStart: 4, periodEnd: 4 }],
    ...patch,
  };
}

test("jours visibles — professeur, classe, A/B, férié, remplacement, filet, alertes", () => {
  const francois = TEACHER_ID;
  const dupont = "teacher-demo-dupont";
  const mma1a = "sc-mma1a";
  const mma2c = "sc-mma2c";
  const mecauto = "sc-mecauto3a";
  const acMma1a = "ac-mma1a";
  const acMma2c = "ac-mma2c";
  const acMoteur = "ac-moteur";
  const acElec = "ac-elec";
  const assignments = [
    tca("a-mma1a", acMma1a, francois),
    tca("a-mma2c", acMma2c, francois),
    tca("a-moteur", acMoteur, francois),
    tca("a-elec", acElec, dupont),
  ];

  const mondayMma1a = planningSession({
    annualCourseId: acMma1a,
    classId: mma1a,
    date: "2026-08-10",
    dayOfWeek: 1,
    schoolWeekNumber: 1,
  });
  const mondayMma2c = planningSession({
    annualCourseId: acMma2c,
    classId: mma2c,
    date: "2026-08-10",
    dayOfWeek: 1,
    schoolWeekNumber: 1,
  });
  const thursdayMecauto = planningSession({
    annualCourseId: acMoteur,
    classId: mecauto,
    date: "2026-08-13",
    dayOfWeek: 4,
    schoolWeekNumber: 1,
  });
  const tuesdayColleague = planningSession({
    annualCourseId: acElec,
    classId: mecauto,
    date: "2026-08-11",
    dayOfWeek: 2,
    schoolWeekNumber: 1,
  });

  assert.deepEqual(
    listVisibleControlPlanningDayIndexes({
      mode: "mine",
      classroomId: null,
      schoolWeekNumber: 1,
      teacherId: francois,
      sessions: [mondayMma1a, mondayMma2c],
      assignments,
      selectedSchoolClassId: null,
      existingControlDayIndexes: [],
    }),
    [0],
    "CAS A : Toutes mes classes, lundi uniquement",
  );

  assert.deepEqual(
    listVisibleControlPlanningDayIndexes({
      mode: "mine",
      classroomId: null,
      schoolWeekNumber: 1,
      teacherId: francois,
      sessions: [mondayMma1a, thursdayMecauto],
      assignments,
      selectedSchoolClassId: null,
      existingControlDayIndexes: [],
    }),
    [0, 3],
    "CAS B : Toutes mes classes, lundi + jeudi",
  );

  assert.deepEqual(
    listVisibleControlPlanningDayIndexes({
      mode: "mine",
      classroomId: "rt-mecauto",
      schoolWeekNumber: 1,
      teacherId: francois,
      sessions: [tuesdayColleague, thursdayMecauto],
      assignments,
      selectedSchoolClassId: mecauto,
      existingControlDayIndexes: [],
    }),
    [3],
    "CAS C : Mes contrôles → uniquement les jours du professeur dans la classe",
  );

  assert.deepEqual(
    listVisibleControlPlanningDayIndexes({
      mode: "class-all",
      classroomId: "rt-mecauto",
      schoolWeekNumber: 1,
      teacherId: francois,
      sessions: [tuesdayColleague, thursdayMecauto],
      assignments,
      selectedSchoolClassId: mecauto,
      existingControlDayIndexes: [],
    }),
    [1, 3],
    "CAS C : Tous les contrôles → tous les jours de CourseSession de la classe",
  );

  const weeksAb = mondayWeeks("2026-08-10", 2);
  const abSessions = computeCourseSessions({
    schoolYearId: YEAR_ID,
    courses: [{ id: acMoteur, classId: mecauto, contextId: "ctx-moteur" }],
    slots: [
      slotFor(acMoteur, { id: "s-thu-all", dayOfWeek: 4, weekKind: "all" }),
      slotFor(acMoteur, { id: "s-tue-b", dayOfWeek: 2, weekKind: "B" }),
    ],
    weeks: weeksAb,
  });
  assert.deepEqual(
    listVisibleControlPlanningDayIndexes({
      mode: "mine",
      classroomId: "rt-mecauto",
      schoolWeekNumber: 1,
      teacherId: francois,
      sessions: abSessions,
      assignments,
      selectedSchoolClassId: mecauto,
      existingControlDayIndexes: [],
    }),
    [3],
    "CAS D semaine A : jeudi uniquement",
  );
  assert.deepEqual(
    listVisibleControlPlanningDayIndexes({
      mode: "mine",
      classroomId: "rt-mecauto",
      schoolWeekNumber: 2,
      teacherId: francois,
      sessions: abSessions,
      assignments,
      selectedSchoolClassId: mecauto,
      existingControlDayIndexes: [],
    }),
    [1, 3],
    "CAS D semaine B : mardi + jeudi",
  );

  const holidaySessions = computeCourseSessions({
    schoolYearId: YEAR_ID,
    courses: [{ id: acMma1a, classId: mma1a, contextId: "ctx-moteur" }],
    slots: [slotFor(acMma1a, { id: "s-mon", dayOfWeek: 1 })],
    weeks: weeksAb,
    holidays: [{ date: "2026-08-10", label: "Fête" }],
  });
  assert.deepEqual(
    listVisibleControlPlanningDayIndexes({
      mode: "mine",
      classroomId: null,
      schoolWeekNumber: 1,
      teacherId: francois,
      sessions: holidaySessions,
      assignments,
      selectedSchoolClassId: null,
      existingControlDayIndexes: [],
    }),
    [],
    "jour férié sans contrôle → jour absent",
  );

  const restoredSessions = computeCourseSessions({
    schoolYearId: YEAR_ID,
    courses: [{ id: acMma1a, classId: mma1a, contextId: "ctx-moteur" }],
    slots: [slotFor(acMma1a, { id: "s-mon-ex", dayOfWeek: 1 })],
    weeks: weeksAb,
    holidays: [{ date: "2026-08-10", label: "Fête" }],
    exceptions: [{ date: "2026-08-10", state: "class", label: "Cours rattrapé" }],
  });
  assert.deepEqual(
    listVisibleControlPlanningDayIndexes({
      mode: "mine",
      classroomId: null,
      schoolWeekNumber: 1,
      teacherId: francois,
      sessions: restoredSessions,
      assignments,
      selectedSchoolClassId: null,
      existingControlDayIndexes: [],
    }),
    [0],
    "exception rétablissant la séance → jour présent",
  );

  const replacement = tca(
    "a-rep",
    acMoteur,
    "teacher-replacement",
    "REPLACEMENT",
    "2026-08-13T00:00:00.000Z",
    "2026-08-13T23:59:59.000Z",
  );
  assert.deepEqual(
    listVisibleControlPlanningDayIndexes({
      mode: "mine",
      classroomId: "rt-mecauto",
      schoolWeekNumber: 1,
      teacherId: "teacher-replacement",
      sessions: [tuesdayColleague, thursdayMecauto],
      assignments: [replacement],
      selectedSchoolClassId: mecauto,
      existingControlDayIndexes: [],
    }),
    [3],
    "REPLACEMENT actif à la date → jeudi présent",
  );
  const laterReplacement = tca(
    "a-rep-later",
    acMoteur,
    "teacher-replacement",
    "REPLACEMENT",
    "2026-09-01T00:00:00.000Z",
    "2026-09-30T23:59:59.000Z",
  );
  assert.deepEqual(
    listVisibleControlPlanningDayIndexes({
      mode: "mine",
      classroomId: "rt-mecauto",
      schoolWeekNumber: 1,
      teacherId: "teacher-replacement",
      sessions: [thursdayMecauto],
      assignments: [laterReplacement],
      selectedSchoolClassId: mecauto,
      existingControlDayIndexes: [],
    }),
    [],
    "remplacement hors période → jour absent pour Mes contrôles",
  );

  const p4p6 = computeCourseSessions({
    schoolYearId: YEAR_ID,
    courses: [{ id: acMoteur, classId: mecauto, contextId: "ctx-moteur" }],
    slots: [
      slotFor(acMoteur, { id: "s-p4", dayOfWeek: 4, periodStart: 4, periodEnd: 4 }),
      slotFor(acMoteur, { id: "s-p6", dayOfWeek: 4, periodStart: 6, periodEnd: 6 }),
    ],
    weeks: weeksAb,
  });
  const thursdayP4p6 = p4p6.filter((entry) => entry.date === "2026-08-13");
  assert.equal(thursdayP4p6.length, 1);
  assert.equal(thursdayP4p6[0]?.segments.length, 2);
  assert.deepEqual(
    listVisibleControlPlanningDayIndexes({
      mode: "mine",
      classroomId: "rt-mecauto",
      schoolWeekNumber: 1,
      teacherId: francois,
      sessions: p4p6,
      assignments,
      selectedSchoolClassId: mecauto,
      existingControlDayIndexes: [],
    }),
    [3],
  );
  const p4p6Options = listControlPlacementOptions({
    sessions: p4p6,
    assignments,
    teacherId: francois,
    schoolWeekNumber: 1,
    branchByCourseId: new Map([[acMoteur, "Moteur"]]),
    yearStatus: "active",
    classroomSelected: true,
    structured: true,
  });
  assert.equal(p4p6Options.filter((entry) => entry.date === "2026-08-13").length, 1);

  assert.deepEqual(
    listVisibleControlPlanningDayIndexes({
      mode: "mine",
      classroomId: null,
      schoolWeekNumber: 1,
      teacherId: francois,
      sessions: [mondayMma1a],
      assignments,
      selectedSchoolClassId: null,
      existingControlDayIndexes: [2],
    }),
    [0, 2],
    "contrôle existant mercredi sans CourseSession → jour conservé",
  );

  assert.equal(
    emptyControlPlanningWeekMessage({ classroomId: null, mode: "mine", structured: true }),
    "Aucun de vos cours n’est prévu cette semaine.",
  );
  assert.equal(
    emptyControlPlanningWeekMessage({ classroomId: "rt-mecauto", mode: "mine", structured: true }),
    "Vous n’avez aucun cours avec cette classe cette semaine.",
  );
  assert.equal(
    emptyControlPlanningWeekMessage({ classroomId: "rt-mecauto", mode: "class-all", structured: true }),
    "Aucun cours n’est prévu pour cette classe cette semaine.",
  );
  assert.equal(
    emptyControlPlanningWeekMessage({ classroomId: "rt-legacy", mode: "mine", structured: false }),
    "Cette classe n’est pas reliée à l’horaire structuré.",
  );

  const emptyView = buildControlPlanningView(
    planningInput({
      classroomId: CLASS_2A,
      requestedMode: "mine",
      sessions: [],
      assignments,
      selectedSchoolClassId: mecauto,
      items: [],
    }),
  );
  assert.equal(emptyView.week?.days.length, 0);
  assert.equal(emptyView.emptyWeekMessage, "Vous n’avez aucun cours avec cette classe cette semaine.");

  const placementView = buildControlPlanningView(
    planningInput({
      classroomId: CLASS_2A,
      requestedMode: "class-all",
      canCreate: true,
      selectedSchoolClassId: mecauto,
      sessions: [tuesdayColleague, thursdayMecauto],
      assignments,
      items: [],
      schoolWeekNumber: 1,
      weeks: weeksAb,
      placementOptions: listControlPlacementOptions({
        sessions: [tuesdayColleague, thursdayMecauto],
        assignments,
        teacherId: francois,
        schoolWeekNumber: 1,
        branchByCourseId: new Map([
          [acMoteur, "Moteur"],
          [acElec, "Électricité"],
        ]),
        yearStatus: "active",
        classroomSelected: true,
        structured: true,
      }),
    }),
  );
  assert.deepEqual(
    placementView.week?.days.map((day) => day.weekdayLabel),
    ["Mardi", "Jeudi"],
  );
  const tuesday = placementView.week?.days.find((day) => day.dayIndex === 1);
  const thursday = placementView.week?.days.find((day) => day.dayIndex === 3);
  assert.equal(tuesday?.canPlan, false);
  assert.equal(thursday?.canPlan, true);

  const alertView = buildControlPlanningView(
    planningInput({
      classroomId: null,
      sessions: [mondayMma1a, thursdayMecauto],
      assignments,
      items: [
        testItem({
          id: 901,
          classroomId: CLASS_2A,
          title: "Contrôle jeudi",
          day: 3,
          schoolWeekNumber: 1,
        }),
      ],
      schoolWeekNumber: 1,
      weeks: weeksAb,
    }),
  );
  assert.deepEqual(
    alertView.week?.days.map((day) => day.weekdayLabel),
    ["Lundi", "Jeudi"],
  );
  assert.ok(alertView.alerts.some((alert) => alert.kind === "free-day" && /Lundi/.test(alert.message)));
  assert.equal(alertView.alerts.some((alert) => /Mardi/.test(alert.message)), false);
  assert.equal(alertView.alerts.some((alert) => /Mercredi/.test(alert.message)), false);
  assert.equal(alertView.alerts.some((alert) => /Vendredi/.test(alert.message)), false);
});


