/**
 * Validation bout-en-bout N → N+1 (#172–#180).
 * Aucune fonctionnalité nouvelle : le scénario exerce le flux réel
 * PREVIEW → APPLY → reclassement admin, en Memory et en SQLite.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { PrototypeAgendaItem } from "../src/features/agenda/demo-items.ts";
import { isVisibleToStudent } from "../src/features/agenda/visibility.ts";
import type { AnnualCourseMeetingDay } from "../src/features/annual-courses/meeting-days.ts";
import type { AnnualCourse, TeacherCourseAssignment } from "../src/features/annual-courses/types.ts";
import { evaluateAdminMfaAccess } from "../src/features/admin-mfa/guard.ts";
import {
  accessibleAnnualCourseIdsForTeacher,
  loadTeacherNotebookDocument,
} from "../src/features/class-notebook/annual-private-notes.ts";
import { authorizeAssignedCoursePublication } from "../src/features/class-notebook/notebook-publication-service.ts";
import { computeCourseSessions } from "../src/features/course-sessions/compute.ts";
import { formatCourseSessionPeriods } from "../src/features/course-sessions/format.ts";
import type { ClassAttendanceDay, CourseScheduleSlot, CourseWeekday } from "../src/features/course-schedule/types.ts";
import type { AnnualCourseNote } from "../src/features/pedagogical-path/annual-notes.ts";
import type { ReferencePedagogicalPath } from "../src/features/pedagogical-path/types.ts";
import { valaisHolidaysForSchoolYear } from "../src/features/school-days/holidays-valais.ts";
import { getStudentAgendaItems } from "../src/features/student/agenda.ts";
import type { SchoolWeekEntry } from "../src/features/school-year/types.ts";
import { yearTransitionConfigSignature } from "../src/features/year-transition/meeting-day-draft.ts";
import {
  YEAR_TRANSITION_RECLASSIFY_COMPLETE,
  YEAR_TRANSITION_RECLASSIFY_FORBIDDEN,
  applyAuthorizedYearTransition,
  applyPersistedYearTransition,
  applyYearTransitionReclassify,
  assembleLiveYearTransitionPreviewInput,
  createAuthorizedYearTransitionPreview,
  createPersistedYearTransitionPreview,
  listYearTransitionReclassifyQueue,
  loadYearTransitionPrepareState,
  YEAR_TRANSITION_REIMPORT_CONFIRMATION_REQUIRED,
  pendingTargetClassId,
  type ApplyPersistedYearTransitionDeps,
  type YearTransitionPrepareDeps,
  type YearTransitionReclassifyDeps,
  type YearTransitionTargetMeetingDayPlan,
} from "../src/features/year-transition/index.ts";
import { MemoryAgendaStore } from "../src/lib/persistence/memory-store.ts";
import { MemoryAnnualCourseStore } from "../src/lib/persistence/memory-annual-course-store.ts";
import {
  MemoryAnnualCourseNotesStore,
  MemoryPedagogicalPathStore,
} from "../src/lib/persistence/memory-pedagogical-path-store.ts";
import { MemoryCourseScheduleStore } from "../src/lib/persistence/memory-course-schedule-store.ts";
import { MemoryRuntimeAgendaAdapterStore } from "../src/lib/persistence/memory-runtime-adapter-store.ts";
import { MemorySchoolCatalogStore } from "../src/lib/persistence/memory-school-catalog-store.ts";
import {
  MemorySchoolYearStore,
  replaceMemorySchoolYears,
  resetMemorySchoolYearStore,
} from "../src/lib/persistence/memory-school-year-store.ts";
import { MemoryTeacherNotesStore } from "../src/lib/persistence/memory-teacher-notes-store.ts";
import { MemoryYearTransitionApplyStore } from "../src/lib/persistence/memory-year-transition-apply-store.ts";
import { MemoryYearTransitionPreviewStore } from "../src/lib/persistence/memory-year-transition-preview-store.ts";
import {
  replaceMemoryLegacySchool,
  resetMemoryLegacySchool,
} from "../src/lib/persistence/memory-legacy-school.ts";
import { createNodeSqliteDatabase } from "../src/lib/persistence/sql/adapters.ts";
import { applyMigrations } from "../src/lib/persistence/sql/migrate.ts";
import { SqlAgendaStore } from "../src/lib/persistence/sql/sql-agenda-store.ts";
import { SqlAnnualCourseStore } from "../src/lib/persistence/sql/sql-annual-course-store.ts";
import { SqlCourseScheduleStore } from "../src/lib/persistence/sql/sql-course-schedule-store.ts";
import {
  SqlAnnualCourseNotesStore,
  SqlPedagogicalPathStore,
} from "../src/lib/persistence/sql/sql-pedagogical-path-store.ts";
import { SqlRuntimeAgendaAdapterStore } from "../src/lib/persistence/sql/sql-runtime-adapter-store.ts";
import { SqlSchoolCatalogStore } from "../src/lib/persistence/sql/sql-school-catalog-store.ts";
import { SqlSchoolYearStore } from "../src/lib/persistence/sql/sql-school-year-store.ts";
import { SqlTeacherNotesStore } from "../src/lib/persistence/sql/sql-teacher-notes-store.ts";
import { SqlYearTransitionApplyStore } from "../src/lib/persistence/sql/sql-year-transition-apply-store.ts";
import { SqlYearTransitionPreviewStore } from "../src/lib/persistence/sql/sql-year-transition-preview-store.ts";
import type { AnnualCourseNotesStore } from "../src/lib/persistence/pedagogical-path-types.ts";
import type { AnnualCourseStore } from "../src/lib/persistence/annual-course-types.ts";
import type { CourseScheduleStore } from "../src/lib/persistence/course-schedule-types.ts";
import type { AgendaStore } from "../src/lib/persistence/types.ts";
import type { SchoolCatalogStore } from "../src/lib/persistence/school-catalog-types.ts";
import type { SchoolYearStore } from "../src/lib/persistence/school-year-types.ts";
import type { PedagogicalPathStore } from "../src/lib/persistence/pedagogical-path-types.ts";
import type { RuntimeAgendaAdapterStore } from "../src/lib/persistence/runtime-agenda-types.ts";
import { buildTeacherCourseWorkspace } from "../src/features/teacher-workspace/queries.ts";
import type { YearTransitionPreviewStore } from "../src/features/year-transition/store.ts";
import type { YearTransitionApplyStore } from "../src/features/year-transition/apply-types.ts";
import type { TeacherNotesStore } from "../src/lib/persistence/teacher-notes-types.ts";

const SOURCE_YEAR = "year-2026";
const TARGET_YEAR = "year-2027";
const TEACHER_A = "teacher-a";
const TEACHER_B = "teacher-b";
const TEACHER_NEW = "teacher-new";
const NOW = "2026-08-01T00:00:00.000Z";
const ADMIN = { isAdmin: true, kind: "admin" as const };
const TEACHER = { isAdmin: false, kind: "teacher" as const };
const STUDENT = { isAdmin: false, kind: "student" as const };

process.env.CAMPUS_DEMO_SEED = "false";

type CourseKey = "cp1" | "cp2" | "cp3" | "injection";

type Campus = {
  backend: "memory" | "sqlite";
  deps: ApplyPersistedYearTransitionDeps;
  catalog: SchoolCatalogStore;
  courses: AnnualCourseStore;
  schedules: CourseScheduleStore;
  notes: AnnualCourseNotesStore;
  agenda: AgendaStore;
  paths: PedagogicalPathStore;
  years: SchoolYearStore;
  adapters: RuntimeAgendaAdapterStore;
  previews: YearTransitionPreviewStore;
  applyStore: YearTransitionApplyStore;
  teacherNotes: TeacherNotesStore;
  classId: string;
  courseId: Record<CourseKey, string>;
  contextId: Record<CourseKey, string>;
  close: () => void;
};

function mondayWeeks(startMonday: string, count: number): SchoolWeekEntry[] {
  const weeks: SchoolWeekEntry[] = [];
  const [year, month, day] = startMonday.split("-").map(Number);
  const cursor = new Date(Date.UTC(year!, month! - 1, day!, 12));
  let number = 1;
  while (weeks.length < count) {
    const iso = cursor.toISOString().slice(0, 10);
    weeks.push({ number, kind: number % 2 === 1 ? "A" : "B", monday: iso });
    number += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  return weeks;
}

function isoWeekday(iso: string): number {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay();
}

function meetingDay(
  annualCourseId: string,
  dayOfWeek: CourseWeekday,
  weekKind: "all" | "A" | "B",
  role: "PRIMARY" | "ADDITIONAL",
): AnnualCourseMeetingDay {
  return {
    id: `md-${annualCourseId}-${dayOfWeek}-${weekKind}-${role}`,
    annualCourseId,
    dayOfWeek,
    weekKind,
    role,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function slot(
  id: string,
  annualCourseId: string,
  dayOfWeek: CourseWeekday,
  periodStart: number,
  periodEnd: number,
): CourseScheduleSlot {
  return {
    id,
    annualCourseId,
    dayOfWeek,
    periodStart,
    periodEnd,
    weekKind: "all",
    validFrom: null,
    validTo: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function assignment(id: string, annualCourseId: string, teacherId: string): TeacherCourseAssignment {
  return {
    id,
    annualCourseId,
    teacherId,
    role: "PRIMARY",
    validFrom: NOW,
    validTo: null,
    createdByAdminId: "admin-e2e",
    createdAt: NOW,
    endedAt: null,
    overrideReason: null,
    overrideByAdminId: null,
  };
}

function courseRecord(id: string, classId: string, contextId: string, schoolYearId = SOURCE_YEAR): AnnualCourse {
  return {
    id,
    schoolYearId,
    classId,
    contextId,
    isArchived: false,
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function reclassifyDeps(campus: Campus): YearTransitionReclassifyDeps {
  return {
    years: campus.years,
    catalog: campus.catalog,
    courses: campus.courses,
    agenda: campus.agenda,
    notes: campus.notes,
    schedules: campus.schedules,
  };
}

async function openCampus(backend: "memory" | "sqlite"): Promise<Omit<Campus, "classId" | "courseId" | "contextId">> {
  if (backend === "memory") {
    resetMemorySchoolYearStore();
    resetMemoryLegacySchool();
    replaceMemoryLegacySchool({ classrooms: [], subjects: [], memberships: [], studentAccesses: [] });
    const sourceWeeks = mondayWeeks("2026-08-17", 12);
    const targetWeeks = mondayWeeks("2027-08-23", 12);
    replaceMemorySchoolYears([
      {
        id: SOURCE_YEAR,
        label: "2026-2027",
        status: "active",
        startsOn: "2026-08-17",
        endsOn: "2027-07-02",
        sourceFilename: null,
        importedAt: null,
        activatedAt: NOW,
        createdAt: NOW,
        weeks: sourceWeeks,
      },
      {
        id: TARGET_YEAR,
        label: "2027-2028",
        status: "draft",
        startsOn: "2027-08-23",
        endsOn: "2028-07-01",
        sourceFilename: null,
        importedAt: null,
        activatedAt: null,
        createdAt: NOW,
        weeks: targetWeeks,
      },
    ]);
    const catalog = new MemorySchoolCatalogStore();
    const courses = new MemoryAnnualCourseStore();
    const schedules = new MemoryCourseScheduleStore();
    const notes = new MemoryAnnualCourseNotesStore();
    const agenda = new MemoryAgendaStore([]);
    const paths = new MemoryPedagogicalPathStore();
    const years = new MemorySchoolYearStore();
    const adapters = new MemoryRuntimeAgendaAdapterStore();
    const previews = new MemoryYearTransitionPreviewStore();
    const applyStore = new MemoryYearTransitionApplyStore(agenda, notes, schedules);
    const teacherNotes = new MemoryTeacherNotesStore();
    const deps: ApplyPersistedYearTransitionDeps = {
      notes,
      previews,
      applyStore,
      years,
      catalog,
      courses,
      agenda,
      paths,
      schedules,
      adapters,
      now: () => "2027-06-01T00:00:00.000Z",
    };
    return {
      backend,
      deps,
      catalog,
      courses,
      schedules,
      notes,
      agenda,
      paths,
      years,
      adapters,
      previews,
      applyStore,
      teacherNotes,
      close: () => undefined,
    };
  }

  process.env.CAMPUS_DEMO_SEED = "false";
  const db = createNodeSqliteDatabase(":memory:");
  await applyMigrations(db);
  const sourceWeeks = mondayWeeks("2026-08-17", 12);
  const targetWeeks = mondayWeeks("2027-08-23", 12);
  await db
    .prepare(
      `INSERT INTO school_years (id, label, status, starts_on, ends_on, created_at, activated_at)
       VALUES (?, ?, 'active', ?, ?, ?, ?)`,
    )
    .bind(SOURCE_YEAR, "2026-2027", "2026-08-17", "2027-07-02", NOW, NOW)
    .run();
  await db
    .prepare(
      `INSERT INTO school_years (id, label, status, starts_on, ends_on, created_at)
       VALUES (?, ?, 'draft', ?, ?, ?)`,
    )
    .bind(TARGET_YEAR, "2027-2028", "2027-08-23", "2028-07-01", NOW)
    .run();
  for (const [yearId, weeks] of [
    [SOURCE_YEAR, sourceWeeks],
    [TARGET_YEAR, targetWeeks],
  ] as const) {
    for (const week of weeks) {
      await db
        .prepare("INSERT INTO school_weeks (school_year_id, week_number, week_kind, monday) VALUES (?, ?, ?, ?)")
        .bind(yearId, week.number, week.kind, week.monday)
        .run();
    }
  }
  for (const teacher of [
    [TEACHER_A, "Prof A", "PA", 0],
    [TEACHER_B, "Prof B", "PB", 0],
    [TEACHER_NEW, "Prof Nouveau", "PN", 0],
    ["admin-e2e", "Admin", "AD", 1],
  ] as const) {
    await db
      .prepare(
        `INSERT INTO teachers (id, display_name, initials, password_hash, is_admin, is_active)
         VALUES (?, ?, ?, 'x', ?, 1)`,
      )
      .bind(teacher[0], teacher[1], teacher[2], teacher[3])
      .run();
  }
  const catalog = new SqlSchoolCatalogStore(db);
  const courses = new SqlAnnualCourseStore(db);
  const schedules = new SqlCourseScheduleStore(db);
  const notes = new SqlAnnualCourseNotesStore(db);
  const agenda = new SqlAgendaStore(db);
  const paths = new SqlPedagogicalPathStore(db);
  const years = new SqlSchoolYearStore(db);
  const adapters = new SqlRuntimeAgendaAdapterStore(db);
  const previews = new SqlYearTransitionPreviewStore(db);
  const applyStore = new SqlYearTransitionApplyStore(db);
  const teacherNotes = new SqlTeacherNotesStore(db);
  const deps: ApplyPersistedYearTransitionDeps = {
    notes,
    previews,
    applyStore,
    years,
    catalog,
    courses,
    agenda,
    paths,
    schedules,
    adapters,
    now: () => "2027-06-01T00:00:00.000Z",
  };
  return {
    backend,
    deps,
    catalog,
    courses,
    schedules,
    notes,
    agenda,
    paths,
    years,
    adapters,
    previews,
    applyStore,
    teacherNotes,
    close: () => db.close(),
  };
}

async function seedCatalog(base: Omit<Campus, "classId" | "courseId" | "contextId">): Promise<Campus> {
  const profession = await base.catalog.createProfession({
    label: "Mécanicien automobile",
    durationYears: 4,
    classCodePrefix: "MECAUTO",
    sortOrder: 1,
    isActive: true,
  });
  const branchLabels: Record<CourseKey, [string, string]> = {
    cp1: ["ELEC", "Électrotechnique"],
    cp2: ["TRAN", "Transmission"],
    cp3: ["CHAS", "Châssis"],
    injection: ["INJ", "Injection"],
  };
  const contextId = {} as Record<CourseKey, string>;
  for (const key of Object.keys(branchLabels) as CourseKey[]) {
    const [code, label] = branchLabels[key];
    const branch = await base.catalog.createBranch({
      code,
      label,
      sortOrder: 1,
      isActive: true,
      teachingType: "TECHNICAL",
    });
    const created = await base.catalog.createContext({
      professionId: profession.id,
      trainingYear: 3,
      branchId: branch.id,
      isActive: true,
    });
    if (!created.ok) throw new Error(created.reason);
    contextId[key] = created.value.id;
  }
  const schoolClass = await base.catalog.createClass({
    code: "MECAUTO3A",
    label: "MECAUTO 3A",
    schoolYearId: SOURCE_YEAR,
    schoolYearLabel: "2026-2027",
    professionId: profession.id,
    trainingYear: 3,
    parallelCode: "A",
    isActive: true,
  });
  const courseId: Record<CourseKey, string> = {
    cp1: "ac-cp1-n",
    cp2: "ac-cp2-n",
    cp3: "ac-cp3-n",
    injection: "ac-injection-n",
  };
  for (const key of Object.keys(courseId) as CourseKey[]) {
    await base.courses.createCourse(courseRecord(courseId[key], schoolClass.id, contextId[key]));
    await base.courses.createAssignment(assignment(`asg-${key}`, courseId[key], TEACHER_A));
  }
  await base.adapters.upsertClassroom({
    id: "rt-mecauto-n",
    name: "MECAUTO3A",
    programLabel: "Mécanique",
    accessCodeHint: "meca",
    schoolClassId: schoolClass.id,
  });
  for (const key of Object.keys(courseId) as CourseKey[]) {
    await base.adapters.upsertSubject({
      id: `subj-${key}`,
      classroomId: "rt-mecauto-n",
      name: branchLabels[key][1],
      annualCourseId: courseId[key],
    });
  }
  return { ...base, classId: schoolClass.id, courseId, contextId };
}

async function sourceSessions(campus: Campus, key: CourseKey) {
  const year = await campus.years.getSchoolYearById(SOURCE_YEAR);
  assert.ok(year);
  const course = await campus.courses.getCourse(campus.courseId[key]);
  assert.ok(course);
  return computeCourseSessions({
    schoolYearId: SOURCE_YEAR,
    courses: [{ id: course.id, classId: course.classId, contextId: course.contextId }],
    slots: await campus.schedules.listSlotsByAnnualCourse(course.id),
    weeks: year.weeks,
    holidays: valaisHolidaysForSchoolYear(year.label),
    meetingDays: (await campus.schedules.listMeetingDaysByAnnualCourse(course.id)).map((day) => ({
      annualCourseId: day.annualCourseId,
      dayOfWeek: day.dayOfWeek,
      weekKind: day.weekKind,
    })),
  });
}

async function publish(
  campus: Campus,
  key: CourseKey,
  title: string,
  type: PrototypeAgendaItem["type"],
  session: { key: string; date: string; schoolWeekNumber: number; dayOfWeek: number } | null,
  reference?: { itemId: string; sessionId: string },
) {
  return campus.agenda.createAgendaItem({
    classroomId: "rt-mecauto-n",
    subjectId: `subj-${key}`,
    authorTeacherId: TEACHER_A,
    day: session ? session.dayOfWeek - 1 : 0,
    hour: 8,
    weekOffset: 0,
    schoolWeekNumber: session?.schoolWeekNumber ?? 0,
    type,
    title,
    detail: "Contenu source",
    schoolYearId: SOURCE_YEAR,
    annualCourseId: campus.courseId[key],
    courseSessionKey: session?.key ?? null,
    courseSessionDate: session?.date ?? null,
    referenceItemId: reference?.itemId ?? null,
    referenceSessionId: reference?.sessionId ?? null,
    studentVisible: true,
  });
}

async function addNote(
  campus: Campus,
  id: string,
  key: CourseKey,
  owner: string,
  text: string,
  sessionKey: string | null,
) {
  await campus.notes.createNote(id, {
    schoolYearId: SOURCE_YEAR,
    classId: campus.classId,
    contextId: campus.contextId[key],
    annualCourseId: campus.courseId[key],
    authorTeacherId: owner,
    ownerTeacherId: owner,
    text,
    courseSessionKey: sessionKey,
    referenceSessionId: null,
  });
}

async function seedMecauto(backend: "memory" | "sqlite"): Promise<Campus> {
  const campus = await seedCatalog(await openCampus(backend));
  const sourcePlan: Record<CourseKey, AnnualCourseMeetingDay[]> = {
    cp1: [meetingDay(campus.courseId.cp1, 2, "all", "PRIMARY")],
    cp2: [meetingDay(campus.courseId.cp2, 3, "all", "PRIMARY")],
    cp3: [meetingDay(campus.courseId.cp3, 5, "A", "PRIMARY")],
    injection: [
      meetingDay(campus.courseId.injection, 2, "all", "PRIMARY"),
      meetingDay(campus.courseId.injection, 5, "all", "ADDITIONAL"),
    ],
  };
  for (const key of Object.keys(sourcePlan) as CourseKey[]) {
    await campus.schedules.replaceMeetingDaysForAnnualCourse(campus.courseId[key], sourcePlan[key]);
  }
  await campus.schedules.createSlot(slot("slot-cp1-p1", campus.courseId.cp1, 2, 1, 2));
  await campus.schedules.createSlot(slot("slot-inj-p3", campus.courseId.injection, 2, 3, 4));
  const attendance: ClassAttendanceDay = {
    id: "att-source-mon",
    classId: campus.classId,
    dayOfWeek: 1,
    weekKind: "all",
    role: "PRIMARY",
    createdAt: NOW,
    updatedAt: NOW,
  };
  await campus.schedules.replaceAttendanceDaysForClass(campus.classId, [attendance]);

  const cp1 = await sourceSessions(campus, "cp1");
  const cp2 = await sourceSessions(campus, "cp2");
  const cp3 = await sourceSessions(campus, "cp3");
  const injection = await sourceSessions(campus, "injection");
  assert.ok(cp1[0] && cp2[0] && cp3[0] && injection[0]);

  const path: ReferencePedagogicalPath = {
    id: "path-injection",
    contextId: campus.contextId.injection,
    createdAt: NOW,
    updatedAt: NOW,
    sessions: [
      {
        id: "sess-inj-1",
        position: 1,
        label: "Injection directe",
        items: [
          {
            id: "ref-inj-hw",
            type: "HOMEWORK",
            title: "Injection directe",
            detail: "CTX",
            position: 1,
          },
        ],
      },
    ],
  };
  await campus.paths.savePath(path);

  await publish(campus, "cp1", "CP1 Devoir", "HOMEWORK", cp1[0]!);
  await publish(campus, "cp1", "CP1 Contrôle", "TEST", cp1[0]!);
  await publish(campus, "cp1", "CP1 Information", "INFORMATION", cp1[0]!);
  await publish(campus, "cp2", "CP2 Devoir", "HOMEWORK", cp2[0]!);
  await publish(campus, "cp3", "CP3 Devoir", "HOMEWORK", cp3[0]!);
  await publish(campus, "cp3", "CP3 Information", "INFORMATION", cp3[0]!);
  await publish(campus, "injection", "Injection Devoir", "HOMEWORK", injection[0]!, {
    itemId: "ref-inj-hw",
    sessionId: "sess-inj-1",
  });
  await publish(campus, "injection", "Injection Contrôle à reclasser", "TEST", null);
  await publish(campus, "injection", "Injection référence cassée", "INFORMATION", null, {
    itemId: "ref-inexistante",
    sessionId: "sess-inexistante",
  });

  await addNote(campus, "n-cp1-a", "cp1", TEACHER_A, "Note CP1 A", cp1[0]!.key);
  await addNote(campus, "n-cp1-b", "cp1", TEACHER_B, "Note CP1 B", cp1[0]!.key);
  await addNote(campus, "n-cp2", "cp2", TEACHER_A, "Note CP2", cp2[0]!.key);
  await addNote(campus, "n-cp3", "cp3", TEACHER_B, "Note CP3", cp3[0]!.key);
  await addNote(campus, "n-inj", "injection", TEACHER_A, "Note Injection placée", injection[0]!.key);
  await addNote(
    campus,
    "n-inj-secret",
    "injection",
    TEACHER_B,
    "SECRET_NOTE_BODY_NE_PAS_AFFICHER",
    null,
  );
  return campus;
}

function plansFor(campus: Campus): YearTransitionTargetMeetingDayPlan[] {
  return [
    {
      sourceAnnualCourseId: campus.courseId.cp1,
      days: [{ dayOfWeek: 1, weekKind: "all", role: "PRIMARY" }],
    },
    {
      sourceAnnualCourseId: campus.courseId.cp3,
      days: [{ dayOfWeek: 4, weekKind: "B", role: "PRIMARY" }],
    },
    {
      sourceAnnualCourseId: campus.courseId.injection,
      days: [
        { dayOfWeek: 1, weekKind: "all", role: "PRIMARY" },
        { dayOfWeek: 4, weekKind: "B", role: "ADDITIONAL" },
      ],
    },
  ];
}

function previewRequest(campus: Campus, selected: string[], plans: YearTransitionTargetMeetingDayPlan[]) {
  return {
    includePrivateNotes: true,
    privateNotesOwnerTeacherId: TEACHER_A,
    sourceSchoolYearId: SOURCE_YEAR,
    targetSchoolYearId: TARGET_YEAR,
    classMappings: [{ sourceClassId: campus.classId, targetClassId: pendingTargetClassId(campus.classId) }],
    selectedSourceClassIds: [campus.classId],
    selectedSourceAnnualCourseIds: selected,
    targetMeetingDayPlans: plans,
  };
}

async function snapshotSource(campus: Campus) {
  const courses = (await campus.courses.listCourses()).filter((entry) => entry.schoolYearId === SOURCE_YEAR);
  const courseIds = new Set(courses.map((entry) => entry.id));
  const items = (await campus.agenda.exportAllItems())
    .filter((entry) => entry.schoolYearId === SOURCE_YEAR)
    .sort((left, right) => left.id - right.id);
  const notes = (
    await Promise.all(courses.map((entry) => campus.notes.listNotesByAnnualCourse(entry.id)))
  )
    .flat()
    .sort((left, right) => left.id.localeCompare(right.id));
  const days = (
    await Promise.all(courses.map((entry) => campus.schedules.listMeetingDaysByAnnualCourse(entry.id)))
  )
    .flat()
    .sort((left, right) => left.id.localeCompare(right.id));
  const slots = (await campus.schedules.listSlots())
    .filter((entry) => courseIds.has(entry.annualCourseId))
    .sort((left, right) => left.id.localeCompare(right.id));
  const assignments = (
    await Promise.all(courses.map((entry) => campus.courses.listAssignments(entry.id)))
  )
    .flat()
    .sort((left, right) => left.id.localeCompare(right.id));
  const classes = (await campus.catalog.listClasses())
    .filter((entry) => entry.schoolYearId === SOURCE_YEAR)
    .sort((left, right) => left.id.localeCompare(right.id));
  const paths = (await campus.paths.listPaths()).sort((left, right) => left.id.localeCompare(right.id));
  const attendance = (await campus.schedules.listAttendanceDaysByClass(campus.classId)).sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  return { classes, courses, items, notes, days, slots, assignments, paths, attendance };
}

async function targetCourse(campus: Campus, key: CourseKey) {
  const found = (await campus.courses.listCourses()).find(
    (entry) =>
      entry.schoolYearId === TARGET_YEAR && entry.contextId === campus.contextId[key] && !entry.isArchived,
  );
  assert.ok(found, key);
  return found;
}

function byTitle(items: PrototypeAgendaItem[], title: string) {
  const found = items.find((entry) => entry.title === title);
  assert.ok(found, title);
  return found;
}

for (const backend of ["memory", "sqlite"] as const) {
  test(`E2E ${backend} — MECAUTO3A, PREVIEW, APPLY, reclassement, orphelin, N intact`, async () => {
    const campus = await seedMecauto(backend);
    try {
      const before = await snapshotSource(campus);
      const selected = [campus.courseId.cp1, campus.courseId.cp3, campus.courseId.injection];
      const input = await assembleLiveYearTransitionPreviewInput(previewRequest(campus, selected, plansFor(campus)), campus.deps);
      const persisted = await createPersistedYearTransitionPreview(input, {
        store: campus.previews,
        idGenerator: () => `e2e-${backend}`,
        now: () => "2027-03-01T00:00:00.000Z",
      });

      const sourceItems = (await campus.agenda.exportAllItems()).filter((entry) => entry.schoolYearId === SOURCE_YEAR);
      const cp2 = byTitle(sourceItems, "CP2 Devoir");
      assert.equal(
        persisted.preview.entries.some((entry) => entry.sourceAgendaItemId === cp2.id),
        false,
        "CP2 absent du PREVIEW",
      );
      assert.equal(persisted.preview.privateNotes?.some((entry) => entry.sourceNoteId === "n-cp2"), false);
      assert.equal(persisted.preview.entries.some((entry) => entry.reason === "TARGET_COURSE_MISSING"), false);
      assert.equal(persisted.preview.entries.filter((entry) => entry.disposition === "SKIPPED").length, 0);
      assert.equal(persisted.preview.privateNotes?.filter((entry) => entry.disposition === "SKIPPED").length, 0);

      const planByCourse = new Map(input.targetMeetingDayPlans?.map((plan) => [plan.sourceAnnualCourseId, plan]));
      assert.deepEqual(planByCourse.get(campus.courseId.cp1)?.days, [
        { dayOfWeek: 1, weekKind: "all", role: "PRIMARY" },
      ]);
      assert.deepEqual(planByCourse.get(campus.courseId.cp3)?.days, [
        { dayOfWeek: 4, weekKind: "B", role: "PRIMARY" },
      ]);
      assert.equal(planByCourse.has(campus.courseId.cp2), false);
      assert.ok(input.targetCourseSessions.length > 0);
      assert.ok(
        input.targetCourseSessions.every(
          (session) => session.schoolYearId === TARGET_YEAR && !session.date.startsWith("2026-"),
        ),
      );

      const projectableTitles = ["CP1 Devoir", "CP1 Contrôle", "CP1 Information", "CP3 Devoir", "CP3 Information", "Injection Devoir"];
      const reclassifyTitles = ["Injection Contrôle à reclasser", "Injection référence cassée"];
      for (const title of projectableTitles) {
        const source = byTitle(sourceItems, title);
        const entry = persisted.preview.entries.find((row) => row.sourceAgendaItemId === source.id);
        assert.equal(entry?.disposition, "PROJECTABLE", title);
      }
      for (const title of reclassifyTitles) {
        const source = byTitle(sourceItems, title);
        const entry = persisted.preview.entries.find((row) => row.sourceAgendaItemId === source.id);
        assert.equal(entry?.disposition, "TO_RECLASSIFY", title);
      }
      assert.equal(
        persisted.preview.privateNotes?.find((entry) => entry.sourceNoteId === "n-inj-secret")?.disposition,
        "TO_RECLASSIFY",
      );
      assert.ok(
        ["n-cp1-a", "n-cp1-b", "n-cp3", "n-inj"].every(
          (id) => persisted.preview.privateNotes?.find((entry) => entry.sourceNoteId === id)?.disposition === "PROJECTABLE",
        ),
      );

      const cp1Days = await campus.schedules.listMeetingDaysByAnnualCourse(campus.courseId.cp1);
      await campus.schedules.replaceMeetingDaysForAnnualCourse(
        campus.courseId.cp1,
        cp1Days.map((day) => ({ ...day, dayOfWeek: 3 as const })),
      );
      const stale = await applyPersistedYearTransition(persisted.id, campus.deps);
      assert.equal(stale.ok, false);
      if (!stale.ok) assert.equal(stale.code, "PREVIEW_STALE");
      assert.equal((await campus.courses.listCourses()).some((entry) => entry.schoolYearId === TARGET_YEAR), false);
      await campus.schedules.replaceMeetingDaysForAnnualCourse(campus.courseId.cp1, cp1Days);

      const loaded = await campus.previews.getById(persisted.id);
      assert.ok(loaded);
      const tampered = JSON.parse(loaded.snapshotJson) as { selectedSourceAnnualCourseIds: string[] };
      tampered.selectedSourceAnnualCourseIds = [campus.courseId.cp1];
      await campus.previews.create(
        { ...loaded, id: `tampered-${backend}`, snapshotJson: JSON.stringify(tampered) },
        [],
      );
      const corrupted = await applyPersistedYearTransition(`tampered-${backend}`, campus.deps);
      assert.equal(corrupted.ok, false);
      if (!corrupted.ok) assert.equal(corrupted.code, "PREVIEW_CORRUPTED");

      const applied = await applyPersistedYearTransition(persisted.id, campus.deps);
      assert.equal(applied.ok, true, JSON.stringify(applied));
      if (!applied.ok) return;
      assert.equal(applied.code, "APPLIED");
      assert.equal(applied.skippedCount, 0);
      assert.equal(applied.privateNotes?.skippedCount, 0);
      assert.equal(applied.toReclassifyCount, 2);
      assert.equal(applied.privateNotes?.toReclassifyCount, 1);

      const retry = await applyPersistedYearTransition(persisted.id, campus.deps);
      assert.ok(retry.ok && retry.code === "ALREADY_APPLIED", JSON.stringify(retry));
      assert.equal(
        (await campus.courses.listCourses()).filter((entry) => entry.schoolYearId === TARGET_YEAR).length,
        3,
      );

      const cp1 = await targetCourse(campus, "cp1");
      const cp3 = await targetCourse(campus, "cp3");
      const injectionCourse = await targetCourse(campus, "injection");
      assert.equal(
        (await campus.courses.listCourses()).some(
          (entry) => entry.schoolYearId === TARGET_YEAR && entry.contextId === campus.contextId.cp2,
        ),
        false,
      );

      assert.deepEqual(
        (await campus.schedules.listMeetingDaysByAnnualCourse(cp1.id)).map((day) => `${day.dayOfWeek}|${day.weekKind}|${day.role}`),
        ["1|all|PRIMARY"],
      );
      assert.deepEqual(
        (await campus.schedules.listMeetingDaysByAnnualCourse(cp3.id)).map((day) => `${day.dayOfWeek}|${day.weekKind}|${day.role}`),
        ["4|B|PRIMARY"],
      );
      assert.deepEqual(
        (await campus.schedules.listMeetingDaysByAnnualCourse(injectionCourse.id))
          .map((day) => `${day.role}|${day.dayOfWeek}|${day.weekKind}`)
          .sort(),
        ["ADDITIONAL|4|B", "PRIMARY|1|all"],
      );
      for (const course of [cp1, cp3, injectionCourse]) {
        assert.equal((await campus.schedules.listSlotsByAnnualCourse(course.id)).length, 0);
        assert.equal((await campus.courses.listAssignments(course.id)).length, 0);
      }
      const targetClass = (await campus.catalog.listClasses()).find((entry) => entry.schoolYearId === TARGET_YEAR);
      assert.ok(targetClass);
      assert.equal((await campus.schedules.listAttendanceDaysByClass(targetClass.id)).length, 0);

      const copied = (await campus.agenda.exportAllItems()).filter((entry) => entry.schoolYearId === TARGET_YEAR);
      assert.equal(copied.length, 8);
      assert.ok(copied.every((entry) => entry.studentVisible === false));
      assert.ok(copied.every((entry) => entry.sourceTransitionId === persisted.id));
      assert.ok(copied.every((entry) => entry.sourceAgendaItemId));
      assert.ok(copied.every((entry) => entry.authorTeacherId === TEACHER_A));
      const placedDevoir = copied.find((entry) => entry.title === "Injection Devoir");
      assert.equal(placedDevoir?.referenceItemId, "ref-inj-hw");
      assert.equal(placedDevoir?.annualCourseId, injectionCourse.id);
      assert.ok(placedDevoir?.courseSessionKey?.startsWith(`${TARGET_YEAR}|${injectionCourse.id}|`));
      assert.ok(placedDevoir?.courseSessionDate?.startsWith("2027-"));
      const unplacedControl = copied.find((entry) => entry.title === "Injection Contrôle à reclasser");
      assert.equal(unplacedControl?.courseSessionKey ?? null, null);
      assert.equal(unplacedControl?.courseSessionDate ?? null, null);
      assert.equal(copied.some((entry) => entry.title === "CP2 Devoir"), false);

      const injectionNotes = await campus.notes.listNotesByAnnualCourse(injectionCourse.id);
      assert.equal(injectionNotes.length, 2);
      const secret = injectionNotes.find((entry) => entry.sourceNoteId === "n-inj-secret");
      assert.equal(secret?.courseSessionKey ?? null, null);
      assert.equal(secret?.text, "SECRET_NOTE_BODY_NE_PAS_AFFICHER");
      assert.equal(secret?.schoolYearId, TARGET_YEAR);
      assert.equal(secret?.classId, targetClass.id);
      assert.equal(secret?.contextId, campus.contextId.injection);
      assert.equal(secret?.sourceSchoolYearId, SOURCE_YEAR);
      assert.ok(secret?.inheritedAt);
      const placedNote = injectionNotes.find((entry) => entry.sourceNoteId === "n-inj");
      assert.ok(placedNote?.courseSessionKey?.startsWith(`${TARGET_YEAR}|`));
      assert.equal((await campus.notes.listNotesByAnnualCourse(cp1.id)).length, 2);
      assert.equal(
        (await campus.notes.listNotesByAnnualCourse(cp1.id)).map((entry) => entry.authorTeacherId).sort().join(","),
        `${TEACHER_A},${TEACHER_B}`,
      );

      await campus.courses.createAssignment(assignment("asg-cp1-new", cp1.id, TEACHER_NEW));
      const allowed = await accessibleAnnualCourseIdsForTeacher(campus.courses, TEACHER_NEW, "2027-09-01T00:00:00.000Z");
      assert.ok(allowed.includes(cp1.id));
      assert.equal(
        (await accessibleAnnualCourseIdsForTeacher(campus.courses, TEACHER_A, "2027-09-01T00:00:00.000Z")).includes(cp1.id),
        false,
      );
      const inheritedHomework = copied.find((entry) => entry.title === "CP1 Devoir")!;
      assert.equal(inheritedHomework.authorTeacherId, TEACHER_A);
      const allAssignments = (
        await Promise.all((await campus.courses.listCourses()).map((entry) => campus.courses.listAssignments(entry.id)))
      ).flat();
      const visibleToNewTeacher = buildTeacherCourseWorkspace({
        teacherId: TEACHER_NEW,
        schoolYearId: TARGET_YEAR,
        at: "2027-09-01T00:00:00.000Z",
        assignments: allAssignments,
        courses: await campus.courses.listCourses(),
        classes: await campus.catalog.listClasses(),
        contexts: await campus.catalog.listContexts(),
        branches: await campus.catalog.listBranches(),
        years: await campus.years.listSchoolYears(),
        professions: await campus.catalog.listProfessions(),
      });
      assert.ok(visibleToNewTeacher.courses.some((entry) => entry.annualCourseId === cp1.id));
      const visibleToAuthor = buildTeacherCourseWorkspace({
        teacherId: TEACHER_A,
        schoolYearId: TARGET_YEAR,
        at: "2027-09-01T00:00:00.000Z",
        assignments: allAssignments,
        courses: await campus.courses.listCourses(),
        classes: await campus.catalog.listClasses(),
        contexts: await campus.catalog.listContexts(),
        branches: await campus.catalog.listBranches(),
        years: await campus.years.listSchoolYears(),
        professions: await campus.catalog.listProfessions(),
      });
      assert.equal(visibleToAuthor.courses.some((entry) => entry.annualCourseId === cp1.id), false);
      const deniedAuthor = await authorizeAssignedCoursePublication(
        { courses: campus.courses, catalog: campus.catalog, years: campus.years },
        { teacherId: TEACHER_A, item: inheritedHomework, at: "2027-09-01T00:00:00.000Z" },
      );
      assert.equal(deniedAuthor?.ok, false);
      const notebook = await loadTeacherNotebookDocument(TEACHER_NEW, {
        teacherNotes: campus.teacherNotes,
        courseNotes: campus.notes,
        courses: campus.courses,
      });
      const notebookText = JSON.stringify(notebook);
      assert.match(notebookText, /Note CP1 A/);
      assert.match(notebookText, /Note CP1 B/);
      assert.doesNotMatch(notebookText, /SECRET_NOTE_BODY_NE_PAS_AFFICHER/);

      await campus.agenda.createAgendaItem({
        classroomId: inheritedHomework.classroomId,
        subjectId: inheritedHomework.subjectId,
        authorTeacherId: TEACHER_NEW,
        day: 0,
        hour: 8,
        weekOffset: 0,
        schoolWeekNumber: 1,
        type: "INFORMATION",
        title: "Création enseignant hors transition",
        detail: "Hors bac",
        schoolYearId: TARGET_YEAR,
        annualCourseId: cp1.id,
        courseSessionKey: null,
        courseSessionDate: null,
        studentVisible: false,
      });

      const queue = await listYearTransitionReclassifyQueue(reclassifyDeps(campus), TARGET_YEAR, ADMIN);
      assert.ok(queue.count >= 3);
      assert.equal(JSON.stringify(queue).includes("SECRET_NOTE_BODY_NE_PAS_AFFICHER"), false);
      assert.equal(JSON.stringify(queue).includes("Création enseignant hors transition"), false);
      assert.equal(queue.groups.length, 1);
      assert.ok(queue.groups[0]?.courses.some((course) => course.annualCourseId === injectionCourse.id));
      const noteRow = queue.groups
        .flatMap((group) => group.courses)
        .flatMap((course) => course.items)
        .find((item) => item.kind === "note");
      assert.equal(noteRow?.typeLabel, "Note interne");
      assert.equal(noteRow?.title, null);
      for (const course of queue.groups.flatMap((group) => group.courses)) {
        assert.ok(course.sessions.every((session) => session.annualCourseId === course.annualCourseId));
        assert.ok(course.sessions.every((session) => session.schoolYearId === TARGET_YEAR));
        assert.ok(course.sessions.every((session) => session.date.startsWith("2027-") || session.date.startsWith("2028-")));
      }

      await assert.rejects(
        () => listYearTransitionReclassifyQueue(reclassifyDeps(campus), TARGET_YEAR, TEACHER),
        (error: unknown) => error instanceof Error && error.message === YEAR_TRANSITION_RECLASSIFY_FORBIDDEN,
      );
      const teacherWrite = await applyYearTransitionReclassify(
        reclassifyDeps(campus),
        {
          schoolYearId: TARGET_YEAR,
          kind: "publication",
          publicationId: unplacedControl!.id,
          courseSessionKey: queue.groups[0]!.courses[0]!.sessions[0]!.key,
        },
        TEACHER,
      );
      assert.equal(teacherWrite.ok, false);
      if (!teacherWrite.ok) assert.equal(teacherWrite.status, 403);
      const studentWrite = await applyYearTransitionReclassify(
        reclassifyDeps(campus),
        {
          schoolYearId: TARGET_YEAR,
          kind: "note",
          noteId: secret!.id,
          courseSessionKey: queue.groups[0]!.courses[0]!.sessions[0]!.key,
        },
        STUDENT,
      );
      assert.equal(studentWrite.ok, false);
      if (!studentWrite.ok) assert.equal(studentWrite.status, 403);

      let remaining = queue;
      let thursdayKey: string | null = null;
      for (const group of [...queue.groups]) {
        for (const course of group.courses) {
          const thursday = course.sessions.find((session) => isoWeekday(session.date) === 4);
          const monday = course.sessions.find((session) => isoWeekday(session.date) === 1);
          assert.ok(monday, course.courseLabel);
          for (const item of course.items) {
            const chosen =
              item.title === "Injection Contrôle à reclasser" && thursday ? thursday.key : monday.key;
            if (item.title === "Injection Contrôle à reclasser" && thursday) thursdayKey = thursday.key;
            const saved = await applyYearTransitionReclassify(
              reclassifyDeps(campus),
              {
                schoolYearId: TARGET_YEAR,
                kind: item.kind,
                publicationId: item.publicationId,
                noteId: item.noteId,
                courseSessionKey: chosen,
              },
              ADMIN,
            );
            assert.equal(saved.ok, true, JSON.stringify(saved));
            if (saved.ok) remaining = saved.queue;
          }
        }
      }
      assert.ok(thursdayKey);
      assert.equal(remaining.count, 0);
      assert.equal(remaining.complete, true);
      assert.equal(YEAR_TRANSITION_RECLASSIFY_COMPLETE, "Tous les éléments transférés sont positionnés.");

      const reclassifiedControl = (await campus.agenda.exportAllItems()).find(
        (entry) => entry.id === unplacedControl!.id,
      )!;
      assert.equal(reclassifiedControl.courseSessionKey, thursdayKey);
      assert.equal(reclassifiedControl.courseSessionDate, thursdayKey.split("|")[2]);
      assert.equal(reclassifiedControl.studentVisible, false);
      assert.equal(reclassifiedControl.sourceTransitionId, persisted.id);
      assert.equal(reclassifiedControl.sourceAgendaItemId, unplacedControl!.sourceAgendaItemId);
      const reclassifiedNote = await campus.notes.getNote(secret!.id);
      assert.ok(reclassifiedNote?.courseSessionKey?.startsWith(`${TARGET_YEAR}|${injectionCourse.id}|`));
      assert.equal(reclassifiedNote?.sourceNoteId, "n-inj-secret");
      assert.equal(reclassifiedNote?.sourceSchoolYearId, SOURCE_YEAR);
      assert.equal(reclassifiedNote?.text, "SECRET_NOTE_BODY_NE_PAS_AFFICHER");

      const orphanKey = reclassifiedControl.courseSessionKey!;
      await campus.schedules.replaceMeetingDaysForAnnualCourse(injectionCourse.id, [
        meetingDay(injectionCourse.id, 1, "all", "PRIMARY"),
      ]);
      const untouched = (await campus.agenda.exportAllItems()).find((entry) => entry.id === reclassifiedControl.id)!;
      assert.equal(untouched.courseSessionKey, orphanKey);
      const orphanQueue = await listYearTransitionReclassifyQueue(reclassifyDeps(campus), TARGET_YEAR, ADMIN);
      const orphan = orphanQueue.groups
        .flatMap((group) => group.courses)
        .flatMap((course) => course.items)
        .find((item) => item.publicationId === reclassifiedControl.id);
      assert.equal(orphan?.reclassifyKind, "ORPHANED");
      const mondayLeft = orphanQueue.groups
        .flatMap((group) => group.courses)
        .find((course) => course.annualCourseId === injectionCourse.id)
        ?.sessions.find((session) => isoWeekday(session.date) === 1);
      assert.ok(mondayLeft);
      const moved = await applyYearTransitionReclassify(
        reclassifyDeps(campus),
        {
          schoolYearId: TARGET_YEAR,
          kind: "publication",
          publicationId: reclassifiedControl.id,
          courseSessionKey: mondayLeft.key,
        },
        ADMIN,
      );
      assert.equal(moved.ok, true, JSON.stringify(moved));
      if (moved.ok) {
        assert.equal(moved.queue.count, 0);
        assert.equal(moved.queue.complete, true);
      }
      const afterOrphan = (await campus.agenda.exportAllItems()).find((entry) => entry.id === reclassifiedControl.id)!;
      assert.equal(afterOrphan.courseSessionKey, mondayLeft.key);
      assert.notEqual(afterOrphan.courseSessionKey, orphanKey);
      assert.equal(afterOrphan.studentVisible, false);
      assert.equal(afterOrphan.sourceTransitionId, persisted.id);

      const cp1KeysBeforeSlots = (await campus.agenda.exportAllItems())
        .filter((entry) => entry.annualCourseId === cp1.id && entry.courseSessionKey)
        .map((entry) => entry.courseSessionKey)
        .sort();
      await campus.schedules.createSlot(slot("slot-cp1-n1", cp1.id, 1, 3, 4));
      const year = await campus.years.getSchoolYearById(TARGET_YEAR);
      assert.ok(year);
      const withPeriods = computeCourseSessions({
        schoolYearId: TARGET_YEAR,
        courses: [{ id: cp1.id, classId: cp1.classId, contextId: cp1.contextId }],
        slots: await campus.schedules.listSlotsByAnnualCourse(cp1.id),
        weeks: year.weeks,
        holidays: valaisHolidaysForSchoolYear(year.label),
        meetingDays: (await campus.schedules.listMeetingDaysByAnnualCourse(cp1.id)).map((day) => ({
          annualCourseId: day.annualCourseId,
          dayOfWeek: day.dayOfWeek,
          weekKind: day.weekKind,
        })),
      });
      assert.ok(withPeriods.some((session) => formatCourseSessionPeriods(session.segments) === "P3-P4"));
      assert.deepEqual(
        (await campus.agenda.exportAllItems())
          .filter((entry) => entry.annualCourseId === cp1.id && entry.courseSessionKey)
          .map((entry) => entry.courseSessionKey)
          .sort(),
        cp1KeysBeforeSlots,
      );
      assert.ok(cp1KeysBeforeSlots.every((key) => withPeriods.some((session) => session.key === key)));

      for (const type of ["HOMEWORK", "TEST", "INFORMATION"] as const) {
        const inherited = (await campus.agenda.exportAllItems()).filter(
          (entry) => entry.schoolYearId === TARGET_YEAR && entry.type === type && entry.sourceTransitionId,
        );
        assert.ok(inherited.length > 0, type);
        assert.ok(inherited.every((entry) => isVisibleToStudent(entry) === false));
      }
      const studentItems = getStudentAgendaItems(await campus.agenda.exportAllItems(), inheritedHomework.classroomId);
      assert.equal(studentItems.some((entry) => entry.sourceTransitionId === persisted.id), false);

      const edited = await campus.agenda.updateAgendaItem(
        inheritedHomework.id,
        TEACHER_NEW,
        { title: "CP1 Devoir modifié en N+1" },
        { canAccessAnnualCourse: true },
      );
      assert.equal(edited.ok, true, JSON.stringify(edited));
      assert.equal(byTitle(await campus.agenda.exportAllItems(), "CP1 Devoir").schoolYearId, SOURCE_YEAR);
      const sourceNote = await campus.notes.getNote("n-cp1-a");
      const copy = (await campus.notes.listNotesByAnnualCourse(cp1.id)).find((entry) => entry.sourceNoteId === "n-cp1-a");
      assert.ok(copy && sourceNote);
      await campus.notes.deleteNote(copy.id);
      await campus.notes.createNote(copy.id, { ...copy, text: "Note modifiée en N+1" });
      assert.equal((await campus.notes.getNote("n-cp1-a"))?.text, sourceNote.text);

      assert.deepEqual(await snapshotSource(campus), before);
    } finally {
      campus.close();
    }
  });

  test(`E2E ${backend} — classe sélectionnée, tous les cours décochés`, async () => {
    const campus = await seedMecauto(backend);
    try {
      const input = await assembleLiveYearTransitionPreviewInput(
        previewRequest(campus, [], []),
        campus.deps,
      );
      const persisted = await createPersistedYearTransitionPreview(input, {
        store: campus.previews,
        idGenerator: () => `empty-${backend}`,
        now: () => "2027-03-01T00:00:00.000Z",
      });
      assert.equal(persisted.preview.entries.length, 0);
      assert.equal(persisted.preview.privateNotes?.length ?? 0, 0);
      assert.equal(persisted.preview.entries.some((entry) => entry.reason === "TARGET_COURSE_MISSING"), false);
      const applied = await applyPersistedYearTransition(persisted.id, campus.deps);
      assert.equal(applied.ok, true, JSON.stringify(applied));
      if (!applied.ok) return;
      assert.equal(applied.skippedCount, 0);
      assert.equal(applied.createdCount, 0);
      assert.equal(
        (await campus.courses.listCourses()).filter((entry) => entry.schoolYearId === TARGET_YEAR).length,
        0,
      );
      assert.equal((await campus.agenda.exportAllItems()).filter((entry) => entry.schoolYearId === TARGET_YEAR).length, 0);
      const targetClasses = (await campus.catalog.listClasses()).filter((entry) => entry.schoolYearId === TARGET_YEAR);
      for (const schoolClass of targetClasses) {
        assert.equal((await campus.schedules.listAttendanceDaysByClass(schoolClass.id)).length, 0);
      }
      const targetCourseIds = new Set(
        (await campus.courses.listCourses()).filter((entry) => entry.schoolYearId === TARGET_YEAR).map((entry) => entry.id),
      );
      assert.equal(
        (await campus.schedules.listMeetingDays()).filter((day) => targetCourseIds.has(day.annualCourseId)).length,
        0,
      );
    } finally {
      campus.close();
    }
  });

  test(`E2E ${backend} — tout projectable : À reclasser = 0`, async () => {
    const campus = await seedMecauto(backend);
    try {
      const only = [campus.courseId.cp1];
      const input = await assembleLiveYearTransitionPreviewInput(
        previewRequest(campus, only, [plansFor(campus)[0]!]),
        campus.deps,
      );
      const persisted = await createPersistedYearTransitionPreview(input, {
        store: campus.previews,
        idGenerator: () => `clean-${backend}`,
        now: () => "2027-03-01T00:00:00.000Z",
      });
      assert.ok(persisted.preview.entries.every((entry) => entry.disposition === "PROJECTABLE"));
      assert.ok(persisted.preview.privateNotes?.every((entry) => entry.disposition === "PROJECTABLE"));
      const applied = await applyPersistedYearTransition(persisted.id, campus.deps);
      assert.equal(applied.ok, true, JSON.stringify(applied));
      if (!applied.ok) return;
      assert.equal(applied.toReclassifyCount, 0);
      assert.equal(applied.privateNotes?.toReclassifyCount, 0);
      const queue = await listYearTransitionReclassifyQueue(reclassifyDeps(campus), TARGET_YEAR, ADMIN);
      assert.equal(queue.count, 0);
      assert.equal(queue.complete, true);
    } finally {
      campus.close();
    }
  });
}

for (const backend of ["memory", "sqlite"] as const) {
test(`E2E ${backend} — volumétrie 36 publications + 15 notes, puis reclassement du dernier`, async () => {
  const campus = await seedMecauto(backend);
  try {
    const sessions = await sourceSessions(campus, "cp1");
    assert.ok(sessions[0]);
    const volumeIds = new Set<number>();
    for (const type of ["HOMEWORK", "TEST", "INFORMATION"] as const) {
      for (let index = 0; index < 11; index += 1) {
        volumeIds.add((await publish(campus, "cp1", `${type} vol ${index}`, type, sessions[0]!)).id);
      }
    }
    volumeIds.add((await publish(campus, "cp1", "HW extra", "HOMEWORK", sessions[0]!)).id);
    volumeIds.add((await publish(campus, "cp1", "TEST extra", "TEST", sessions[0]!)).id);
    volumeIds.add((await publish(campus, "cp1", "Volume à reclasser", "INFORMATION", null)).id);
    for (let index = 0; index < 15; index += 1) {
      await addNote(
        campus,
        `n-vol-${index}`,
        "cp1",
        index % 2 === 0 ? TEACHER_A : TEACHER_B,
        `Note volume ${index}`,
        sessions[0]!.key,
      );
    }
    const input = await assembleLiveYearTransitionPreviewInput(
      previewRequest(campus, [campus.courseId.cp1], [plansFor(campus)[0]!]),
      campus.deps,
    );
    const persisted = await createPersistedYearTransitionPreview(input, {
      store: campus.previews,
      idGenerator: () => `e2e-volume-${backend}`,
      now: () => "2027-03-01T00:00:00.000Z",
    });
    const volumeEntries = persisted.preview.entries.filter((entry) => volumeIds.has(entry.sourceAgendaItemId));
    assert.equal(volumeEntries.filter((entry) => entry.disposition === "PROJECTABLE").length, 35);
    assert.equal(volumeEntries.filter((entry) => entry.disposition === "TO_RECLASSIFY").length, 1);
    const applied = await applyPersistedYearTransition(persisted.id, campus.deps);
    assert.equal(applied.ok, true, JSON.stringify(applied));
    if (applied.ok) {
      assert.equal(applied.skippedCount, 0);
      assert.equal(applied.privateNotes?.skippedCount, 0);
      assert.equal(applied.toReclassifyCount, 1);
      assert.equal(applied.privateNotes?.toReclassifyCount, 0);
    }
    const queue = await listYearTransitionReclassifyQueue(reclassifyDeps(campus), TARGET_YEAR, ADMIN);
    assert.equal(queue.count, 1);
    const pending = queue.groups.flatMap((group) => group.courses).flatMap((course) => course.items);
    const volumeItem = pending.find((item) => item.title === "Volume à reclasser");
    assert.ok(volumeItem);
    const session = queue.groups.flatMap((group) => group.courses).find((course) =>
      course.items.some((item) => item.id === volumeItem.id),
    )?.sessions[0];
    assert.ok(session);
    const saved = await applyYearTransitionReclassify(
      reclassifyDeps(campus),
      {
        schoolYearId: TARGET_YEAR,
        kind: "publication",
        publicationId: volumeItem.publicationId,
        courseSessionKey: session.key,
      },
      ADMIN,
    );
    assert.equal(saved.ok, true, JSON.stringify(saved));
    const cp1 = await targetCourse(campus, "cp1");
    const copiedPublications = (await campus.agenda.exportAllItems()).filter(
      (entry) => entry.schoolYearId === TARGET_YEAR && entry.annualCourseId === cp1.id,
    );
    const copiedNotes = await campus.notes.listNotesByAnnualCourse(cp1.id);
    assert.ok(copiedPublications.length >= 36);
    assert.ok(copiedNotes.length >= 15);
    assert.equal(
      copiedPublications.filter((entry) => entry.title === "Volume à reclasser" && entry.courseSessionKey).length,
      1,
    );
    if (saved.ok) {
      assert.equal(saved.queue.count, 0);
      assert.equal(saved.queue.complete, true);
      assert.equal(
        saved.queue.groups.flatMap((group) => group.courses).flatMap((course) => course.items).some((item) => item.title === "Volume à reclasser"),
        false,
      );
    }
    const volumePublications = copiedPublications.filter((entry) => volumeIds.has(entry.sourceAgendaItemId ?? -1));
    const volumeNotes = copiedNotes.filter((entry) => entry.sourceNoteId?.startsWith("n-vol-"));
    assert.equal(volumePublications.length, 36);
    assert.equal(volumeNotes.length, 15);
    assert.equal(volumePublications.length + volumeNotes.length, 51);
    assert.equal(copiedPublications.filter((entry) => !entry.courseSessionKey).length, 0);
    assert.equal(copiedNotes.filter((entry) => !entry.courseSessionKey).length, 0);
  } finally {
    campus.close();
  }
});
}

test("empreinte UI : un MeetingDay ou une sélection différente invalide l’ancien PREVIEW", () => {
  const base = {
    sourceSchoolYearId: SOURCE_YEAR,
    targetSchoolYearId: TARGET_YEAR,
    selectedSourceClassIds: ["class-a"],
    selectedSourceAnnualCourseIds: ["course-a", "course-b"],
    drafts: {
      "course-a": { primaryDay: 1 as const, primaryWeekKind: "all" as const, additionalDay: null, additionalWeekKind: "all" as const },
      "course-b": { primaryDay: 4 as const, primaryWeekKind: "B" as const, additionalDay: null, additionalWeekKind: "all" as const },
    },
  };
  const changedDay = {
    ...base,
    drafts: {
      ...base.drafts,
      "course-a": { ...base.drafts["course-a"], primaryDay: 2 as const },
    },
  };
  const changedSelection = {
    ...base,
    selectedSourceAnnualCourseIds: ["course-a"],
  };
  assert.notEqual(yearTransitionConfigSignature(base), yearTransitionConfigSignature(changedDay));
  assert.notEqual(yearTransitionConfigSignature(base), yearTransitionConfigSignature(changedSelection));
});

test("sécurité admin et bouton Reclasser masqué quand le compteur est à 0", async () => {
  assert.equal(evaluateAdminMfaAccess({ isAdmin: false, mfaPending: false, status: null }).ok, false);
  const teacherGate = evaluateAdminMfaAccess({ isAdmin: false, mfaPending: false, status: null });
  assert.equal(teacherGate.ok, false);
  if (!teacherGate.ok) assert.equal(teacherGate.status, 403);
  const panel = await readFile(new URL("../web/app/components/year-transition-prepare-panel.tsx", import.meta.url), "utf8");
  assert.match(panel, /reclassifyCount > 0 \?/);
  assert.match(panel, /Reclasser les/);
  assert.match(panel, /lostCount > 0 \? "warn" : "ok"/);
  const routes = [
    "web/app/api/admin/year-transition/preview/route.ts",
    "web/app/api/admin/year-transition/apply/route.ts",
    "web/app/api/admin/year-transition/reclassify/route.ts",
  ];
  for (const file of routes) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(source, /requireAdminSession/, file);
  }
  const notebook = await readFile(new URL("../web/app/components/class-notebook-panel.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(notebook, /YearTransitionReclassifyPanel/);
  assert.doesNotMatch(notebook, /À reclasser/);
});

for (const backend of ["memory", "sqlite"] as const) {
  test(`E2E ${backend} — réimporter CP1 lundi → mercredi A, autres cours et N intacts`, async () => {
    const campus = await seedMecauto(backend);
    try {
      const deps = campus.deps as YearTransitionPrepareDeps;
      const selected = [campus.courseId.cp1, campus.courseId.cp3, campus.courseId.injection];
      const body = (plans: YearTransitionTargetMeetingDayPlan[], extra: Record<string, unknown> = {}) => ({
        sourceSchoolYearId: SOURCE_YEAR,
        targetSchoolYearId: TARGET_YEAR,
        selectedSourceClassIds: [campus.classId],
        selectedSourceAnnualCourseIds: plans.map((plan) => plan.sourceAnnualCourseId),
        targetMeetingDayPlans: plans,
        ...extra,
      });
      const first = await createAuthorizedYearTransitionPreview(body(plansFor(campus)), "admin-e2e", deps);
      assert.equal(first.blocking, false);
      assert.equal(selected.length, plansFor(campus).length);
      const firstApplied = await applyAuthorizedYearTransition({ transitionId: first.transitionId, confirm: true }, "admin-e2e", deps);
      assert.equal(firstApplied.ok, true, JSON.stringify(firstApplied));

      const before = await snapshotSource(campus);
      const cp1 = await targetCourse(campus, "cp1");
      const cp3 = await targetCourse(campus, "cp3");
      const injection = await targetCourse(campus, "injection");
      const targetState = async (courseId: string) => ({
        items: (await campus.agenda.exportAllItems()).filter((entry) => entry.annualCourseId === courseId).sort((a, b) => a.id - b.id),
        notes: (await campus.notes.listNotesByAnnualCourse(courseId)).sort((a, b) => a.id.localeCompare(b.id)),
        days: await campus.schedules.listMeetingDaysByAnnualCourse(courseId),
      });
      const othersBefore = [await targetState(cp3.id), await targetState(injection.id)];
      const cp1Before = await targetState(cp1.id);
      assert.equal(cp1Before.items.length, 3);
      assert.equal(cp1Before.notes.length, 2);
      await campus.courses.createAssignment(assignment("asg-cp1-n1", cp1.id, TEACHER_NEW));
      await campus.schedules.createSlot(slot("slot-cp1-n1", cp1.id, 1, 1, 2));

      campus.deps.now = () => "2027-06-02T00:00:00.000Z";
      const cp1Wednesday: YearTransitionTargetMeetingDayPlan = {
        sourceAnnualCourseId: campus.courseId.cp1,
        days: [{ dayOfWeek: 3, weekKind: "A", role: "PRIMARY" }],
      };
      const cp3Same = plansFor(campus).find((plan) => plan.sourceAnnualCourseId === campus.courseId.cp3)!;
      const preview = await createAuthorizedYearTransitionPreview(
        body([cp1Wednesday, cp3Same], {
          reimportSourceAnnualCourseIds: [campus.courseId.cp1, campus.courseId.cp3],
        }),
        "admin-e2e",
        deps,
      );
      assert.equal(preview.blocking, false, JSON.stringify(preview.preview.mappingIssues));
      assert.deepEqual(preview.reimport.unchangedSourceAnnualCourseIds, [campus.courseId.cp3]);
      assert.equal(preview.reimport.courses.length, 1);
      const [summary] = preview.reimport.courses;
      assert.deepEqual(summary!.replaced, { publications: 3, notes: 2 });
      assert.deepEqual(summary!.positioned, { publications: 3, notes: 2 });
      assert.deepEqual(summary!.unusedSlots.map((entry) => entry.slotId), ["slot-cp1-n1"]);

      await assert.rejects(
        applyAuthorizedYearTransition({ transitionId: preview.transitionId, confirm: true }, "admin-e2e", deps),
        { message: YEAR_TRANSITION_REIMPORT_CONFIRMATION_REQUIRED },
      );
      assert.deepEqual(await targetState(cp1.id), cp1Before);

      const applied = await applyAuthorizedYearTransition(
        { transitionId: preview.transitionId, confirm: true, confirmReimport: true },
        "admin-e2e",
        deps,
      );
      assert.equal(applied.ok, true, JSON.stringify(applied));

      const cp1After = await targetState(cp1.id);
      assert.equal(cp1After.items.length, 3);
      assert.ok(cp1After.items.every((entry) => entry.sourceTransitionId === preview.transitionId));
      assert.ok(cp1After.items.every((entry) => entry.courseSessionDate && isoWeekday(entry.courseSessionDate) === 3));
      assert.ok(cp1After.items.every((entry) => entry.studentVisible === false));
      assert.equal(cp1After.notes.length, 2);
      assert.ok(cp1After.notes.every((entry) => !cp1Before.notes.some((old) => old.id === entry.id)));
      assert.ok(cp1After.notes.every((entry) => isoWeekday(entry.courseSessionKey!.split("|")[2]!) === 3));
      assert.deepEqual(cp1After.days.map((day) => `${day.dayOfWeek}|${day.weekKind}|${day.role}`), ["3|A|PRIMARY"]);
      assert.deepEqual([await targetState(cp3.id), await targetState(injection.id)], othersBefore, "CP3 et Injection intacts");
      assert.ok((await campus.schedules.listSlots()).some((entry) => entry.id === "slot-cp1-n1"));
      assert.ok((await campus.courses.listAssignments(cp1.id)).some((entry) => entry.id === "asg-cp1-n1" && !entry.endedAt));
      assert.deepEqual(await snapshotSource(campus), before, "N intact");

      const state = await loadYearTransitionPrepareState(deps, "admin-e2e");
      const cp1State = state.courseImports.find((entry) => entry.sourceAnnualCourseId === campus.courseId.cp1);
      assert.deepEqual(cp1State?.preparations.map((entry) => entry.transitionId), [first.transitionId, preview.transitionId]);
      assert.deepEqual(cp1State?.currentPlan, [{ dayOfWeek: 3, weekKind: "A", role: "PRIMARY" }]);

      for (const transitionId of [first.transitionId, preview.transitionId]) {
        const retry = await applyPersistedYearTransition(transitionId, campus.deps);
        assert.ok(retry.ok && retry.code === "ALREADY_APPLIED", JSON.stringify(retry));
      }
    } finally {
      campus.close();
    }
  });
}
