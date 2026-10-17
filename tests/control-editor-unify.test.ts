import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  classDayControlsForPlacementOption,
  confirmationRequiredForPlacementOption,
} from "../src/features/control-planning/index.ts";
import {
  CONTROL_COORDINATION_CONFIRM_REASON,
  confirmationRequiredForExistingTests,
} from "../src/features/evaluations/index.ts";

test("formulaire unique — Carnet et Planning partagent ControlEditorModal", async () => {
  const [editor, planning, notebook, page, modal, css] = await Promise.all([
    readFile(new URL("../web/app/components/control-editor-modal.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/components/control-planning-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/components/class-notebook-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/components/controls-modal.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(editor, /export function ControlEditorModal/);
  assert.match(editor, /mode: "create" \| "edit"/);
  assert.match(editor, /Titre \*/);
  assert.match(editor, /Détail/);
  assert.match(editor, /export function ControlCoordinationBlock/);
  assert.match(editor, /data-control-title/);
  assert.match(editor, /data-control-detail/);
  assert.match(editor, /data-control-publish/);
  assert.match(editor, /data-control-edit-title/);
  assert.match(editor, /data-control-edit-detail/);
  assert.match(editor, /Enregistrer les modifications/);
  assert.match(editor, /Publier quand même/);
  assert.doesNotMatch(editor, /Intitulé/);
  assert.doesNotMatch(editor, /Jour de cours/);

  assert.match(planning, /<ControlEditorModal/);
  assert.match(planning, /mode="create"/);
  assert.match(planning, /mode="edit"/);
  assert.match(planning, /createTeacherControlApi/);
  assert.match(planning, /updateTeacherControlApi/);
  assert.match(planning, /ControlCoordinationRequiredError/);
  assert.match(planning, /classDayControlsForPlacementOption/);
  assert.match(planning, /confirmationRequiredForPlacementOption/);
  assert.doesNotMatch(planning, /function PlanModal/);
  assert.doesNotMatch(planning, /function EditModal/);
  assert.doesNotMatch(planning, /function CoordinationBlock/);

  assert.match(notebook, /<ControlEditorModal/);
  assert.match(notebook, /openCreateForSession/);
  assert.match(notebook, /openEditControl/);
  assert.match(notebook, /detail: controlDetail/);
  assert.match(notebook, /confirmCoordination: confirm/);
  assert.match(notebook, /onUpdateControl/);
  assert.match(notebook, /fetchTeacherControlPlanningApi/);
  assert.match(notebook, /classDayControlsForPlacementOption/);
  assert.match(notebook, /confirmationRequiredForPlacementOption/);
  assert.match(notebook, /ControlCoordinationRequiredError/);
  assert.match(notebook, /data-control-line/);
  assert.match(notebook, /class-notebook-control-title/);
  assert.match(notebook, /class-notebook-control-day/);
  assert.match(notebook, /Planifier →/);
  assert.match(notebook, /data-control-plan-week/);
  assert.doesNotMatch(notebook, /data-control-session-picker/);
  assert.doesNotMatch(notebook, /Choisir le cours/);
  assert.doesNotMatch(notebook, /📅 \{item\.title\}/);
  assert.doesNotMatch(notebook, /onSave=\{async \(input\) =>/);
  assert.match(notebook, /onSelect=\{openEditControl\}/);

  assert.match(page, /detail: input\.detail \?\? ""/);
  assert.match(page, /confirmCoordination: input\.confirmCoordination === true|input\.confirmCoordination === true/);
  assert.match(page, /updateTeacherControlApi/);
  assert.match(page, /async function notebookUpdateControl/);
  assert.match(page, /if \(error instanceof ControlCoordinationRequiredError\) \{\s*throw error/s);

  assert.match(modal, /onSelect: \(item: PrototypeAgendaItem\) => void/);
  assert.doesNotMatch(modal, /Intitulé/);
  assert.doesNotMatch(modal, /Jour de cours/);
  assert.doesNotMatch(modal, /onSave/);

  assert.match(css, /class-notebook-control-open/);
  assert.match(css, /class-notebook-control-title/);
  assert.match(css, /class-notebook-control-day/);
  assert.match(css, /font-family: var\(--carnet-font\)/);
  assert.match(css, /#8b2e2e/);
  assert.match(css, /\.class-notebook-zone-control \.class-notebook-control-title[\s\S]*font-weight: 700/);
});

test("coordination — Carnet et Planning réutilisent la même règle métier", () => {
  assert.equal(confirmationRequiredForExistingTests(0), false);
  assert.equal(confirmationRequiredForExistingTests(1), false);
  assert.equal(confirmationRequiredForExistingTests(2), true);
  assert.match(CONTROL_COORDINATION_CONFIRM_REASON, /Deux contrôles sont déjà prévus/);

  const cards = [
    {
      agendaItemId: 1,
      classroomId: "c-a",
      classroomName: "MECAUTO3A",
      subjectId: "s",
      branchLabel: "Moteur",
      title: "Contrôle 1",
      detail: "",
      teacherId: "t",
      teacherName: "FC",
      isOwn: true,
      schoolWeekNumber: 9,
      dayIndex: 0,
      date: "2026-10-26",
      annualCourseId: "ac",
      courseSessionKey: "key",
      courseSessionDate: "2026-10-26",
    },
    {
      agendaItemId: 2,
      classroomId: "c-a",
      classroomName: "MECAUTO3A",
      subjectId: "s",
      branchLabel: "Français",
      title: "Contrôle 2",
      detail: "",
      teacherId: "t2",
      teacherName: "AB",
      isOwn: false,
      schoolWeekNumber: 9,
      dayIndex: 0,
      date: "2026-10-26",
      annualCourseId: "ac-fr",
      courseSessionKey: "key-fr",
      courseSessionDate: "2026-10-26",
    },
    {
      agendaItemId: 3,
      classroomId: "c-b",
      classroomName: "AUTRE",
      subjectId: "s",
      branchLabel: "Maths",
      title: "Autre classe",
      detail: "",
      teacherId: "t3",
      teacherName: "XY",
      isOwn: false,
      schoolWeekNumber: 9,
      dayIndex: 0,
      date: "2026-10-26",
      annualCourseId: "ac-m",
      courseSessionKey: "key-m",
      courseSessionDate: "2026-10-26",
    },
  ];
  const option = { classroomId: "c-a" };
  assert.equal(classDayControlsForPlacementOption(cards, option).length, 2);
  assert.equal(confirmationRequiredForPlacementOption(cards, option), true);
  assert.equal(confirmationRequiredForPlacementOption(cards, { classroomId: "c-b" }), false);
});

test("payload Carnet/Planning — title, detail, annualCourseId, courseSessionKey", async () => {
  const [notebook, page, client] = await Promise.all([
    readFile(new URL("../web/app/components/class-notebook-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/lib/api-client.ts", import.meta.url), "utf8"),
  ]);

  assert.match(notebook, /annualCourseId: session\.annualCourseId/);
  assert.match(notebook, /courseSessionKey: session\.key/);
  assert.match(notebook, /title: trimmed/);
  assert.match(notebook, /detail: controlDetail/);
  assert.match(page, /detail: input\.detail \?\? ""/);
  assert.match(client, /detail: input\.detail \?\? ""/);
  assert.match(client, /annualCourseId: input\.annualCourseId/);
  assert.match(client, /courseSessionKey: input\.courseSessionKey/);
});
