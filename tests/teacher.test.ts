import assert from "node:assert/strict";
import test from "node:test";

import { DEMO_PROTOTYPE_ITEMS } from "../src/features/agenda/demo-items.ts";
import { DEMO_CATALOG, DEMO_CURRENT_TEACHER_ID } from "../src/features/classes/index.ts";
import {
  DEFAULT_TEACHER_AGENDA_VIEW,
  createDefaultWorkspace,
  filterItemsForAgendaView,
  getAgendaSectionTitle,
  getMyItemsForClassroom,
  getTeacherClassSummaries,
  navigateToSection,
  openClassAgenda,
} from "../src/features/teacher/index.ts";

test("phase 0.3 — la vue par défaut de l'agenda enseignant est Mes éléments", () => {
  assert.equal(DEFAULT_TEACHER_AGENDA_VIEW, "mine");

  const workspace = createDefaultWorkspace(DEMO_CURRENT_TEACHER_ID, "classe-demo-tma-2a");
  assert.equal(workspace.agendaView, "mine");
  assert.equal(workspace.activeSection, "dashboard");

  const opened = openClassAgenda(workspace, "classe-demo-tma-1a");
  assert.equal(opened.selectedClassroomId, "classe-demo-tma-1a");
  assert.equal(opened.activeSection, "agenda");
  assert.equal(opened.agendaView, "mine");
});

test("phase 0.3 — la navigation vers l'agenda réinitialise Mes éléments", () => {
  const workspace = navigateToSection(
    { ...createDefaultWorkspace(DEMO_CURRENT_TEACHER_ID, "classe-demo-tma-2a"), agendaView: "class" },
    "agenda",
  );
  assert.equal(workspace.agendaView, "mine");
});

test("phase 0.3 — Mes éléments ne montre que les publications de l'enseignant", () => {
  const mine = filterItemsForAgendaView(
    DEMO_PROTOTYPE_ITEMS,
    "classe-demo-tma-2a",
    DEMO_CURRENT_TEACHER_ID,
    "mine",
  );
  const all = filterItemsForAgendaView(
    DEMO_PROTOTYPE_ITEMS,
    "classe-demo-tma-2a",
    DEMO_CURRENT_TEACHER_ID,
    "class",
  );

  assert.equal(mine.length, 2);
  assert.equal(all.length, 7);
  assert.ok(mine.every((item) => item.authorTeacherId === DEMO_CURRENT_TEACHER_ID));
});

test("phase 0.3 — le tableau de bord résume chaque classe rattachée", () => {
  const summaries = getTeacherClassSummaries(DEMO_CATALOG, DEMO_CURRENT_TEACHER_ID, DEMO_PROTOTYPE_ITEMS);
  assert.equal(summaries.length, 2);

  const secondYear = summaries.find((entry) => entry.classroom.id === "classe-demo-tma-2a");
  assert.ok(secondYear);
  assert.equal(secondYear.myItemCount, 2);
  assert.equal(secondYear.classItemCount, 7);
  assert.equal(secondYear.branchesTaught.length, 2);

  const firstYear = summaries.find((entry) => entry.classroom.id === "classe-demo-tma-1a");
  assert.ok(firstYear);
  assert.equal(getMyItemsForClassroom(DEMO_PROTOTYPE_ITEMS, DEMO_CURRENT_TEACHER_ID, firstYear.classroom.id).length, 1);
});

test("phase 0.3 — le titre de section reflète la vue active", () => {
  assert.equal(getAgendaSectionTitle("mine", "2e TMA"), "Mes éléments");
  assert.equal(getAgendaSectionTitle("class", "2e TMA"), "Agenda partagé · 2e TMA");
});
