import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { DEMO_PROTOTYPE_ITEMS, type PrototypeAgendaItem } from "../src/features/agenda/demo-items.ts";
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
  listAccessibleRuntimeClassroomsForTeacher,
  listConsultablePlanningYears,
  resolveControlPlanningMode,
  selectControlItems,
  type BuildControlPlanningInput,
  type ControlPlanningServiceDeps,
} from "../src/features/control-planning/index.ts";
import { TEACHER_NAV_LABELS, TEACHER_NAV_SECTIONS } from "../src/features/teacher/index.ts";
import { APP_VERSION } from "../src/lib/app-version.ts";
import { SQL_MIGRATION_FILES } from "../src/lib/persistence/sql/migrate.ts";
import type { SchoolClassRecord } from "../src/features/school-catalog/types.ts";
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

test("version 2.31.0 — module Contrôles, sans table dédiée", () => {
  assert.equal(APP_VERSION, "2.31.0");
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

  const view = buildControlPlanningView(planningInput({ classroomId: null, requestedMode: "class-all" }));
  assert.equal(view.mode, "mine");
  assert.equal(view.classroomId, null);
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

test("projection — la classe apparaît sur chaque carte, jours vides conservés, pas d’heure", () => {
  const view = buildControlPlanningView(planningInput());
  assert.ok(view.week);
  assert.equal(view.week!.days.length, 5);
  assert.deepEqual(
    view.week!.days.map((day) => day.weekdayLabel),
    ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi"],
  );

  const thursday = view.week!.days.find((day) => day.dayIndex === 3);
  assert.ok(thursday);
  assert.ok(thursday!.controls.length >= 1);
  for (const card of cardsFromView(view)) {
    assert.ok(card.classroomName.trim());
    assert.equal("hour" in card, false);
    assert.equal("hour" in card ? (card as { hour?: unknown }).hour : undefined, undefined);
  }

  const emptyDays = view.week!.days.filter((day) => day.controls.length === 0);
  assert.ok(emptyDays.length >= 3);
  assert.ok(emptyDays.some((day) => day.weekdayLabel === "Vendredi"));
  assert.ok(view.alerts.some((alert) => alert.kind === "free-day" && /Vendredi/.test(alert.message)));
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
  assert.equal(mine.view.week?.days.length, 5);
  const mineCards = cardsFromView(mine.view);
  assert.ok(mineCards.every((card) => card.teacherId === TEACHER_ID));
  assert.ok(mineCards.every((card) => card.classroomName.trim()));

  const filtered = await getControlPlanning(planningDeps(), {
    teacherId: TEACHER_ID,
    classroomId: CLASS_2A,
    mode: "mine",
    week: WEEK_12,
    todayIso: "2026-11-18",
  });
  assert.equal(filtered.ok, true);
  if (filtered.ok) {
    assert.deepEqual(
      cardsFromView(filtered.view).map((card) => card.title),
      ["Injection électronique"],
    );
  }

  const classAll = await getControlPlanning(planningDeps(), {
    teacherId: TEACHER_ID,
    classroomId: CLASS_2A,
    mode: "class-all",
    week: WEEK_12,
    todayIso: "2026-11-18",
  });
  assert.equal(classAll.ok, true);
  if (classAll.ok) {
    assert.ok(cardsFromView(classAll.view).length >= 3);
    assert.ok(cardsFromView(classAll.view).some((card) => !card.isOwn));
  }

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
  const [panel, css, page, nav, route, service, agenda, agendaId, classrooms] = await Promise.all([
    readFile(new URL("../web/app/components/control-planning-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../web/app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/teacher/navigation.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/app/api/teacher/controls/planning/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/control-planning/service.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/app/api/agenda/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/app/api/agenda/[id]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/app/api/teacher/classrooms/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(nav, /controles: "Contrôles"/);
  assert.match(page, /ControlPlanningPanel/);
  assert.match(page, /activeSection === "controles"/);
  assert.match(page, /Planification des contrôles publiés dans l’agenda/);
  assert.match(panel, /Toutes mes classes/);
  assert.match(panel, /Mes contrôles/);
  assert.match(panel, /Tous les contrôles de la classe/);
  assert.match(panel, /Année scolaire/);
  assert.match(panel, /data-control-year/);
  assert.match(panel, /function selectYear/);
  assert.match(panel, /setClassroomId\(null\)/);
  assert.match(panel, /setMode\("mine"\)/);
  assert.match(panel, /setWeek\(null\)/);
  assert.match(panel, /schoolYearId/);
  assert.match(panel, /card\.classroomName/);
  assert.match(panel, /Aucun contrôle/);
  assert.match(panel, /Alertes de coordination/);
  assert.match(panel, /Charge enseignant/);
  assert.doesNotMatch(panel, /08h00/);
  assert.doesNotMatch(panel, /10h00/);
  assert.doesNotMatch(panel, /hour-axis/);
  assert.doesNotMatch(panel, /onDelete/);
  assert.doesNotMatch(panel, /onEdit/);
  assert.match(css, /control-planning-week/);
  assert.match(css, /repeat\(5,/);
  assert.doesNotMatch(css, /\.control-planning-week[^{]*08h/);

  assert.match(route, /requireTeacherSession/);
  assert.match(route, /getControlPlanning/);
  assert.match(route, /withApiObservability\("\/api\/teacher\/controls\/planning"/);
  assert.doesNotMatch(route, /searchParams\.get\("teacherId"\)/);
  assert.match(service, /schoolYearId: year\.id/);
  assert.match(service, /isConsultablePlanningYear/);
  assert.doesNotMatch(route, /export const POST/);
  assert.doesNotMatch(route, /CREATE TABLE/);

  assert.match(agenda, /export async function GET/);
  assert.match(agenda, /export async function POST/);
  assert.match(agenda, /listAgendaItems/);
  assert.match(agendaId, /export async function PATCH/);
  assert.match(agendaId, /export async function DELETE/);
  assert.match(classrooms, /listAccessibleRuntimeClassroomsForTeacher/);
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
}): PrototypeAgendaItem {
  return {
    id: input.id,
    classroomId: input.classroomId,
    subjectId: "subject-moteur",
    authorTeacherId: input.teacherId ?? TEACHER_ID,
    day: input.day ?? 0,
    hour: 9,
    weekOffset: 0,
    schoolWeekNumber: WEEK_12,
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
  const class2025 = schoolClass("sc-mma1a-2025", "MMA1A", "year-2025", true);
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
    },
    teachers: {
      listAccounts: async () => [{ id: TEACHER_ID, displayName: "François Martin", initials: "FM" }],
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

