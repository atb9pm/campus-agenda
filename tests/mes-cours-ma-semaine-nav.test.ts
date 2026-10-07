import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  filterNotebookItemsForSubject,
  implicitNotebookPublishCourse,
  notebookContextFromCourse,
  notebookUnlinkedCourseReason,
  openCourseInWeekTarget,
  resolveDefaultSubjectId,
  resolveNotebookClassroomId,
  resolveNotebookSubjectId,
  type NotebookRuntimeClassroom,
  type NotebookRuntimeSubject,
} from "../src/features/class-notebook/index.ts";
import type { PrototypeAgendaItem } from "../src/features/agenda/demo-items.ts";
import type { ClassroomCatalog } from "../src/features/classes/index.ts";
import { APP_VERSION } from "../src/lib/app-version.ts";
import { SQL_MIGRATION_FILES } from "../src/lib/persistence/sql/migrate.ts";
import {
  displaySetupsFromAssignedCourses,
  groupTeacherCoursesByClass,
  teacherCoursesForClass,
  type TeacherCourseWorkspaceEntry,
} from "../src/features/teacher-workspace/index.ts";

const TEACHER_ID = "teacher-delp";
const EMPTY_CATALOG: ClassroomCatalog = {
  classrooms: [],
  subjects: [],
  memberships: [],
  teachers: [],
};

const MECAUTO_CATALOG: ClassroomCatalog = {
  classrooms: [{ id: "classroom-mecauto3a", name: "MECAUTO3A", programLabel: "", accessCodeHint: "" }],
  subjects: [
    {
      id: "subj-chassis",
      classroomId: "classroom-mecauto3a",
      name: "Châssis",
      annualCourseId: "ac-chassis",
    },
    {
      id: "subj-transmission",
      classroomId: "classroom-mecauto3a",
      name: "Transmission",
      annualCourseId: "ac-transmission",
    },
  ],
  teachers: [{ id: TEACHER_ID, displayName: "DelP", initials: "DP" }],
  memberships: [
    {
      id: "mem-delp-mecauto3a",
      teacherId: TEACHER_ID,
      classroomId: "classroom-mecauto3a",
      subjectIds: ["subj-chassis", "subj-transmission"],
      validFrom: "2026-08-01",
      validTo: null,
    },
  ],
};

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

const RUNTIME: NotebookRuntimeClassroom[] = [
  {
    id: "classroom-mecauto3a",
    name: "MECAUTO3A",
    schoolClassId: "class-mecauto3a",
    subjects: [
      {
        id: "subj-transmission",
        name: "Transmission",
        classroomId: "classroom-mecauto3a",
        annualCourseId: "ac-transmission",
      },
      {
        id: "subj-chassis",
        name: "Châssis",
        classroomId: "classroom-mecauto3a",
        annualCourseId: "ac-chassis",
      },
    ],
  },
];

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
    schoolWeekNumber: 12,
    type,
    title,
    detail: "",
  };
}

const AGENDA_ITEMS = [
  item(1, "subj-transmission", "Exercice boîte de vitesses"),
  item(2, "subj-chassis", "Réviser géométrie"),
  item(3, "subj-transmission", "Contrôle Transmission", "TEST"),
  item(4, "subj-chassis", "Contrôle Châssis", "TEST"),
];

function subjectFor(course: TeacherCourseWorkspaceEntry): string {
  const classroomId = resolveNotebookClassroomId(
    { id: course.classId, name: course.classCode },
    RUNTIME,
    EMPTY_CATALOG,
    course.classId,
  );
  assert.equal(classroomId, "classroom-mecauto3a");
  const subjectId = resolveNotebookSubjectId({
    catalog: EMPTY_CATALOG,
    teacherId: TEACHER_ID,
    classroomId,
    branchLabel: course.branchLabel,
    annualCourseId: course.annualCourseId,
    runtimeSubjects: RUNTIME[0]?.subjects,
    strict: true,
  });
  assert.ok(subjectId);
  return subjectId!;
}

test("PR80 — version 2.44.1 sans nouvelle migration SQL", () => {
  assert.equal(APP_VERSION, "2.61.8");
  assert.equal(SQL_MIGRATION_FILES.at(-1), "0030_agenda_student_visible.sql");
});

test("A/B — Mes cours n’affiche plus Voir le déroulement, mais Ouvrir dans Ma semaine", async () => {
  const mesCours = await readFile(new URL("../web/app/components/mes-cours-panel.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(mesCours, /Voir le déroulement/);
  assert.match(mesCours, /Ouvrir dans Ma semaine/);
  assert.match(mesCours, /mes-cours-open-week/);
  assert.match(mesCours, /onOpenCourse\(course\)/);
  assert.match(mesCours, /Ouvrir le carnet/);
});

test("C — MECAUTO3A a trois cours distincts", () => {
  const groups = groupTeacherCoursesByClass(MECAUTO_COURSES);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.classCode, "MECAUTO3A");
  assert.equal(groups[0]?.classId, "class-mecauto3a");
  assert.deepEqual(
    groups[0]?.courses.map((entry) => entry.branchLabel),
    ["CP 1 Electrotechnique", "CP 2 Transmission", "CP 3 Châssis"],
  );
  const setups = displaySetupsFromAssignedCourses(MECAUTO_COURSES);
  assert.equal(setups.length, 1);
  assert.equal(setups[0]?.id, "class-mecauto3a");
  assert.equal(teacherCoursesForClass(MECAUTO_COURSES, setups[0]?.id).length, 3);
});

test("D — clic Transmission ouvre Ma semaine sur MECAUTO3A / Transmission", () => {
  const target = openCourseInWeekTarget(TRANSMISSION, 18);
  assert.equal(target.section, "ma-semaine");
  assert.equal(target.classId, "class-mecauto3a");
  assert.equal(target.annualCourseId, "ac-transmission");
  assert.equal(target.branchId, "br-transmission");
  assert.equal(target.branchLabel, "CP 2 Transmission");
  assert.equal(target.schoolWeekNumber, 18);
  const context = notebookContextFromCourse(TRANSMISSION);
  assert.equal(context.branchLabel, "CP 2 Transmission");
  assert.equal(context.classId, "class-mecauto3a");
  assert.equal(subjectFor(TRANSMISSION), "subj-transmission");
});

test("E — clic Châssis ouvre la même SchoolClass avec un subjectId différent", () => {
  const transmission = openCourseInWeekTarget(TRANSMISSION, 18);
  const chassis = openCourseInWeekTarget(CHASSIS, 18);
  assert.equal(chassis.section, "ma-semaine");
  assert.equal(chassis.classId, transmission.classId);
  assert.equal(chassis.schoolWeekNumber, transmission.schoolWeekNumber);
  assert.equal(chassis.branchLabel, "CP 3 Châssis");
  assert.notEqual(chassis.annualCourseId, transmission.annualCourseId);
  assert.notEqual(chassis.branchId, transmission.branchId);
  const transmissionSubject = subjectFor(TRANSMISSION);
  const chassisSubject = subjectFor(CHASSIS);
  assert.equal(transmissionSubject, "subj-transmission");
  assert.equal(chassisSubject, "subj-chassis");
  assert.notEqual(transmissionSubject, chassisSubject);
});

test("F — publications filtrées sur le subjectId sélectionné", () => {
  const transmissionItems = filterNotebookItemsForSubject(AGENDA_ITEMS, {
    classroomId: "classroom-mecauto3a",
    teacherId: TEACHER_ID,
    subjectId: "subj-transmission",
    restrictToSubject: true,
  });
  assert.deepEqual(
    transmissionItems.map((entry) => entry.title),
    ["Exercice boîte de vitesses", "Contrôle Transmission"],
  );
  const chassisItems = filterNotebookItemsForSubject(AGENDA_ITEMS, {
    classroomId: "classroom-mecauto3a",
    teacherId: TEACHER_ID,
    subjectId: "subj-chassis",
    restrictToSubject: true,
  });
  assert.deepEqual(
    chassisItems.map((entry) => entry.title),
    ["Réviser géométrie", "Contrôle Châssis"],
  );
});

test("G — créer une publication depuis Transmission utilise le subjectId Transmission", () => {
  const subjectId = subjectFor(TRANSMISSION);
  const created = {
    classroomId: "classroom-mecauto3a",
    subjectId,
    type: "HOMEWORK" as const,
    title: "Exercice boîte de vitesses",
  };
  assert.equal(created.subjectId, "subj-transmission");
  assert.notEqual(created.subjectId, "subj-chassis");
});

test("H — créer un contrôle depuis Transmission utilise le subjectId Transmission", () => {
  const subjectId = subjectFor(TRANSMISSION);
  const created = {
    classroomId: "classroom-mecauto3a",
    subjectId,
    type: "TEST" as const,
    title: "Contrôle Transmission",
  };
  assert.equal(created.subjectId, "subj-transmission");
  assert.notEqual(created.subjectId, subjectFor(CHASSIS));
});

test("resolveNotebookSubjectId — Transmission correctement reliée", () => {
  assert.equal(
    resolveNotebookSubjectId({
      catalog: MECAUTO_CATALOG,
      teacherId: TEACHER_ID,
      classroomId: "classroom-mecauto3a",
      branchLabel: "Transmission",
      annualCourseId: "ac-transmission",
      runtimeSubjects: RUNTIME[0]?.subjects,
      strict: true,
    }),
    "subj-transmission",
  );
});

test("resolveNotebookSubjectId — Châssis correctement relié", () => {
  assert.equal(
    resolveNotebookSubjectId({
      catalog: MECAUTO_CATALOG,
      teacherId: TEACHER_ID,
      classroomId: "classroom-mecauto3a",
      branchLabel: "Châssis",
      annualCourseId: "ac-chassis",
      runtimeSubjects: RUNTIME[0]?.subjects,
      strict: true,
    }),
    "subj-chassis",
  );
});

test("resolveNotebookSubjectId — annualCourseId inconnu + aucun label → null, jamais le 1er subject", () => {
  const firstDefault = resolveDefaultSubjectId(
    MECAUTO_CATALOG,
    TEACHER_ID,
    "classroom-mecauto3a",
    [],
  );
  assert.equal(firstDefault, "subj-chassis");

  const resolved = resolveNotebookSubjectId({
    catalog: MECAUTO_CATALOG,
    teacherId: TEACHER_ID,
    classroomId: "classroom-mecauto3a",
    branchLabel: "Moteur",
    annualCourseId: "ac-inconnu",
    runtimeSubjects: RUNTIME[0]?.subjects,
    strict: true,
  });
  assert.equal(resolved, null);
  assert.notEqual(resolved, firstDefault);
  assert.notEqual(resolved, "subj-chassis");
  assert.equal(
    notebookUnlinkedCourseReason("Transmission"),
    "Le cours Transmission n’est pas relié à une matière de cette classe.",
  );
});

test("resolveNotebookSubjectId — deux correspondances ambiguës → null", () => {
  const ambiguous: NotebookRuntimeSubject[] = [
    {
      id: "subj-t1",
      name: "Transmission",
      classroomId: "classroom-mecauto3a",
      annualCourseId: "ac-transmission",
    },
    {
      id: "subj-t2",
      name: "Transmission",
      classroomId: "classroom-mecauto3a",
      annualCourseId: "ac-transmission",
    },
  ];
  assert.equal(
    resolveNotebookSubjectId({
      catalog: EMPTY_CATALOG,
      teacherId: TEACHER_ID,
      classroomId: "classroom-mecauto3a",
      branchLabel: "Transmission",
      annualCourseId: "ac-transmission",
      runtimeSubjects: ambiguous,
      strict: true,
    }),
    null,
  );
  assert.equal(
    resolveNotebookSubjectId({
      catalog: EMPTY_CATALOG,
      teacherId: TEACHER_ID,
      classroomId: "classroom-mecauto3a",
      branchLabel: "Transmission",
      annualCourseId: "ac-inconnu",
      runtimeSubjects: ambiguous,
      strict: true,
    }),
    null,
  );
});

test("resolveNotebookSubjectId — chemin classique Ma semaine peut encore prendre le fallback", () => {
  const classic = resolveNotebookSubjectId({
    catalog: MECAUTO_CATALOG,
    teacherId: TEACHER_ID,
    classroomId: "classroom-mecauto3a",
    branchLabel: null,
    annualCourseId: null,
    runtimeSubjects: RUNTIME[0]?.subjects,
    strict: false,
  });
  assert.equal(classic, "subj-chassis");
});

test("I — ouverture classe sans cours explicite n’est pas restreinte à la première branche", () => {
  const classic = filterNotebookItemsForSubject(AGENDA_ITEMS, {
    classroomId: "classroom-mecauto3a",
    teacherId: TEACHER_ID,
    subjectId: "subj-transmission",
    restrictToSubject: false,
  });
  assert.equal(classic.length, 4);
  assert.ok(classic.some((entry) => entry.subjectId === "subj-chassis"));
});

test("filtre — subjectId null en mode cours explicite n’affiche aucune publication", () => {
  const blocked = filterNotebookItemsForSubject(AGENDA_ITEMS, {
    classroomId: "classroom-mecauto3a",
    teacherId: TEACHER_ID,
    subjectId: null,
    restrictToSubject: true,
  });
  assert.deepEqual(blocked, []);
});

test("sources — page.tsx ouvre le carnet avec le cours, plus le déroulement", async () => {
  const [page, notebook, classroomsApi, css, timelineFeature, timelineUi] = await Promise.all([
    readFile(new URL("../web/app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/components/class-notebook-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/api/teacher/classrooms/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../src/features/course-timeline/service.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/app/components/teacher-course-timeline-panel.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(page, /function openCourseInWeek/);
  assert.match(page, /openNotebookCourse/);
  assert.match(page, /onOpenCourse=\{openCourseInWeek\}/);
  assert.match(page, /resolveNotebookSubjectId/);
  assert.match(page, /strict: Boolean\(openNotebookCourse\)/);
  assert.match(page, /createNotebookPublicationApi/);
  assert.match(page, /workspaceAllowsNotebookPublish/);
  assert.match(page, /filterNotebookItemsForSubject/);
  assert.match(page, /restrictToSubject: Boolean\(openNotebookCourse\)/);
  assert.match(page, /onOpenClass=\{openClassNotebook\}/);
  assert.match(page, /courses=\{teacherCourses\}/);
  assert.match(page, /setOpenNotebookCourse\(null\)/);
  assert.match(page, /function closeClassNotebook/);
  assert.doesNotMatch(page, /function closeClassNotebook\([\s\S]{0,180}setSelectedSchoolWeekNumber/);
  assert.doesNotMatch(page, /openTimelineCourseId/);
  assert.doesNotMatch(page, /TeacherCourseTimelinePanel/);
  assert.doesNotMatch(page, /resolveDefaultSubjectId/);
  assert.doesNotMatch(page, /branchNames\[0\].*resolveDefaultSubjectId/);

  const resolveSource = await readFile(
    new URL("../src/features/class-notebook/resolve.ts", import.meta.url),
    "utf8",
  );
  assert.match(resolveSource, /if \(strict\) return null;/);
  assert.match(resolveSource, /uniqueSubjectMatch/);

  assert.match(notebook, /branchLabel: selectedBranchLabel/);
  assert.match(notebook, /data-annual-course-id/);
  assert.match(notebook, /data-subject-id/);
  assert.match(notebook, /selectedBranchLabel\?\.trim\(\) \|\| classSetup\.branchNames\[0\] \|\| "Branche"/);

  assert.match(classroomsApi, /schoolClassId: runtime\?\.schoolClassId/);
  assert.match(classroomsApi, /annualCourseId: subject\.annualCourseId/);
  assert.match(css, /mes-cours-open-week/);
  assert.match(css, /max-width: 430px/);

  assert.match(timelineFeature, /listComputedCourseSessions/);
  assert.match(timelineUi, /TeacherCourseTimelinePanel/);
});

test("Ma semaine — 3 boutons de cours, chacun ouvre le bon AnnualCourse", async () => {
  const classCourses = teacherCoursesForClass(MECAUTO_COURSES, "class-mecauto3a");
  assert.equal(classCourses.length, 3);
  assert.deepEqual(
    classCourses.map((course) => course.annualCourseId),
    ["ac-electro", "ac-transmission", "ac-chassis"],
  );

  const clicks = [ELECTRO, TRANSMISSION, CHASSIS].map((course) => ({
    opened: openCourseInWeekTarget(course, 8),
    context: notebookContextFromCourse(course),
  }));
  assert.equal(clicks[0]?.context.annualCourseId, "ac-electro");
  assert.equal(clicks[0]?.context.branchLabel, "CP 1 Electrotechnique");
  assert.equal(clicks[1]?.context.annualCourseId, "ac-transmission");
  assert.equal(clicks[1]?.context.branchLabel, "CP 2 Transmission");
  assert.equal(clicks[2]?.context.annualCourseId, "ac-chassis");
  assert.equal(clicks[2]?.context.branchLabel, "CP 3 Châssis");
  assert.equal(new Set(clicks.map((entry) => entry.opened.annualCourseId)).size, 3);
  assert.equal(
    implicitNotebookPublishCourse(MECAUTO_COURSES, "class-mecauto3a"),
    null,
  );

  const semaine = await readFile(new URL("../web/app/components/ma-semaine-panel.tsx", import.meta.url), "utf8");
  const page = await readFile(new URL("../web/app/page.tsx", import.meta.url), "utf8");
  const notebook = await readFile(new URL("../web/app/components/class-notebook-panel.tsx", import.meta.url), "utf8");
  assert.match(semaine, /onOpenCourse\(course\)/);
  assert.doesNotMatch(semaine, /onOpenClass/);
  assert.match(semaine, /<button/);
  assert.match(semaine, /ma-semaine-branch-badge/);
  assert.match(page, /<MaSemainePanel[\s\S]*onOpenCourse=\{openCourseInWeek\}/);
  assert.match(page, /<MesCoursPanel[\s\S]*onOpenCourse=\{openCourseInWeek\}/);
  assert.match(notebook, /annualCourseId\?\.trim\(\) \? \(/);
  assert.match(notebook, /Exporter le carnet/);
  assert.match(page, /annualCourseId=\{openNotebookCourse\?\.annualCourseId\}/);
});

test("implicitNotebookPublishCourse — 0 / 1 / plusieurs cours", () => {
  assert.equal(implicitNotebookPublishCourse([], "class-mecauto3a"), null);
  assert.equal(implicitNotebookPublishCourse(MECAUTO_COURSES, "class-absente"), null);
  assert.equal(
    implicitNotebookPublishCourse([TRANSMISSION], "class-mecauto3a")?.annualCourseId,
    "ac-transmission",
  );
  assert.equal(implicitNotebookPublishCourse(MECAUTO_COURSES, "class-mecauto3a"), null);
});

test("Carnet — publications, contrôles et cours filtrés sur l’AnnualCourse cliqué", () => {
  const items: PrototypeAgendaItem[] = [
    { ...item(10, "subj-electro", "Devoir CP1"), annualCourseId: "ac-electro" },
    { ...item(11, "subj-transmission", "Devoir CP2"), annualCourseId: "ac-transmission" },
    { ...item(12, "subj-chassis", "Devoir CP3"), annualCourseId: "ac-chassis" },
    { ...item(13, "subj-transmission", "Contrôle CP2", "TEST"), annualCourseId: "ac-transmission" },
    { ...item(14, "subj-chassis", "Contrôle CP3", "TEST"), annualCourseId: "ac-chassis" },
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
    ["Devoir CP2", "Contrôle CP2"],
  );
  assert.equal(cp2.every((entry) => entry.annualCourseId === "ac-transmission"), true);
  const cp1 = filterNotebookItemsForSubject(items, {
    classroomId: "classroom-mecauto3a",
    teacherId: TEACHER_ID,
    subjectId: "subj-electro",
    annualCourseId: "ac-electro",
    restrictToSubject: true,
  });
  assert.deepEqual(cp1.map((entry) => entry.title), ["Devoir CP1"]);
});

test("Mes cours — Ouvrir dans Ma semaine inchangé", async () => {
  const mesCours = await readFile(new URL("../web/app/components/mes-cours-panel.tsx", import.meta.url), "utf8");
  assert.match(mesCours, /onOpenCourse\(course\)/);
  assert.match(mesCours, /Ouvrir dans Ma semaine/);
  const fromMesCours = openCourseInWeekTarget(TRANSMISSION, 8);
  const fromMaSemaine = openCourseInWeekTarget(TRANSMISSION, 8);
  assert.deepEqual(fromMesCours, fromMaSemaine);
  assert.equal(fromMaSemaine.annualCourseId, TRANSMISSION.annualCourseId);
});
