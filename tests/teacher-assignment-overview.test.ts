import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assignmentDisplayLabel,
  assignmentDisplayStatus,
  TEACHER_ASSIGNMENT_EMPTY_ACTIVE_MESSAGE,
  TEACHER_ASSIGNMENT_HISTORY_CHECKBOX_LABEL,
  formatTeacherAssignmentOverviewLine,
  isOperationalTeacherCourseAssignment,
  listTeacherAssignmentOverviewRows,
  teacherVisibleInAssignmentOverview,
  type TeacherCourseAssignment,
  type AnnualCourse,
} from "../src/features/annual-courses/index.ts";
import type { PedagogicalContextRecord } from "../src/features/school-catalog/profession-types.ts";
import type { SchoolBranchRecord, SchoolClassRecord } from "../src/features/school-catalog/types.ts";
import {
  assignedSchoolClassIdsFromTeacherCourses,
  buildTeacherCourseWorkspace,
} from "../src/features/teacher-workspace/index.ts";
import { listAssignedStructuredPlanningClassrooms } from "../src/features/control-planning/index.ts";
import { APP_VERSION } from "../src/lib/app-version.ts";
import { SQL_MIGRATION_FILES } from "../src/lib/persistence/sql/migrate.ts";

const AT = "2026-09-15T12:00:00.000Z";
const YEAR_ID = "year-2026";
const PREV_YEAR_ID = "year-2025";
const FRANCOIS = { id: "teacher-cheseaux", isActive: true, isArchived: false };

const years = [
  { id: YEAR_ID, status: "active" },
  { id: PREV_YEAR_ID, status: "archived" },
];

function schoolClass(id: string, code: string, patch: Partial<SchoolClassRecord> = {}): SchoolClassRecord {
  return {
    id,
    code,
    label: code,
    sortOrder: code.startsWith("MA") && code !== "MA3A" ? 2 : code === "MECAUTO3A" ? 3 : 1,
    isActive: true,
    schoolYearId: YEAR_ID,
    schoolYearLabel: "2026-2027",
    professionId: "prof-mma",
    trainingYear: 3,
    parallelCode: "A",
    isArchived: false,
    archivedAt: null,
    ...patch,
  };
}

function course(id: string, classId: string, contextId: string, schoolYearId = YEAR_ID, archived = false): AnnualCourse {
  return {
    id,
    schoolYearId,
    classId,
    contextId,
    isArchived: archived,
    archivedAt: archived ? "2026-08-01T00:00:00.000Z" : null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

function tca(
  id: string,
  annualCourseId: string,
  patch: Partial<TeacherCourseAssignment> = {},
): TeacherCourseAssignment {
  return {
    id,
    annualCourseId,
    teacherId: FRANCOIS.id,
    role: "PRIMARY",
    validFrom: "2026-08-01T00:00:00.000Z",
    validTo: null,
    createdByAdminId: "admin-1",
    createdAt: "2026-08-01T00:00:00.000Z",
    endedAt: null,
    overrideReason: null,
    overrideByAdminId: null,
    ...patch,
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

const mma1a = schoolClass("sc-mma1a", "MMA1A", { sortOrder: 1 });
const mecauto = schoolClass("sc-mecauto", "MECAUTO3A", { sortOrder: 2 });
const ma3a = schoolClass("sc-ma3a", "MA3A", {
  sortOrder: 3,
  isActive: false,
  isArchived: true,
  archivedAt: "2026-09-01T00:00:00.000Z",
});
const inactiveClass = schoolClass("sc-off", "OFF1A", { sortOrder: 4, isActive: false, isArchived: false });
const prevClass = schoolClass("sc-mma1a-prev", "MMA1A", {
  id: "sc-mma1a-prev",
  schoolYearId: PREV_YEAR_ID,
  schoolYearLabel: "2025-2026",
  sortOrder: 1,
});

const courses = [
  course("ac-mma1a-moteur", mma1a.id, "ctx-moteur"),
  course("ac-mma1a-trans", mma1a.id, "ctx-trans"),
  course("ac-mecauto-moteur", mecauto.id, "ctx-moteur"),
  course("ac-ma3a-moteur", ma3a.id, "ctx-moteur"),
  course("ac-ended", mma1a.id, "ctx-moteur"),
  course("ac-inactive-class", inactiveClass.id, "ctx-moteur"),
  course("ac-archived-course", mma1a.id, "ctx-trans", YEAR_ID, true),
  course("ac-prev", prevClass.id, "ctx-moteur", PREV_YEAR_ID),
  course("ac-future", mecauto.id, "ctx-trans"),
];

const assignments = [
  tca("a-mma1a-moteur", "ac-mma1a-moteur"),
  tca("a-mma1a-trans", "ac-mma1a-trans"),
  tca("a-mecauto-moteur", "ac-mecauto-moteur"),
  tca("a-ma3a-moteur", "ac-ma3a-moteur"),
  tca("a-ended", "ac-ended", { endedAt: "2026-09-01T00:00:00.000Z", validTo: "2026-08-31T23:59:59.000Z" }),
  tca("a-inactive-class", "ac-inactive-class"),
  tca("a-archived-course", "ac-archived-course"),
  tca("a-prev", "ac-prev"),
  tca("a-future", "ac-future", { validFrom: "2027-01-01T00:00:00.000Z" }),
];

const classes = [mma1a, mecauto, ma3a, inactiveClass, prevClass];

function rowsFor(
  teacher: { id: string; isActive: boolean; isArchived: boolean },
  includeHistory: boolean,
  extraAssignments: TeacherCourseAssignment[] = assignments,
) {
  return listTeacherAssignmentOverviewRows({
    teacher,
    assignments: extraAssignments,
    courses,
    classes,
    years,
    contexts,
    branches,
    includeHistory,
    at: AT,
  });
}

function line(row: ReturnType<typeof rowsFor>[number]) {
  const context = row.course ? contexts.find((entry) => entry.id === row.course?.contextId) : undefined;
  const branch = context ? branches.find((entry) => entry.id === context.branchId) : undefined;
  return formatTeacherAssignmentOverviewLine(row, branch?.label ?? "Branche");
}

test("version 2.38.0 — vue enseignant opérationnelle, pas de migration", async () => {
  assert.equal(APP_VERSION, "2.40.0");
  assert.equal(SQL_MIGRATION_FILES.at(-1), "0024_structured_agenda_bridge.sql");
  const [panel, css, helper, workspace, classrooms] = await Promise.all([
    readFile(new URL("../web/app/components/annual-courses-admin-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../src/features/annual-courses/operational-assignment.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/teacher-workspace/queries.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/control-planning/classrooms.ts", import.meta.url), "utf8"),
  ]);
  assert.match(panel, /showAssignmentHistory/);
  assert.match(panel, /useState\(false\)/);
  assert.match(panel, /TEACHER_ASSIGNMENT_HISTORY_CHECKBOX_LABEL/);
  assert.match(panel, /listTeacherAssignmentOverviewRows/);
  assert.match(panel, /is-historical/);
  assert.match(panel, /is-operational/);
  assert.match(panel, /TEACHER_ASSIGNMENT_EMPTY_ACTIVE_MESSAGE/);
  assert.doesNotMatch(panel, /data\.assignments\.filter\(\(entry\) => entry\.teacherId === teacher\.id\)/);
  assert.match(css, /\.annual-course-teachers li\.is-historical/);
  assert.match(css, /opacity/);
  assert.match(css, /\.annual-course-teachers li\.is-operational/);
  assert.match(helper, /isOperationalTeacherCourseAssignment/);
  assert.doesNotMatch(helper, /deleteAssignment|endAssignment|archiveAnnualCourse/);
  assert.match(workspace, /isOperationalSchoolClass/);
  assert.match(classrooms, /buildTeacherCourseWorkspace/);
  assert.equal(TEACHER_ASSIGNMENT_HISTORY_CHECKBOX_LABEL, "Afficher l’historique");
  assert.equal(TEACHER_ASSIGNMENT_EMPTY_ACTIVE_MESSAGE, "Aucune attribution active");
});

test("1 — enseignant actif + attribution active année actuelle → visible par défaut", () => {
  const rows = rowsFor(FRANCOIS, false);
  assert.ok(rows.some((row) => row.schoolClass?.code === "MMA1A" && row.operational));
  assert.equal(teacherVisibleInAssignmentOverview(FRANCOIS, false), true);
});

test("2 — attribution terminée → invisible par défaut", () => {
  const rows = rowsFor(FRANCOIS, false);
  assert.equal(rows.some((row) => row.assignment.id === "a-ended"), false);
});

test("3 — classe archivée → invisible par défaut", () => {
  const rows = rowsFor(FRANCOIS, false);
  assert.equal(rows.some((row) => row.schoolClass?.code === "MA3A"), false);
});

test("4 — classe désactivée → invisible par défaut", () => {
  const rows = rowsFor(FRANCOIS, false);
  assert.equal(rows.some((row) => row.assignment.id === "a-inactive-class"), false);
});

test("5 — AnnualCourse archivé → invisible par défaut", () => {
  const rows = rowsFor(FRANCOIS, false);
  assert.equal(rows.some((row) => row.assignment.id === "a-archived-course"), false);
});

test("6 — ancienne année scolaire → invisible par défaut", () => {
  const rows = rowsFor(FRANCOIS, false);
  assert.equal(rows.some((row) => row.assignment.id === "a-prev"), false);
});

test("7 — TCA future → invisible par défaut", () => {
  const rows = rowsFor(FRANCOIS, false);
  assert.equal(rows.some((row) => row.assignment.id === "a-future"), false);
});

test("8 — enseignant archivé → invisible par défaut", () => {
  const archived = { id: FRANCOIS.id, isActive: false, isArchived: true };
  assert.equal(teacherVisibleInAssignmentOverview(archived, false), false);
  assert.equal(teacherVisibleInAssignmentOverview(archived, true), true);
  assert.equal(
    isOperationalTeacherCourseAssignment({
      teacher: archived,
      assignment: assignments[0]!,
      course: courses[0],
      schoolClass: mma1a,
      years,
      context: contexts[0],
      branch: branches[0],
      at: AT,
    }),
    false,
  );
});

test("9 — enseignant actif sans cours → visible avec Aucune attribution active", () => {
  const idle = { id: "teacher-idle", isActive: true, isArchived: false };
  assert.equal(teacherVisibleInAssignmentOverview(idle, false), true);
  const rows = rowsFor(idle, false);
  assert.equal(rows.length, 0);
  assert.equal(TEACHER_ASSIGNMENT_EMPTY_ACTIVE_MESSAGE, "Aucune attribution active");
});

test("10 — case Afficher l’historique décochée par défaut", async () => {
  const panel = await readFile(new URL("../web/app/components/annual-courses-admin-panel.tsx", import.meta.url), "utf8");
  assert.match(panel, /const \[showAssignmentHistory, setShowAssignmentHistory\] = useState\(false\)/);
});

test("11 / 12 / 13 — historique coché : classe archivée, terminée, ancienne année", () => {
  const rows = rowsFor(FRANCOIS, true);
  const archived = rows.find((row) => row.assignment.id === "a-ma3a-moteur");
  const ended = rows.find((row) => row.assignment.id === "a-ended");
  const previous = rows.find((row) => row.assignment.id === "a-prev");
  assert.ok(archived);
  assert.equal(archived?.operational, false);
  assert.equal(assignmentDisplayLabel(archived!.displayStatus), "Classe archivée");
  assert.ok(ended);
  assert.equal(ended?.operational, false);
  assert.equal(assignmentDisplayLabel(ended!.displayStatus), "Terminée");
  assert.ok(previous);
  assert.equal(previous?.operational, false);
  assert.notEqual(assignmentDisplayLabel(previous!.displayStatus), "Active");
});

test("14 / 15 — historique atténué, attribution active prioritaire", async () => {
  const css = await readFile(new URL("../web/app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.annual-course-teachers li\.is-historical[\s\S]{0,80}opacity/);
  assert.match(css, /\.annual-course-teachers li\.is-operational/);
  const rows = rowsFor(FRANCOIS, true);
  const firstHistorical = rows.findIndex((row) => !row.operational);
  const lastOperational = rows.reduce((index, row, current) => (row.operational ? current : index), -1);
  assert.ok(lastOperational >= 0);
  assert.ok(firstHistorical > lastOperational);
});

test("16 — PR67 : MA3A archivée n’est jamais Active", () => {
  const status = assignmentDisplayStatus(tca("a-ma3a-moteur", "ac-ma3a-moteur"), {
    schoolClass: ma3a,
    courseSchoolYearId: YEAR_ID,
    activeSchoolYearId: YEAR_ID,
    at: AT,
  });
  assert.equal(assignmentDisplayLabel(status), "Classe archivée");
  assert.notEqual(assignmentDisplayLabel(status), "Active");
  const withHistory = rowsFor(FRANCOIS, true).find((row) => row.schoolClass?.code === "MA3A");
  assert.equal(withHistory?.displayStatus, "class-archived");
});

test("17 / 18 — Mes cours et Contrôles non régressés", () => {
  const workspace = buildTeacherCourseWorkspace({
    teacherId: FRANCOIS.id,
    schoolYearId: YEAR_ID,
    at: AT,
    assignments,
    courses,
    classes,
    contexts,
    branches,
    years: [
      {
        id: YEAR_ID,
        label: "2026-2027",
        status: "active",
        startsOn: "2026-08-17",
        endsOn: "2027-07-02",
        sourceFilename: "seed",
        importedAt: "2026-08-01T00:00:00.000Z",
        activatedAt: "2026-08-01T00:00:00.000Z",
        createdAt: "2026-08-01T00:00:00.000Z",
      },
      {
        id: PREV_YEAR_ID,
        label: "2025-2026",
        status: "archived",
        startsOn: "2025-08-17",
        endsOn: "2026-07-02",
        sourceFilename: "seed",
        importedAt: "2025-08-01T00:00:00.000Z",
        activatedAt: "2025-08-01T00:00:00.000Z",
        createdAt: "2025-08-01T00:00:00.000Z",
      },
    ],
  });
  assert.deepEqual(
    workspace.courses.map((entry) => `${entry.classCode}:${entry.branchLabel}`).sort(),
    ["MECAUTO3A:Moteur VL", "MMA1A:Moteur VL", "MMA1A:Transmission"].sort(),
  );
  assert.equal(workspace.courses.some((entry) => entry.classCode === "MA3A"), false);
  const assigned = listAssignedStructuredPlanningClassrooms({
    teacherId: FRANCOIS.id,
    classrooms: [
      { id: "rt-mma1a", name: "MMA1A", schoolClassId: mma1a.id },
      { id: "rt-mecauto", name: "MECAUTO3A", schoolClassId: mecauto.id },
      { id: "rt-ma3a", name: "MA3A", schoolClassId: ma3a.id },
    ],
    classes,
    courses,
    assignments,
    years: workspace.courses.length
      ? [
          {
            id: YEAR_ID,
            label: "2026-2027",
            status: "active",
            startsOn: "2026-08-17",
            endsOn: "2027-07-02",
            sourceFilename: "seed",
            importedAt: "2026-08-01T00:00:00.000Z",
            activatedAt: "2026-08-01T00:00:00.000Z",
            createdAt: "2026-08-01T00:00:00.000Z",
          },
        ]
      : [],
    contexts,
    branches,
    schoolYearId: YEAR_ID,
    at: AT,
  });
  assert.deepEqual(assigned.map((entry) => entry.name).sort(), ["MECAUTO3A", "MMA1A"]);
  assert.equal(assignedSchoolClassIdsFromTeacherCourses(workspace.courses).includes(ma3a.id), false);
});

test("19 / 20 — aucune suppression historique, cas François Cheseaux", () => {
  assert.equal(assignments.some((entry) => entry.id === "a-ma3a-moteur" && entry.endedAt === null), true);
  assert.equal(courses.find((entry) => entry.id === "ac-ma3a-moteur")?.isArchived, false);
  const active = rowsFor(FRANCOIS, false);
  assert.deepEqual(active.map((row) => line(row)), [
    "MMA1A → Moteur VL → Titulaire · Active",
    "MMA1A → Transmission → Titulaire · Active",
    "MECAUTO3A → Moteur VL → Titulaire · Active",
  ]);
  const withHistory = rowsFor(FRANCOIS, true);
  const historicalMa3a = withHistory.find((row) => row.schoolClass?.code === "MA3A");
  assert.ok(historicalMa3a);
  assert.equal(historicalMa3a?.operational, false);
  assert.equal(line(historicalMa3a!), "MA3A → Moteur VL → Titulaire · Classe archivée");
  assert.ok(withHistory.filter((row) => row.operational).length >= 3);
});
