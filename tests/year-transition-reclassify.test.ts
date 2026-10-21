import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { isVisibleToStudent } from "../src/features/agenda/visibility.ts";
import type { PrototypeAgendaItem } from "../src/features/agenda/demo-items.ts";
import type { AnnualCourseMeetingDayInput } from "../src/features/annual-courses/meeting-days.ts";
import type { AnnualCourse, TeacherCourseAssignment } from "../src/features/annual-courses/types.ts";
import {
  bindPublicationToCourseSession,
  countPublicationsToReclassify,
  noteNeedsReclassification,
  publicationNeedsReclassification,
} from "../src/features/class-notebook/reclassify.ts";
import { computeCourseSessions } from "../src/features/course-sessions/compute.ts";
import type { AnnualCourseNote } from "../src/features/pedagogical-path/annual-notes.ts";
import { valaisHolidaysForSchoolYear } from "../src/features/school-days/holidays-valais.ts";
import type { SchoolWeekEntry } from "../src/features/school-year/types.ts";
import { getStudentAgendaItems } from "../src/features/student/agenda.ts";
import {
  applyPersistedYearTransition,
  assembleLiveYearTransitionPreviewInput,
  buildYearTransitionPreview,
  createPersistedYearTransitionPreview,
  pendingTargetClassId,
  presentYearTransitionPreview,
  yearTransitionPreviewFingerprint,
  type ApplyPersistedYearTransitionDeps,
  type YearTransitionCatalogLookups,
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
import { MemoryYearTransitionApplyStore } from "../src/lib/persistence/memory-year-transition-apply-store.ts";
import { MemoryYearTransitionPreviewStore } from "../src/lib/persistence/memory-year-transition-preview-store.ts";
import {
  replaceMemoryLegacySchool,
  resetMemoryLegacySchool,
} from "../src/lib/persistence/memory-legacy-school.ts";

const SOURCE_YEAR = "year-n";
const TARGET_YEAR = "year-n1";
const SOURCE_CLASS = "class-ma1a-n";
const SOURCE_INJECTION = "ac-injection-n";
const CTX_INJECTION = "ctx-injection";
const TEACHER_A = "teacher-a";
const TEACHER_B = "teacher-b";
const PROFESSION = "prf-meca";
const BRANCH = "br-injection";
const SOURCE_SESSION = `${SOURCE_YEAR}|${SOURCE_INJECTION}|2027-08-23`;
const LATE_SESSION = `${SOURCE_YEAR}|${SOURCE_INJECTION}|2027-09-27`;

function mondayWeeks(startMonday: string, count: number): SchoolWeekEntry[] {
  const weeks: SchoolWeekEntry[] = [];
  const [year, month, day] = startMonday.split("-").map(Number);
  const cursor = new Date(year!, month! - 1, day!, 12);
  let number = 1;
  while (weeks.length < count) {
    const iso = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
    weeks.push({
      number,
      kind: number % 2 === 1 ? "A" : "B",
      monday: iso,
    });
    number += 1;
    cursor.setDate(cursor.getDate() + 7);
  }
  return weeks;
}

function course(id: string, contextId: string, classId = SOURCE_CLASS): AnnualCourse {
  return {
    id,
    schoolYearId: SOURCE_YEAR,
    classId,
    contextId,
    isArchived: false,
    archivedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function plan(
  sourceAnnualCourseId: string,
  days: AnnualCourseMeetingDayInput[],
): YearTransitionTargetMeetingDayPlan {
  return { sourceAnnualCourseId, days };
}

function mondayAll(sourceAnnualCourseId: string): YearTransitionTargetMeetingDayPlan {
  return plan(sourceAnnualCourseId, [{ dayOfWeek: 1, weekKind: "all", role: "PRIMARY" }]);
}

function thursdayB(sourceAnnualCourseId: string): YearTransitionTargetMeetingDayPlan {
  return plan(sourceAnnualCourseId, [{ dayOfWeek: 4, weekKind: "B", role: "PRIMARY" }]);
}

function item(
  patch: Partial<PrototypeAgendaItem> & Pick<PrototypeAgendaItem, "id" | "title">,
): PrototypeAgendaItem {
  return {
    classroomId: "rt-ma1",
    subjectId: "subj-injection",
    authorTeacherId: TEACHER_A,
    day: 0,
    hour: 9,
    weekOffset: 0,
    schoolWeekNumber: 1,
    type: "HOMEWORK",
    detail: "N",
    schoolYearId: SOURCE_YEAR,
    annualCourseId: SOURCE_INJECTION,
    courseSessionKey: SOURCE_SESSION,
    courseSessionDate: "2027-08-23",
    referenceItemId: null,
    referenceSessionId: null,
    studentVisible: true,
    ...patch,
  };
}

function note(
  id: string,
  ownerTeacherId: string,
  patch: Partial<AnnualCourseNote> = {},
): AnnualCourseNote {
  return {
    id,
    schoolYearId: SOURCE_YEAR,
    classId: SOURCE_CLASS,
    contextId: CTX_INJECTION,
    referenceSessionId: patch.referenceSessionId ?? null,
    authorTeacherId: ownerTeacherId,
    ownerTeacherId,
    text: `Note ${id}`,
    body: null,
    courseSessionKey: SOURCE_SESSION,
    legacyNoteId: null,
    notebookPosition: 0,
    sourceNoteId: null,
    sourceSchoolYearId: null,
    inheritedAt: null,
    annualCourseId: SOURCE_INJECTION,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...patch,
  };
}

async function world(options: {
  extraItems?: PrototypeAgendaItem[];
  extraNotes?: AnnualCourseNote[];
} = {}) {
  resetMemorySchoolYearStore();
  resetMemoryLegacySchool();
  replaceMemoryLegacySchool({ classrooms: [], subjects: [], memberships: [], studentAccesses: [] });
  const weeks = mondayWeeks("2027-08-23", 6);
  replaceMemorySchoolYears([
    {
      id: SOURCE_YEAR,
      label: "2026-2027",
      status: "active",
      startsOn: "2026-08-17",
      endsOn: "2027-07-02",
      sourceFilename: null,
      importedAt: null,
      activatedAt: "2026-08-01T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
      weeks,
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
      createdAt: "2026-01-01T00:00:00.000Z",
      weeks,
    },
  ]);

  const catalog = new MemorySchoolCatalogStore();
  catalog.replaceSnapshot({
    professions: [
      {
        id: PROFESSION,
        adminCode: "PRF-0001",
        label: "Mécanicien",
        classCodePrefix: "MA",
        durationYears: 4,
        sortOrder: 1,
        isActive: true,
        isArchived: false,
        archivedAt: null,
      },
    ],
    branches: [
      {
        id: BRANCH,
        code: "INJ",
        label: "Injection",
        sortOrder: 1,
        isActive: true,
        adminCode: "BR-0001",
        isArchived: false,
        archivedAt: null,
        teachingType: "TECHNICAL",
      },
    ],
    contexts: [
      {
        id: CTX_INJECTION,
        adminCode: "CTX-0001",
        professionId: PROFESSION,
        trainingYear: 1,
        branchId: BRANCH,
        isActive: true,
        isArchived: false,
        archivedAt: null,
      },
    ],
    classes: [
      {
        id: SOURCE_CLASS,
        code: "MA1A",
        label: "MA 1A",
        sortOrder: 1,
        isActive: true,
        schoolYearId: SOURCE_YEAR,
        schoolYearLabel: "2026-2027",
        professionId: PROFESSION,
        trainingYear: 1,
        parallelCode: "A",
        isArchived: false,
        archivedAt: null,
      },
    ],
  });

  const courses = new MemoryAnnualCourseStore();
  await courses.createCourse(course(SOURCE_INJECTION, CTX_INJECTION));
  await courses.createAssignment({
    id: "asg-source-a",
    annualCourseId: SOURCE_INJECTION,
    teacherId: TEACHER_A,
    role: "PRIMARY",
    validFrom: "2026-08-01T00:00:00.000Z",
    validTo: null,
    createdByAdminId: "admin-1",
    createdAt: "2026-08-01T00:00:00.000Z",
    endedAt: null,
    overrideReason: null,
    overrideByAdminId: null,
  } satisfies TeacherCourseAssignment);

  const schedules = new MemoryCourseScheduleStore();
  await schedules.createSlot({
    id: "slot-injection-n",
    annualCourseId: SOURCE_INJECTION,
    dayOfWeek: 1,
    periodStart: 1,
    periodEnd: 4,
    weekKind: "all",
    validFrom: null,
    validTo: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  });
  await schedules.replaceAttendanceDaysForClass(SOURCE_CLASS, [
    {
      id: "att-source-mon",
      classId: SOURCE_CLASS,
      dayOfWeek: 1,
      weekKind: "all",
      role: "PRIMARY",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    },
  ]);

  const notes = new MemoryAnnualCourseNotesStore();
  notes.replaceAllNotes(options.extraNotes ?? [note("n-a", TEACHER_A)]);

  const agenda = new MemoryAgendaStore(
    options.extraItems ?? [
      item({ id: 10, title: "Devoir injection" }),
      item({ id: 11, title: "Contrôle injection", type: "TEST" }),
      item({ id: 12, title: "Info injection", type: "INFORMATION" }),
    ],
  );
  const years = new MemorySchoolYearStore();
  const previews = new MemoryYearTransitionPreviewStore();
  const applyStore = new MemoryYearTransitionApplyStore(agenda, notes);
  const deps: ApplyPersistedYearTransitionDeps = {
    notes,
    previews,
    applyStore,
    years,
    catalog,
    courses,
    agenda,
    paths: new MemoryPedagogicalPathStore(),
    schedules,
    adapters: new MemoryRuntimeAgendaAdapterStore(),
    now: () => "2027-03-01T00:00:00.000Z",
  };

  return {
    deps,
    catalog,
    courses,
    schedules,
    notes,
    agenda,
    previews,
    years,
    mappings: [{ sourceClassId: SOURCE_CLASS, targetClassId: pendingTargetClassId(SOURCE_CLASS) }],
  };
}

async function persistPreview(
  seeded: Awaited<ReturnType<typeof world>>,
  plans: YearTransitionTargetMeetingDayPlan[] | undefined,
  id = "transition-reclassify",
) {
  const input = await assembleLiveYearTransitionPreviewInput(
    {
      includePrivateNotes: true,
      privateNotesOwnerTeacherId: TEACHER_A,
      sourceSchoolYearId: SOURCE_YEAR,
      targetSchoolYearId: TARGET_YEAR,
      classMappings: seeded.mappings,
      selectedSourceClassIds: [SOURCE_CLASS],
      ...(plans ? { targetMeetingDayPlans: plans } : {}),
    },
    seeded.deps,
  );
  return {
    input,
    preview: buildYearTransitionPreview(input),
    persisted: await createPersistedYearTransitionPreview(input, {
      store: seeded.previews,
      idGenerator: () => id,
      now: () => "2027-02-01T00:00:00.000Z",
    }),
  };
}

async function targetCourseOf(seeded: Awaited<ReturnType<typeof world>>) {
  const courses = await seeded.courses.listCourses();
  const found = courses.find(
    (entry) => entry.schoolYearId === TARGET_YEAR && entry.contextId === CTX_INJECTION && !entry.isArchived,
  );
  assert.ok(found);
  return found;
}

test("1-16 — projectables et à reclasser : copie, visibilité, provenance, idempotence", async () => {
  const seeded = await world({
    extraItems: [
      item({ id: 10, title: "Devoir planifié", type: "HOMEWORK" }),
      item({ id: 11, title: "Contrôle planifié", type: "TEST" }),
      item({ id: 12, title: "Info planifiée", type: "INFORMATION" }),
      item({
        id: 20,
        title: "Devoir orphelin",
        type: "HOMEWORK",
        courseSessionKey: null,
        courseSessionDate: null,
        schoolWeekNumber: 0,
      }),
      item({
        id: 21,
        title: "Contrôle orphelin",
        type: "TEST",
        courseSessionKey: null,
        courseSessionDate: null,
        schoolWeekNumber: 0,
      }),
      item({
        id: 22,
        title: "Info orpheline",
        type: "INFORMATION",
        courseSessionKey: null,
        courseSessionDate: null,
        schoolWeekNumber: 0,
      }),
      item({
        id: 23,
        title: "Sans CTX",
        type: "HOMEWORK",
        referenceSessionId: "sess-dead",
        courseSessionKey: null,
        courseSessionDate: null,
        schoolWeekNumber: 0,
      }),
    ],
    extraNotes: [
      note("n-placed", TEACHER_A),
      note("n-orphan", TEACHER_B, { courseSessionKey: null, referenceSessionId: "ref-keep" }),
    ],
  });
  const { input, preview, persisted } = await persistPreview(seeded, [mondayAll(SOURCE_INJECTION)]);
  const byId = new Map(preview.entries.map((entry) => [entry.sourceAgendaItemId, entry]));
  assert.equal(byId.get(10)?.disposition, "PROJECTABLE");
  assert.equal(byId.get(11)?.disposition, "PROJECTABLE");
  assert.equal(byId.get(12)?.disposition, "PROJECTABLE");
  assert.equal(byId.get(20)?.disposition, "TO_RECLASSIFY");
  assert.equal(byId.get(20)?.reason, "ORPHAN_NO_REFERENCE_ITEM");
  assert.equal(byId.get(21)?.disposition, "TO_RECLASSIFY");
  assert.equal(byId.get(22)?.disposition, "TO_RECLASSIFY");
  assert.equal(byId.get(23)?.disposition, "TO_RECLASSIFY");
  assert.equal(byId.get(23)?.reason, "PATH_ABSENT");
  assert.equal(preview.entries.filter((entry) => entry.disposition === "PROJECTABLE").length, 3);
  assert.equal(preview.entries.filter((entry) => entry.disposition === "TO_RECLASSIFY").length, 4);
  assert.equal(preview.privateNotes?.filter((entry) => entry.disposition === "PROJECTABLE").length, 1);
  assert.equal(preview.privateNotes?.filter((entry) => entry.disposition === "TO_RECLASSIFY").length, 1);
  assert.equal(preview.privateNotes?.find((entry) => entry.sourceNoteId === "n-orphan")?.reason, "PATH_ABSENT");

  const presented = presentYearTransitionPreview(
    preview,
    {
      years: await seeded.years.listSchoolYears(),
      classes: await seeded.catalog.listClasses(),
      professions: await seeded.catalog.listProfessions(),
      contexts: await seeded.catalog.listContexts(),
      branches: await seeded.catalog.listBranches(),
      courses: await seeded.courses.listCourses(),
      items: await seeded.agenda.exportAllItems(),
    } satisfies YearTransitionCatalogLookups,
    input.classMappings,
    { selectedSourceClassIds: [SOURCE_CLASS] },
  );
  assert.equal(presented.publications.projectable.length, 3);
  assert.equal(presented.publications.toReclassify.length, 4);
  assert.equal(presented.publications.excluded.length, 0);
  assert.equal(presented.notes?.projectable.length, 1);
  assert.equal(presented.notes?.toReclassify.length, 1);
  assert.match(presented.publications.toReclassify[0]?.reasonLabel ?? "", /À reclasser/);

  const result = await applyPersistedYearTransition(persisted.id, seeded.deps);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.createdCount, 3);
  assert.equal(result.toReclassifyCount, 4);
  assert.equal(result.skippedCount, 0);
  assert.equal(result.privateNotes?.createdCount, 1);
  assert.equal(result.privateNotes?.toReclassifyCount, 1);
  assert.equal(result.privateNotes?.skippedCount, 0);

  const targetCourse = await targetCourseOf(seeded);
  const copied = (await seeded.agenda.exportAllItems()).filter((entry) => entry.schoolYearId === TARGET_YEAR);
  const placed = copied.filter((entry) => entry.courseSessionKey);
  const unplaced = copied.filter((entry) => !entry.courseSessionKey);
  assert.equal(placed.length, 3);
  assert.equal(unplaced.length, 4);
  assert.ok(placed.some((entry) => entry.type === "HOMEWORK" && entry.title === "Devoir planifié"));
  assert.ok(placed.some((entry) => entry.type === "TEST" && entry.title === "Contrôle planifié"));
  assert.ok(placed.some((entry) => entry.type === "INFORMATION" && entry.title === "Info planifiée"));
  assert.ok(unplaced.some((entry) => entry.type === "HOMEWORK" && entry.title === "Devoir orphelin"));
  assert.ok(unplaced.some((entry) => entry.type === "TEST" && entry.title === "Contrôle orphelin"));
  assert.ok(unplaced.some((entry) => entry.type === "INFORMATION" && entry.title === "Info orpheline"));
  assert.ok(copied.every((entry) => entry.annualCourseId === targetCourse.id));
  assert.ok(unplaced.every((entry) => entry.courseSessionDate == null));
  assert.ok(unplaced.every((entry) => entry.studentVisible === false));
  assert.ok(copied.every((entry) => entry.sourceTransitionId === persisted.id));
  assert.ok(copied.every((entry) => Number.isInteger(entry.sourceAgendaItemId)));
  assert.ok(copied.every((entry) => entry.authorTeacherId === TEACHER_A));
  const withoutCtx = unplaced.find((entry) => entry.title === "Sans CTX");
  assert.equal(withoutCtx?.referenceSessionId, "sess-dead");

  for (const entry of unplaced) {
    assert.equal(isVisibleToStudent(entry), false);
    assert.equal(isVisibleToStudent({ ...entry, studentVisible: true }), false);
  }
  assert.equal(getStudentAgendaItems(copied, copied[0]!.classroomId).length, 0);

  const copiedNotes = await seeded.notes.listNotesByAnnualCourse(targetCourse.id);
  assert.equal(copiedNotes.length, 2);
  const placedNote = copiedNotes.find((entry) => entry.sourceNoteId === "n-placed");
  const orphanNote = copiedNotes.find((entry) => entry.sourceNoteId === "n-orphan");
  assert.ok(placedNote?.courseSessionKey);
  assert.equal(orphanNote?.courseSessionKey, null);
  assert.equal(orphanNote?.referenceSessionId, "ref-keep");
  assert.equal(orphanNote?.contextId, CTX_INJECTION);
  assert.equal(orphanNote?.classId, targetCourse.classId);
  assert.equal(orphanNote?.schoolYearId, TARGET_YEAR);
  assert.equal(orphanNote?.annualCourseId, targetCourse.id);
  assert.ok(copiedNotes.every((entry) => entry.sourceNoteId && entry.inheritedAt));

  const retry = await applyPersistedYearTransition(persisted.id, seeded.deps);
  assert.ok(retry.ok && retry.code === "ALREADY_APPLIED", JSON.stringify(retry));
  assert.equal((await seeded.agenda.exportAllItems()).filter((entry) => entry.schoolYearId === TARGET_YEAR).length, 7);
  assert.equal((await seeded.notes.listNotesByAnnualCourse(targetCourse.id)).length, 2);
});

test("17 — moins de séances N+1 : surplus à reclasser, pas perdu", async () => {
  const seeded = await world({
    extraItems: [
      item({ id: 1, title: "S1", courseSessionKey: SOURCE_SESSION, courseSessionDate: "2027-08-23" }),
      item({
        id: 2,
        title: "S6",
        courseSessionKey: LATE_SESSION,
        courseSessionDate: "2027-09-27",
        schoolWeekNumber: 6,
      }),
    ],
    extraNotes: [note("n-late", TEACHER_A, { courseSessionKey: LATE_SESSION })],
  });
  const { preview, persisted } = await persistPreview(seeded, [thursdayB(SOURCE_INJECTION)]);
  const latePub = preview.entries.find((entry) => entry.sourceAgendaItemId === 2);
  assert.equal(latePub?.disposition, "TO_RECLASSIFY");
  assert.equal(latePub?.reason, "UNSCHEDULED_REFERENCE_SESSION");
  assert.equal(preview.privateNotes?.[0]?.disposition, "TO_RECLASSIFY");
  assert.equal(preview.privateNotes?.[0]?.reason, "TARGET_SESSION_UNRESOLVED");

  const result = await applyPersistedYearTransition(persisted.id, seeded.deps);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.createdCount, 1);
  assert.equal(result.toReclassifyCount, 1);
  assert.equal(result.skippedCount, 0);
  const targetCourse = await targetCourseOf(seeded);
  const copied = (await seeded.agenda.exportAllItems()).filter((entry) => entry.schoolYearId === TARGET_YEAR);
  assert.equal(copied.length, 2);
  assert.ok(copied.some((entry) => entry.title === "S1" && entry.courseSessionKey));
  assert.ok(copied.some((entry) => entry.title === "S6" && !entry.courseSessionKey));
  const copiedNotes = await seeded.notes.listNotesByAnnualCourse(targetCourse.id);
  assert.equal(copiedNotes.length, 1);
  assert.equal(copiedNotes[0]?.courseSessionKey, null);
});

test("18-19 — publication sans CTX et note du cours sans référence → à reclasser", async () => {
  const seeded = await world({
    extraItems: [
      item({
        id: 30,
        title: "Clé inconnue",
        courseSessionKey: "year-n|ac-injection-n|1999-01-01",
        courseSessionDate: "1999-01-01",
        schoolWeekNumber: 0,
      }),
    ],
    extraNotes: [note("n-none", TEACHER_A, { courseSessionKey: null, referenceSessionId: null })],
  });
  const { preview, persisted } = await persistPreview(seeded, [mondayAll(SOURCE_INJECTION)]);
  assert.equal(preview.entries[0]?.disposition, "TO_RECLASSIFY");
  assert.equal(preview.entries[0]?.reason, "SOURCE_SESSION_UNRESOLVED");
  assert.equal(preview.privateNotes?.[0]?.disposition, "TO_RECLASSIFY");
  assert.equal(preview.privateNotes?.[0]?.reason, "NO_REFERENCE");
  const result = await applyPersistedYearTransition(persisted.id, seeded.deps);
  assert.equal(result.ok, true, JSON.stringify(result));
  const targetCourse = await targetCourseOf(seeded);
  const copied = (await seeded.agenda.exportAllItems()).filter((entry) => entry.schoolYearId === TARGET_YEAR);
  assert.equal(copied.length, 1);
  assert.equal(copied[0]?.courseSessionKey, null);
  assert.equal(copied[0]?.annualCourseId, targetCourse.id);
  const copiedNotes = await seeded.notes.listNotesByAnnualCourse(targetCourse.id);
  assert.equal(copiedNotes[0]?.courseSessionKey, null);
  assert.equal(copiedNotes[0]?.annualCourseId, targetCourse.id);
});

test("20 — changement de MeetingDay après APPLY : pas de reprojection automatique", async () => {
  const seeded = await world();
  const { persisted } = await persistPreview(seeded, [mondayAll(SOURCE_INJECTION)]);
  const result = await applyPersistedYearTransition(persisted.id, seeded.deps);
  assert.equal(result.ok, true, JSON.stringify(result));
  const targetCourse = await targetCourseOf(seeded);
  const before = (await seeded.agenda.exportAllItems()).filter((entry) => entry.schoolYearId === TARGET_YEAR);
  assert.ok(before.every((entry) => entry.courseSessionKey));
  const originalKeys = before.map((entry) => entry.courseSessionKey).sort();

  await seeded.schedules.replaceMeetingDaysForAnnualCourse(targetCourse.id, [
    {
      id: "md-after",
      annualCourseId: targetCourse.id,
      dayOfWeek: 4,
      weekKind: "B",
      role: "PRIMARY",
      createdAt: "2027-04-01T00:00:00.000Z",
      updatedAt: "2027-04-01T00:00:00.000Z",
    },
  ]);
  const year = await seeded.years.getSchoolYearById(TARGET_YEAR);
  assert.ok(year);
  const live = computeCourseSessions({
    schoolYearId: TARGET_YEAR,
    courses: [{ id: targetCourse.id, classId: targetCourse.classId, contextId: targetCourse.contextId }],
    slots: [],
    weeks: year.weeks,
    holidays: valaisHolidaysForSchoolYear(year.label),
    meetingDays: [{ annualCourseId: targetCourse.id, dayOfWeek: 4, weekKind: "B" }],
  });
  const liveKeys = new Set(live.map((session) => session.key));
  const after = (await seeded.agenda.exportAllItems()).filter((entry) => entry.schoolYearId === TARGET_YEAR);
  assert.deepEqual(
    after.map((entry) => entry.courseSessionKey).sort(),
    originalKeys,
  );
  assert.ok(after.every((entry) => !liveKeys.has(entry.courseSessionKey ?? "")));
  assert.ok(after.every((entry) => publicationNeedsReclassification(entry, liveKeys)));
  assert.equal(countPublicationsToReclassify(after, liveKeys), after.length);
  const rebound = bindPublicationToCourseSession(after[0]!, live[0]!);
  assert.equal(rebound.courseSessionKey, live[0]!.key);
  assert.equal(rebound.studentVisible, after[0]!.studentVisible);
});

test("cas de référence — 36 publications + 15 notes, 50 planifiés, 1 à reclasser, 0 perdu", async () => {
  const publications: PrototypeAgendaItem[] = [];
  let id = 1;
  for (const type of ["HOMEWORK", "TEST", "INFORMATION"] as const) {
    for (let index = 0; index < 11; index += 1) {
      publications.push(item({ id, title: `${type} ${index}`, type }));
      id += 1;
    }
  }
  assert.equal(publications.length, 33);
  publications.push(item({ id: 34, title: "HW extra", type: "HOMEWORK" }));
  publications.push(item({ id: 35, title: "TEST extra", type: "TEST" }));
  publications.push(
    item({
      id: 36,
      title: "À reclasser",
      type: "INFORMATION",
      courseSessionKey: null,
      courseSessionDate: null,
      schoolWeekNumber: 0,
    }),
  );
  assert.equal(publications.length, 36);
  const notes = Array.from({ length: 15 }, (_, index) => note(`n-${index}`, index % 2 === 0 ? TEACHER_A : TEACHER_B));
  const seeded = await world({ extraItems: publications, extraNotes: notes });
  const { preview, persisted } = await persistPreview(seeded, [mondayAll(SOURCE_INJECTION)]);
  assert.equal(preview.entries.length, 36);
  assert.equal(preview.entries.filter((entry) => entry.disposition === "PROJECTABLE").length, 35);
  assert.equal(preview.entries.filter((entry) => entry.disposition === "TO_RECLASSIFY").length, 1);
  assert.equal(preview.privateNotes?.length, 15);
  assert.ok(preview.privateNotes?.every((entry) => entry.disposition === "PROJECTABLE"));

  const result = await applyPersistedYearTransition(persisted.id, seeded.deps);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.createdCount, 35);
  assert.equal(result.toReclassifyCount, 1);
  assert.equal(result.skippedCount, 0);
  assert.equal(result.privateNotes?.createdCount, 15);
  assert.equal(result.privateNotes?.toReclassifyCount, 0);
  const copied = (await seeded.agenda.exportAllItems()).filter((entry) => entry.schoolYearId === TARGET_YEAR);
  assert.equal(copied.length, 36);
  assert.equal(copied.filter((entry) => entry.courseSessionKey).length, 35);
  assert.equal(copied.filter((entry) => !entry.courseSessionKey).length, 1);
  const targetCourse = await targetCourseOf(seeded);
  assert.equal((await seeded.notes.listNotesByAnnualCourse(targetCourse.id)).length, 15);
  assert.equal(copied.filter((entry) => entry.annualCourseId !== targetCourse.id).length, 0);
});

test("legacy sans MeetingDays : les non projectables restent SKIPPED", async () => {
  const seeded = await world({
    extraItems: [
      item({
        id: 40,
        title: "Orphelin legacy",
        courseSessionKey: null,
        courseSessionDate: null,
        schoolWeekNumber: 0,
      }),
    ],
    extraNotes: [note("n-legacy", TEACHER_A, { courseSessionKey: null })],
  });
  const { preview, persisted } = await persistPreview(seeded, undefined, "legacy-skip");
  assert.equal(preview.entries[0]?.disposition, "SKIPPED");
  assert.equal(preview.entries[0]?.reason, "ORPHAN_NO_REFERENCE_ITEM");
  assert.equal(preview.privateNotes?.[0]?.disposition, "SKIPPED");
  const result = await applyPersistedYearTransition(persisted.id, seeded.deps);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.createdCount, 0);
  assert.equal(result.toReclassifyCount, 0);
  assert.equal(result.skippedCount, 1);
  assert.equal(
    (await seeded.agenda.exportAllItems()).filter((entry) => entry.schoolYearId === TARGET_YEAR).length,
    0,
  );
});

test("fingerprint : PROJECTABLE vs TO_RECLASSIFY selon le plan N+1", async () => {
  const seeded = await world({
    extraItems: [
      item({
        id: 2,
        title: "S6",
        courseSessionKey: LATE_SESSION,
        courseSessionDate: "2027-09-27",
        schoolWeekNumber: 6,
      }),
    ],
  });
  const monday = await persistPreview(seeded, [mondayAll(SOURCE_INJECTION)], "fp-monday");
  const thursday = await assembleLiveYearTransitionPreviewInput(
    {
      includePrivateNotes: true,
      privateNotesOwnerTeacherId: TEACHER_A,
      sourceSchoolYearId: SOURCE_YEAR,
      targetSchoolYearId: TARGET_YEAR,
      classMappings: seeded.mappings,
      selectedSourceClassIds: [SOURCE_CLASS],
      targetMeetingDayPlans: [thursdayB(SOURCE_INJECTION)],
    },
    seeded.deps,
  );
  assert.equal(monday.preview.entries[0]?.disposition, "PROJECTABLE");
  assert.equal(buildYearTransitionPreview(thursday).entries[0]?.disposition, "TO_RECLASSIFY");
  assert.notEqual(yearTransitionPreviewFingerprint(monday.input), yearTransitionPreviewFingerprint(thursday));
});

test("notes à reclasser : courseSessionKey null n’est pas une perte", () => {
  assert.equal(noteNeedsReclassification({ courseSessionKey: null }), true);
  assert.equal(noteNeedsReclassification({ courseSessionKey: "year|ac|2027-08-23" }), false);
  assert.equal(
    noteNeedsReclassification({ courseSessionKey: "year|ac|2027-08-23" }, new Set(["other"])),
    true,
  );
});

test("sources — zéro perte MeetingDays, pas de table unclassified", async () => {
  const [applySrc, previewSrc, notesSrc, dispositionSrc, visibilitySrc] = await Promise.all([
    readFile(new URL("../src/features/year-transition/apply.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/year-transition/preview.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/year-transition/private-notes.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/year-transition/disposition.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/agenda/visibility.ts", import.meta.url), "utf8"),
  ]);
  assert.match(applySrc, /CREATED_UNPLACED/);
  assert.match(applySrc, /courseSessionKey: null/);
  assert.match(previewSrc, /isPublicationReclassifyReason/);
  assert.match(notesSrc, /disposition === "TO_RECLASSIFY"/);
  assert.match(dispositionSrc, /YEAR_TRANSITION_PUBLICATION_RECLASSIFY_REASONS/);
  assert.match(visibilitySrc, /sourceTransitionId/);
  assert.doesNotMatch(applySrc, /unclassified_items/);
});
