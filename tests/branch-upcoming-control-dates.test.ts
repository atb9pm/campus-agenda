import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { PrototypeAgendaItem } from "../src/features/agenda/demo-items.ts";
import { upcomingControlLinksForAnnualCourses } from "../src/features/agenda-bridge/control-links.ts";
import type { AnnualCourse } from "../src/features/annual-courses/types.ts";
import type { SchoolWeek } from "../src/features/calendar/types.ts";
import {
  calendarDateKey,
  listFutureTestsForClass,
} from "../src/features/evaluations/coordination.ts";
import {
  MAX_UPCOMING_CONTROL_DATES_REASON,
  parseMaxUpcomingControlDates,
} from "../src/features/school-catalog/control-dates.ts";
import type { PedagogicalContextRecord } from "../src/features/school-catalog/profession-types.ts";
import type { SchoolBranchRecord } from "../src/features/school-catalog/types.ts";
import {
  buildStudentCourseDaySections,
  groupControlPlanning,
  nextControlDatePerSubject,
  upcomingTestsForAnnualCourse,
  type UpcomingControlBranchLink,
} from "../src/features/student/index.ts";
import {
  getMemorySchoolCatalogStore,
  resetMemorySchoolCatalogStore,
} from "../src/lib/persistence/memory-school-catalog-store.ts";
import { projectBackupRow } from "../src/lib/persistence/sql/sql-campus-backup.ts";
import { createNodeSqliteDatabase } from "../src/lib/persistence/sql/adapters.ts";
import { applyMigrations } from "../src/lib/persistence/sql/migrate.ts";
import { SqlSchoolCatalogStore } from "../src/lib/persistence/sql/sql-school-catalog-store.ts";

const CLASS_A = "classroom-a";
const CLASS_B = "classroom-b";
const BG_ID = "branch-bg";
const FRENCH_ID = "branch-francais";
const LOOKALIKE_ID = "branch-bg-culture";
const BG_COURSE = "annual-bg";
const FRENCH_COURSE = "annual-francais";
const LOOKALIKE_COURSE = "annual-bg-culture";
const OTHER_YEAR_COURSE = "annual-bg-other-year";

function monday(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year!, month! - 1, day, 12);
}

const WEEKS: SchoolWeek[] = [
  { number: 11, kind: "A", monday: monday("2026-11-09") },
  { number: 12, kind: "A", monday: monday("2026-11-16") },
  { number: 13, kind: "B", monday: monday("2026-11-23") },
  { number: 14, kind: "A", monday: monday("2026-11-30") },
];

function branch(id: string, label: string, max: 1 | 2): SchoolBranchRecord {
  return {
    id,
    code: label.toUpperCase(),
    label,
    sortOrder: 1,
    isActive: true,
    adminCode: "BR-0099",
    isArchived: false,
    archivedAt: null,
    teachingType: "GENERAL",
    maxUpcomingControlDates: max,
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

function context(id: string, branchId: string): PedagogicalContextRecord {
  return {
    id,
    adminCode: "CTX-0099",
    professionId: "profession-1",
    trainingYear: 1,
    branchId,
    isActive: true,
    isArchived: false,
    archivedAt: null,
  };
}

const OTHER_YEAR_BRANCH = "branch-bg-2027";

const BRANCHES = [
  branch(BG_ID, "BG", 2),
  branch(FRENCH_ID, "Français", 1),
  branch(LOOKALIKE_ID, "BG culture", 1),
  branch(OTHER_YEAR_BRANCH, "BG", 1),
];

const CONTEXTS = [
  context("ctx-bg", BG_ID),
  context("ctx-francais", FRENCH_ID),
  context("ctx-lookalike", LOOKALIKE_ID),
  context("ctx-other-year", OTHER_YEAR_BRANCH),
];

const COURSES = [
  course(BG_COURSE, "class-a", "ctx-bg", "year-2026"),
  course(FRENCH_COURSE, "class-a", "ctx-francais", "year-2026"),
  course(LOOKALIKE_COURSE, "class-a", "ctx-lookalike", "year-2026"),
  course("annual-bg-class-b", "class-b", "ctx-bg", "year-2026"),
  course(OTHER_YEAR_COURSE, "class-a", "ctx-other-year", "year-2027"),
];

function linksFor(ids: string[]): UpcomingControlBranchLink[] {
  return upcomingControlLinksForAnnualCourses({
    annualCourseIds: ids,
    courses: COURSES,
    contexts: CONTEXTS,
    branches: BRANCHES,
  });
}

function item(
  partial: Partial<PrototypeAgendaItem> & Pick<PrototypeAgendaItem, "id" | "title" | "subjectId" | "schoolWeekNumber" | "day">,
): PrototypeAgendaItem {
  return {
    classroomId: CLASS_A,
    authorTeacherId: "teacher-1",
    hour: 8,
    weekOffset: 0,
    type: "TEST",
    detail: "",
    studentVisible: true,
    ...partial,
  };
}

function catalogFor(classroomId: string) {
  return {
    classrooms: [{ id: classroomId, name: classroomId, programLabel: "", accessCodeHint: "" }],
    subjects: [
      { id: "subject-bg", name: "BG", classroomId, annualCourseId: BG_COURSE },
      { id: "subject-fr", name: "Français", classroomId, annualCourseId: FRENCH_COURSE },
      { id: "subject-look", name: "BG culture", classroomId, annualCourseId: LOOKALIKE_COURSE },
    ],
    memberships: [],
    teachers: [],
  };
}

function visible(
  items: PrototypeAgendaItem[],
  from: Date,
  classroomId = CLASS_A,
  links = linksFor(items.map((entry) => entry.annualCourseId ?? "")),
) {
  return nextControlDatePerSubject(
    listFutureTestsForClass(items, catalogFor(classroomId), classroomId, from, WEEKS),
    links,
  );
}

const SOCIETE_17 = item({
  id: 1,
  title: "Société",
  subjectId: "subject-bg",
  annualCourseId: BG_COURSE,
  schoolWeekNumber: 12,
  day: 1,
});
const LANGUE_24 = item({
  id: 2,
  title: "Langue",
  subjectId: "subject-bg",
  annualCourseId: BG_COURSE,
  schoolWeekNumber: 13,
  day: 1,
});
const SOCIETE_01 = item({
  id: 3,
  title: "Société",
  subjectId: "subject-bg",
  annualCourseId: BG_COURSE,
  schoolWeekNumber: 14,
  day: 1,
});
const PAST = item({
  id: 4,
  title: "Passé",
  subjectId: "subject-bg",
  annualCourseId: BG_COURSE,
  schoolWeekNumber: 11,
  day: 1,
});
const DRAFT = item({
  id: 5,
  title: "Brouillon",
  subjectId: "subject-bg",
  annualCourseId: BG_COURSE,
  schoolWeekNumber: 12,
  day: 1,
  studentVisible: false,
});

test("catalogue — branche existante et nouvelle branche valent 1, puis 2, puis 1", async () => {
  resetMemorySchoolCatalogStore();
  const memory = getMemorySchoolCatalogStore();
  const seeded = await memory.listBranches();
  assert.ok(seeded.length > 0);
  assert.ok(seeded.every((entry) => entry.maxUpcomingControlDates === 1));
  const created = await memory.createBranch({ code: "BG", label: "BG", teachingType: "GENERAL" });
  assert.equal(created.maxUpcomingControlDates, 1);
  assert.equal(created.teachingType, "GENERAL");
  const raised = await memory.updateBranch(created.id, { maxUpcomingControlDates: 2 });
  assert.equal(raised?.maxUpcomingControlDates, 2);
  assert.equal(raised?.label, "BG");
  const lowered = await memory.updateBranch(created.id, { maxUpcomingControlDates: 1 });
  assert.equal(lowered?.maxUpcomingControlDates, 1);
  await assert.rejects(
    () => memory.updateBranch(created.id, { maxUpcomingControlDates: 3 as never }),
    new RegExp(MAX_UPCOMING_CONTROL_DATES_REASON),
  );
  assert.equal(parseMaxUpcomingControlDates(0).ok, false);
  assert.equal(parseMaxUpcomingControlDates("2").ok, false);

  const db = createNodeSqliteDatabase(":memory:");
  await applyMigrations(db);
  const sql = new SqlSchoolCatalogStore(db);
  const existing = await sql.listBranches();
  assert.ok(existing.every((entry) => entry.maxUpcomingControlDates === 1));
  const sqlCreated = await sql.createBranch({ code: "MATH", label: "Mathématiques", teachingType: "GENERAL" });
  assert.equal(sqlCreated.maxUpcomingControlDates, 1);
  const row = await db
    .prepare("SELECT max_upcoming_control_dates AS max FROM school_branches WHERE id = ?")
    .bind(sqlCreated.id)
    .first<{ max: number }>();
  assert.equal(row?.max, 1);
  const sqlRaised = await sql.updateBranch(sqlCreated.id, { maxUpcomingControlDates: 2 });
  assert.equal(sqlRaised?.maxUpcomingControlDates, 2);
  await assert.rejects(
    () => db.prepare("UPDATE school_branches SET max_upcoming_control_dates = 3 WHERE id = ?").bind(sqlCreated.id).run(),
    /CHECK|constraint/i,
  );
});

test("affichage — une date, deux dates, même jour, lendemain, semaines A/B", () => {
  const from14 = monday("2026-11-14");
  const items = [SOCIETE_01, LANGUE_24, SOCIETE_17, PAST, DRAFT];
  const oneDate = visible(items, from14, CLASS_A, []);
  assert.deepEqual(oneDate.map((entry) => entry.item.title), ["Société"]);
  assert.equal(calendarDateKey(oneDate[0]!.slot.date), "2026-11-17");

  const twoDates = visible(items, from14);
  assert.deepEqual(twoDates.map((entry) => entry.item.title), ["Société", "Langue"]);
  assert.deepEqual(twoDates.map((entry) => calendarDateKey(entry.slot.date)), ["2026-11-17", "2026-11-24"]);
  assert.deepEqual(twoDates.map((entry) => entry.slot.weekKind), ["A", "B"]);
  assert.equal(new Set(twoDates.map((entry) => entry.item.id)).size, twoDates.length);

  const sameDay = item({
    id: 6,
    title: "Histoire",
    subjectId: "subject-bg",
    annualCourseId: BG_COURSE,
    schoolWeekNumber: 12,
    day: 1,
  });
  const threeOnTwoDates = visible([SOCIETE_17, sameDay, LANGUE_24, SOCIETE_01], from14);
  assert.deepEqual(
    threeOnTwoDates.map((entry) => entry.item.id).sort((left, right) => left - right),
    [SOCIETE_17.id, sameDay.id, LANGUE_24.id].sort((left, right) => left - right),
  );
  assert.deepEqual(
    [...new Set(threeOnTwoDates.map((entry) => calendarDateKey(entry.slot.date)))],
    ["2026-11-17", "2026-11-24"],
  );

  const onlyTwo = visible([SOCIETE_17, LANGUE_24, SOCIETE_01], from14);
  assert.deepEqual(onlyTwo.map((entry) => entry.item.id), [SOCIETE_17.id, LANGUE_24.id]);

  const from18 = visible([SOCIETE_17, LANGUE_24, SOCIETE_01], monday("2026-11-18"));
  assert.deepEqual(from18.map((entry) => calendarDateKey(entry.slot.date)), ["2026-11-24", "2026-12-01"]);
  assert.ok(!from18.some((entry) => entry.item.id === PAST.id || entry.item.id === DRAFT.id));
});

test("affichage — branches, classes et noms proches restent séparés", () => {
  const from14 = monday("2026-11-14");
  const french = item({
    id: 11,
    title: "Dictée",
    subjectId: "subject-fr",
    annualCourseId: FRENCH_COURSE,
    schoolWeekNumber: 12,
    day: 2,
  });
  const frenchLater = item({
    id: 12,
    title: "Rédaction",
    subjectId: "subject-fr",
    annualCourseId: FRENCH_COURSE,
    schoolWeekNumber: 13,
    day: 2,
  });
  const lookalike = item({
    id: 13,
    title: "BG",
    subjectId: "subject-look",
    annualCourseId: LOOKALIKE_COURSE,
    schoolWeekNumber: 12,
    day: 3,
  });
  const lookalikeLater = item({
    id: 14,
    title: "Culture",
    subjectId: "subject-look",
    annualCourseId: LOOKALIKE_COURSE,
    schoolWeekNumber: 14,
    day: 3,
  });
  const otherYear = item({
    id: 15,
    title: "BG autre année",
    subjectId: "subject-bg",
    annualCourseId: OTHER_YEAR_COURSE,
    schoolWeekNumber: 12,
    day: 1,
  });
  const otherYearLater = item({
    id: 16,
    title: "Suite autre année",
    subjectId: "subject-bg",
    annualCourseId: OTHER_YEAR_COURSE,
    schoolWeekNumber: 13,
    day: 1,
  });
  const shown = visible([
    SOCIETE_17,
    LANGUE_24,
    SOCIETE_01,
    french,
    frenchLater,
    lookalike,
    lookalikeLater,
    otherYear,
    otherYearLater,
  ], from14);
  assert.deepEqual(
    shown.filter((entry) => entry.item.annualCourseId === BG_COURSE).map((entry) => entry.item.id),
    [SOCIETE_17.id, LANGUE_24.id],
  );
  assert.deepEqual(
    shown.filter((entry) => entry.item.annualCourseId === FRENCH_COURSE).map((entry) => entry.item.id),
    [french.id],
  );
  assert.deepEqual(
    shown.filter((entry) => entry.item.annualCourseId === LOOKALIKE_COURSE).map((entry) => entry.item.id),
    [lookalike.id],
  );
  assert.deepEqual(
    shown.filter((entry) => entry.item.annualCourseId === OTHER_YEAR_COURSE).map((entry) => entry.item.id),
    [otherYear.id],
  );

  const classB = [
    item({
      id: 21,
      classroomId: CLASS_B,
      title: "Société B",
      subjectId: "subject-bg",
      annualCourseId: "annual-bg-class-b",
      schoolWeekNumber: 12,
      day: 1,
    }),
    item({
      id: 22,
      classroomId: CLASS_B,
      title: "Langue B",
      subjectId: "subject-bg",
      annualCourseId: "annual-bg-class-b",
      schoolWeekNumber: 13,
      day: 1,
    }),
    item({
      id: 23,
      classroomId: CLASS_B,
      title: "Décembre B",
      subjectId: "subject-bg",
      annualCourseId: "annual-bg-class-b",
      schoolWeekNumber: 14,
      day: 1,
    }),
  ];
  const classBShown = visible(classB, from14, CLASS_B, linksFor(["annual-bg-class-b"]));
  assert.deepEqual(classBShown.map((entry) => entry.item.id), [21, 22]);

  const unresolved = item({
    id: 30,
    title: "BG",
    subjectId: "subject-bg",
    schoolWeekNumber: 12,
    day: 1,
  });
  const unresolvedLater = item({
    id: 31,
    title: "Suite",
    subjectId: "subject-bg",
    schoolWeekNumber: 13,
    day: 1,
  });
  const withoutLink = visible([unresolved, unresolvedLater], from14, CLASS_A, linksFor([BG_COURSE]));
  assert.deepEqual(withoutLink.map((entry) => entry.item.id), [unresolved.id]);

  const ambiguous = nextControlDatePerSubject(
    listFutureTestsForClass([SOCIETE_17, LANGUE_24], catalogFor(CLASS_A), CLASS_A, from14, WEEKS),
    [
      { annualCourseId: BG_COURSE, branchId: BG_ID, maxUpcomingControlDates: 2 },
      { annualCourseId: BG_COURSE, branchId: FRENCH_ID, maxUpcomingControlDates: 1 },
    ],
  );
  assert.deepEqual(ambiguous.map((entry) => entry.item.id), [SOCIETE_17.id]);
});

test("aperçu et onglets — la même fenêtre, sans doublon, sans règle BG", () => {
  const from14 = monday("2026-11-14");
  const future = listFutureTestsForClass(
    [SOCIETE_17, LANGUE_24, SOCIETE_01],
    catalogFor(CLASS_A),
    CLASS_A,
    from14,
    WEEKS,
  );
  const links = linksFor([BG_COURSE]);
  const student = nextControlDatePerSubject(future, links);
  const preview = upcomingTestsForAnnualCourse(student, BG_COURSE);
  assert.deepEqual(preview.map((entry) => entry.item.id), student.map((entry) => entry.item.id));
  assert.equal(preview.length, 2);
  const sections = buildStudentCourseDaySections([], catalogFor(CLASS_A).subjects, future, { controlLinks: links });
  const bg = sections.find((section) => section.subject.id === "subject-bg");
  assert.deepEqual(bg?.nextControls.map((entry) => entry.item.id), [SOCIETE_17.id, LANGUE_24.id]);
  const planning = groupControlPlanning(student);
  const planned = planning.flatMap((week) => week.days.flatMap((day) => day.entries.map((entry) => entry.item.id)));
  assert.deepEqual(planned, [SOCIETE_17.id, LANGUE_24.id]);
  assert.equal(new Set(planned).size, planned.length);
});

test("sauvegarde — la colonne est conservée et une ancienne ligne reste à 1", async () => {
  const base = {
    id: "branch-restore",
    code: "BG1",
    label: "BG",
    is_active: 1,
  };
  const omitted = projectBackupRow("school_branches", base);
  assert.equal(omitted.ok, true);
  if (!omitted.ok) return;
  assert.equal(omitted.columns.includes("max_upcoming_control_dates"), false);
  const kept = projectBackupRow("school_branches", {
    ...base,
    id: "branch-restore-2",
    code: "BG2",
    max_upcoming_control_dates: 2,
  });
  assert.equal(kept.ok, true);
  if (!kept.ok) return;
  assert.equal(kept.values[kept.columns.indexOf("max_upcoming_control_dates")], 2);

  const db = createNodeSqliteDatabase(":memory:");
  await applyMigrations(db);
  const insert = (projected: { columns: string[]; values: unknown[] }) => db
    .prepare(
      `INSERT INTO school_branches (${projected.columns.join(", ")}) VALUES (${projected.columns.map(() => "?").join(", ")})`,
    )
    .bind(...projected.values)
    .run();
  await insert(omitted);
  await insert(kept);
  const store = new SqlSchoolCatalogStore(db);
  const rows = await store.listBranches();
  assert.equal(rows.find((entry) => entry.id === "branch-restore")?.maxUpcomingControlDates, 1);
  assert.equal(rows.find((entry) => entry.id === "branch-restore-2")?.maxUpcomingControlDates, 2);

  resetMemorySchoolCatalogStore();
  const memory = getMemorySchoolCatalogStore();
  memory.replaceSnapshot({
    classes: [],
    branches: [{ ...branch("branch-old", "Ancienne", 1), maxUpcomingControlDates: undefined as never }],
    professions: [],
    contexts: [],
  });
  assert.equal((await memory.listBranches())[0]?.maxUpcomingControlDates, 1);
});

test("accès et vues — le réglage reste dans l’administration, les vues élève ne changent pas de structure", async () => {
  const [catalogRoute, patchRoute, panel, agendaRoute, page, controls, dashboard, logic] = await Promise.all([
    readFile(new URL("../web/app/api/admin/catalog/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/app/api/admin/catalog/[id]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/app/components/administration-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/api/agenda/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/components/student-controls-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/components/student-dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/student/upcoming-controls.ts", import.meta.url), "utf8"),
  ]);
  assert.match(patchRoute, /requireAdminSession/);
  assert.match(catalogRoute, /requireAdminSession/);
  assert.match(patchRoute, /parseMaxUpcomingControlDates/);
  assert.match(panel, /Affichage des contrôles à venir/);
  assert.match(panel, /Nombre de prochaines dates visibles/);
  assert.match(panel, /2 dates/);
  assert.match(agendaRoute, /upcomingControlLinksForAnnualCourses/);
  assert.match(page, /nextControlDatePerSubject\(\s*listFutureTestsForClass\(/);
  assert.match(page, /studentControlLinks/);
  assert.match(page, /upcomingTestsForAnnualCourse\(tests, previewAnnualCourseId\)/);
  assert.match(logic, /groupControlPlanning\(\s*nextControlDatePerSubject\(listFutureTestsForClass\(/);
  assert.doesNotMatch(logic, /label\s*===\s*["']BG["']/);
  assert.doesNotMatch(logic, /teachingType\s*===\s*["']GENERAL["']/);
  assert.doesNotMatch(controls, /maxUpcomingControlDates|admin-control-dates/);
  assert.doesNotMatch(dashboard, /maxUpcomingControlDates|admin-control-dates/);
  assert.match(controls, /student-next-control/);

  const { PATCH } = await import("../web/app/api/admin/catalog/[id]/route.ts");
  const response = await PATCH(
    new Request("http://campus.test/api/admin/catalog/branch-bg", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "branch", maxUpcomingControlDates: 2 }),
    }),
    { params: Promise.resolve({ id: "branch-bg" }) },
  );
  assert.equal(response.status, 401);
});
