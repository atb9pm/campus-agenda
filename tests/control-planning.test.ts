import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { DEMO_PROTOTYPE_ITEMS, type PrototypeAgendaItem } from "../src/features/agenda/demo-items.ts";
import { SCHOOL_WEEK_MONDAYS } from "../src/features/calendar/school-week-dates.ts";
import { DEMO_CATALOG, TEACHER_DEMO_ID } from "../src/features/classes/index.ts";
import { getMembershipsForTeacher } from "../src/features/classes/queries.ts";
import {
  buildControlPlanningView,
  formatControlPlanningYearLabel,
  formatControlTeacherName,
  getControlPlanning,
  isControlAgendaItem,
  resolveControlPlanningMode,
  selectControlItems,
  type BuildControlPlanningInput,
  type ControlPlanningServiceDeps,
} from "../src/features/control-planning/index.ts";
import { TEACHER_NAV_LABELS, TEACHER_NAV_SECTIONS } from "../src/features/teacher/index.ts";
import { APP_VERSION } from "../src/lib/app-version.ts";
import { SQL_MIGRATION_FILES } from "../src/lib/persistence/sql/migrate.ts";
import type { SchoolYearWithWeeks } from "../src/features/school-year/types.ts";

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
  const [panel, css, page, nav, route, agenda, agendaId, classrooms] = await Promise.all([
    readFile(new URL("../web/app/components/control-planning-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../web/app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/teacher/navigation.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/app/api/teacher/controls/planning/route.ts", import.meta.url), "utf8"),
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
  assert.doesNotMatch(route, /export const POST/);
  assert.doesNotMatch(route, /CREATE TABLE/);

  assert.match(agenda, /export async function GET/);
  assert.match(agenda, /export async function POST/);
  assert.match(agenda, /listAgendaItems/);
  assert.match(agendaId, /export async function PATCH/);
  assert.match(agendaId, /export async function DELETE/);
  assert.match(classrooms, /listAccessibleRuntimeClassroomsForTeacher/);
});
