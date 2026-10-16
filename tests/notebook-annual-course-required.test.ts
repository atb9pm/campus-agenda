import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { PrototypeAgendaItem } from "../src/features/agenda/demo-items.ts";
import {
  NOTEBOOK_NARROW_VIEWPORT_MAX_PX,
  NOTEBOOK_PUBLISH_SELECT_COURSE,
  filterNotebookItemsForSubject,
  implicitNotebookPublishCourse,
  notebookContextFromCourse,
  notebookPublishBlockedReason,
  notebookWeekDisplayCountForViewport,
  openCourseInWeekTarget,
} from "../src/features/class-notebook/index.ts";
import {
  type TeacherCourseWorkspaceEntry,
} from "../src/features/teacher-workspace/index.ts";

function mecautoCourse(
  patch: Pick<TeacherCourseWorkspaceEntry, "annualCourseId" | "branchId" | "branchLabel" | "branchSortOrder">,
): TeacherCourseWorkspaceEntry {
  return {
    assignmentId: `${patch.annualCourseId}-as`,
    role: "PRIMARY",
    validFrom: "2026-08-01T00:00:00.000Z",
    validTo: null,
    schoolYearId: "year-2026",
    schoolYearLabel: "2026-2027",
    classId: "class-mecauto3a",
    classCode: "MECAUTO3A",
    classLabel: "MECAUTO 3A",
    classSortOrder: 1,
    professionId: "prof-mecauto",
    professionLabel: "Mécanicien en maintenance d’automobiles",
    trainingYear: 3,
    parallelCode: "A",
    contextId: `ctx-${patch.branchId}`,
    branchCode: patch.branchId,
    branchSortOrder: patch.branchSortOrder,
    teachingType: "TECHNICAL",
    ...patch,
  };
}

const ELECTRO = mecautoCourse({
  annualCourseId: "ac-electro",
  branchId: "br-electro",
  branchLabel: "CP 1 Electrotechnique",
  branchSortOrder: 0,
});
const TRANSMISSION = mecautoCourse({
  annualCourseId: "ac-transmission",
  branchId: "br-transmission",
  branchLabel: "CP 2 Transmission",
  branchSortOrder: 1,
});
const CHASSIS = mecautoCourse({
  annualCourseId: "ac-chassis",
  branchId: "br-chassis",
  branchLabel: "CP 3 Châssis",
  branchSortOrder: 2,
});
const MECAUTO_COURSES = [ELECTRO, TRANSMISSION, CHASSIS];

const TEACHER_ID = "teacher-chf";

function item(
  id: number,
  subjectId: string,
  title: string,
  type: PrototypeAgendaItem["type"] = "HOMEWORK",
): PrototypeAgendaItem {
  return {
    id,
    classroomId: "classroom-mecauto3a",
    subjectId,
    authorTeacherId: TEACHER_ID,
    day: 0,
    hour: 8,
    weekOffset: 0,
    schoolWeekNumber: 8,
    type,
    title,
    detail: "",
  };
}

test("Mes cours — plus de bouton classe « Ouvrir le carnet », une action par AnnualCourse", async () => {
  const mesCours = await readFile(new URL("../web/app/components/mes-cours-panel.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(mesCours, /Ouvrir le carnet/);
  assert.doesNotMatch(mesCours, /onOpenClass/);
  assert.match(mesCours, /onOpenCourse \? \(/);
  assert.match(mesCours, /onOpenCourse\(course\)/);
  assert.match(mesCours, /Ouvrir dans Ma semaine/);
  assert.match(mesCours, /group\.courses\.map\(\(course\) =>/);
  assert.match(mesCours, /key=\{course\.annualCourseId\}/);
});

test("CP1 / CP2 / CP3 ouvrent chacun leur AnnualCourse, jamais le premier par défaut", () => {
  assert.equal(notebookContextFromCourse(ELECTRO).annualCourseId, "ac-electro");
  assert.equal(notebookContextFromCourse(TRANSMISSION).annualCourseId, "ac-transmission");
  assert.equal(notebookContextFromCourse(CHASSIS).annualCourseId, "ac-chassis");
  assert.equal(implicitNotebookPublishCourse(MECAUTO_COURSES, "class-mecauto3a"), null);
  assert.notEqual(notebookContextFromCourse(TRANSMISSION).annualCourseId, ELECTRO.annualCourseId);
});

test("page.tsx — openCourseInWeek est l’unique ouverture, openClassNotebook retiré", async () => {
  const page = await readFile(new URL("../web/app/page.tsx", import.meta.url), "utf8");
  const mesCours = await readFile(new URL("../web/app/components/mes-cours-panel.tsx", import.meta.url), "utf8");
  const semaine = await readFile(new URL("../web/app/components/ma-semaine-panel.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /function openClassNotebook/);
  assert.doesNotMatch(page, /openClassNotebook/);
  assert.doesNotMatch(page, /onOpenClass/);
  assert.doesNotMatch(mesCours, /onOpenClass/);
  assert.match(page, /function openCourseInWeek\(course: TeacherCourseWorkspaceEntry\)/);
  assert.match(page, /<MesCoursPanel[\s\S]*onOpenCourse=\{openCourseInWeek\}/);
  assert.match(page, /<MaSemainePanel[\s\S]*onOpenCourse=\{openCourseInWeek\}/);
  assert.match(semaine, /onOpenCourse\(course\)/);
  assert.match(page, /openNotebookClass && openNotebookCourse/);
  assert.doesNotMatch(page, /implicitNotebookPublishCourse/);
});

test("Mes cours → CP2 et Ma semaine → CP2 produisent le même notebookContext", () => {
  const fromMesCours = {
    opened: openCourseInWeekTarget(TRANSMISSION, 12),
    context: notebookContextFromCourse(TRANSMISSION),
  };
  const fromMaSemaine = {
    opened: openCourseInWeekTarget(TRANSMISSION, 12),
    context: notebookContextFromCourse(TRANSMISSION),
  };
  assert.deepEqual(fromMesCours, fromMaSemaine);
  assert.equal(fromMesCours.context.annualCourseId, "ac-transmission");
  assert.equal(fromMesCours.opened.schoolWeekNumber, 12);
});

test("nouvelles mutations Carnet exigent annualCourseId, pas createAgendaItemApi", async () => {
  const page = await readFile(new URL("../web/app/page.tsx", import.meta.url), "utf8");
  const create = page.slice(page.indexOf("async function notebookCreatePublication"));
  const save = page.slice(page.indexOf("async function notebookSaveWeekPublication"));
  const control = page.slice(page.indexOf("async function notebookSaveControl"));
  const perform = page.slice(page.indexOf("async function performNotebookControl"));
  assert.match(create, /requireNotebookAnnualCourseId/);
  assert.match(create, /createNotebookPublicationApi/);
  assert.doesNotMatch(create.slice(0, create.indexOf("async function notebookSaveWeekPublication")), /createAgendaItemApi/);
  assert.match(save, /requireNotebookAnnualCourseId/);
  assert.match(save, /createNotebookPublicationApi/);
  assert.doesNotMatch(save.slice(0, save.indexOf("async function notebookSetWeekPublicationVisibility")), /createAgendaItemApi/);
  assert.match(control, /requireNotebookAnnualCourseId/);
  assert.match(control, /courseSessionKey/);
  assert.match(control, /createTeacherControlApi|performNotebookControl/);
  assert.doesNotMatch(control.slice(0, control.indexOf("if (passwordChange)")), /createAgendaItemApi/);
  assert.match(perform, /createTeacherControlApi/);
  assert.doesNotMatch(perform.slice(0, perform.indexOf("async function notebookCreatePublication")), /createAgendaItemApi/);
  assert.match(page, /NOTEBOOK_PUBLISH_SELECT_COURSE/);
  assert.equal(NOTEBOOK_PUBLISH_SELECT_COURSE, "Sélectionnez un cours avant de modifier le carnet.");
});

test("legacy — publications sans annualCourseId restent lisibles, ambiguïté non réattribuée", () => {
  const items: PrototypeAgendaItem[] = [
    { ...item(1, "subj-transmission", "Legacy CP2") },
    { ...item(2, "subj-transmission", "Structurée CP2"), annualCourseId: "ac-transmission" },
    { ...item(3, "subj-electro", "Legacy CP1") },
    { ...item(4, "subj-chassis", "Structurée CP3"), annualCourseId: "ac-chassis" },
  ];
  const cp2 = filterNotebookItemsForSubject(items, {
    classroomId: "classroom-mecauto3a",
    teacherId: TEACHER_ID,
    subjectId: "subj-transmission",
    annualCourseId: "ac-transmission",
    restrictToSubject: true,
  });
  assert.deepEqual(
    cp2.map((entry) => entry.title),
    ["Legacy CP2", "Structurée CP2"],
  );
  assert.equal(cp2[0]?.annualCourseId, undefined);
  assert.equal(cp2[1]?.annualCourseId, "ac-transmission");
  const ambiguous = implicitNotebookPublishCourse(
    [
      { classId: "class-mecauto3a", annualCourseId: "ac-electro" },
      { classId: "class-mecauto3a", annualCourseId: "ac-transmission" },
      { classId: "class-mecauto3a", annualCourseId: "ac-chassis" },
    ],
    "class-mecauto3a",
  );
  assert.equal(ambiguous, null);
  assert.equal(
    notebookPublishBlockedReason({
      hasOpenClass: true,
      annualCourseId: null,
      assignedToCourse: false,
      classroomId: "classroom-mecauto3a",
      subjectId: "subj-electro",
    }),
    NOTEBOOK_PUBLISH_SELECT_COURSE,
  );
});

test("Export visible, retour Ma semaine conserve la semaine, mobile inchangé", async () => {
  const [panel, page, semaine, css] = await Promise.all([
    readFile(new URL("../web/app/components/class-notebook-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/components/ma-semaine-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(panel, /annualCourseId\?\.trim\(\) \? \(/);
  assert.match(panel, /📄 Exporter le carnet/);
  assert.match(page, /annualCourseId=\{openNotebookCourse\.annualCourseId\}/);
  assert.match(page, /function closeClassNotebook\(\) \{\s*setOpenNotebookClassId\(null\);\s*setOpenNotebookCourse\(null\);/);
  assert.doesNotMatch(page, /function closeClassNotebook\([\s\S]{0,220}setSelectedSchoolWeekNumber/);
  assert.doesNotMatch(semaine, /weekSignals/);
  assert.match(semaine, /\{course\.branchLabel\}/);
  assert.equal(notebookWeekDisplayCountForViewport(390, 3), 1);
  assert.equal(NOTEBOOK_NARROW_VIEWPORT_MAX_PX, 760);
  assert.match(css, /class-notebook-display-count \{ display: none; \}/);
  assert.match(panel, /effectiveWeekDisplayCount/);
});

test("déplacement Carnet — page conserve l’API PATCH structurée (semaine + jour)", async () => {
  const page = await readFile(new URL("../web/app/page.tsx", import.meta.url), "utf8");
  const move = page.slice(page.indexOf("async function notebookMovePublication"));
  assert.match(move, /requireNotebookAnnualCourseId/);
  assert.match(move, /updateAgendaItemApi\(itemId,/);
  assert.match(move, /courseSessionKey: session\.key/);
  assert.doesNotMatch(move.slice(0, move.indexOf("async function notebookDeletePublication")), /createAgendaItemApi/);
});
