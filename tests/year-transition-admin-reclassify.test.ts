import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { isVisibleToStudent } from "../src/features/agenda/visibility.ts";
import type { PrototypeAgendaItem } from "../src/features/agenda/demo-items.ts";
import type { AnnualCourse } from "../src/features/annual-courses/types.ts";
import { computeCourseSessions } from "../src/features/course-sessions/compute.ts";
import type { AnnualCourseNote } from "../src/features/pedagogical-path/annual-notes.ts";
import { valaisHolidaysForSchoolYear } from "../src/features/school-days/holidays-valais.ts";
import type { SchoolWeekEntry } from "../src/features/school-year/types.ts";
import {
  YEAR_TRANSITION_RECLASSIFY_COMPLETE,
  YEAR_TRANSITION_RECLASSIFY_FORBIDDEN,
  YEAR_TRANSITION_RECLASSIFY_OTHER_COURSE,
  YEAR_TRANSITION_RECLASSIFY_SESSION_GONE,
  applyYearTransitionReclassify,
  candidateSessionsForCourse,
  inheritedNoteReclassifyKind,
  inheritedPublicationReclassifyKind,
  listYearTransitionReclassifyQueue,
  type YearTransitionReclassifyDeps,
} from "../src/features/year-transition/index.ts";
import { MemoryAgendaStore } from "../src/lib/persistence/memory-store.ts";
import { MemoryAnnualCourseStore } from "../src/lib/persistence/memory-annual-course-store.ts";
import { MemoryAnnualCourseNotesStore } from "../src/lib/persistence/memory-pedagogical-path-store.ts";
import { MemoryCourseScheduleStore } from "../src/lib/persistence/memory-course-schedule-store.ts";
import { MemorySchoolCatalogStore } from "../src/lib/persistence/memory-school-catalog-store.ts";
import {
  MemorySchoolYearStore,
  replaceMemorySchoolYears,
  resetMemorySchoolYearStore,
} from "../src/lib/persistence/memory-school-year-store.ts";

const TARGET_YEAR = "year-n1";
const TARGET_CLASS = "class-mecauto3a";
const COURSE_INJECTION = "ac-injection-n1";
const COURSE_CHASSIS = "ac-chassis-n1";
const CTX_INJECTION = "ctx-injection";
const CTX_CHASSIS = "ctx-chassis";
const TRANSITION = "transition-admin-reclassify";
const ADMIN = { isAdmin: true, kind: "admin" as const };
const TEACHER = { isAdmin: false, kind: "teacher" as const };
const STUDENT = { isAdmin: false, kind: "student" as const };

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

function course(id: string, contextId: string): AnnualCourse {
  return {
    id,
    schoolYearId: TARGET_YEAR,
    classId: TARGET_CLASS,
    contextId,
    isArchived: false,
    archivedAt: null,
    createdAt: "2027-03-01T00:00:00.000Z",
    updatedAt: "2027-03-01T00:00:00.000Z",
  };
}

function publication(
  patch: Partial<PrototypeAgendaItem> & Pick<PrototypeAgendaItem, "id" | "title" | "type">,
): PrototypeAgendaItem {
  return {
    classroomId: "rt-mecauto3a",
    subjectId: "subj-injection",
    authorTeacherId: "teacher-a",
    day: 0,
    hour: 9,
    weekOffset: 0,
    schoolWeekNumber: 0,
    detail: "hérité",
    schoolYearId: TARGET_YEAR,
    annualCourseId: COURSE_INJECTION,
    courseSessionKey: null,
    courseSessionDate: null,
    referenceItemId: null,
    referenceSessionId: null,
    studentVisible: false,
    sourceTransitionId: TRANSITION,
    sourceAgendaItemId: patch.id,
    ...patch,
  };
}

function internalNote(
  id: string,
  patch: Partial<AnnualCourseNote> = {},
): AnnualCourseNote {
  return {
    id,
    schoolYearId: TARGET_YEAR,
    classId: TARGET_CLASS,
    contextId: CTX_INJECTION,
    referenceSessionId: null,
    authorTeacherId: "teacher-a",
    ownerTeacherId: "teacher-a",
    text: "Contenu confidentiel de la note C — ne doit pas apparaître.",
    body: null,
    courseSessionKey: null,
    legacyNoteId: null,
    notebookPosition: 0,
    sourceNoteId: `src-${id}`,
    sourceSchoolYearId: "year-n",
    inheritedAt: "2027-03-01T00:00:00.000Z",
    annualCourseId: COURSE_INJECTION,
    createdAt: "2027-03-01T00:00:00.000Z",
    updatedAt: "2027-03-01T00:00:00.000Z",
    ...patch,
  };
}

async function world(options: {
  extraItems?: PrototypeAgendaItem[];
  extraNotes?: AnnualCourseNote[];
  extraSlots?: boolean;
} = {}) {
  resetMemorySchoolYearStore();
  const weeks = mondayWeeks("2027-08-23", 8);
  replaceMemorySchoolYears([
    {
      id: TARGET_YEAR,
      label: "2027-2028",
      status: "draft",
      startsOn: "2027-08-23",
      endsOn: "2028-07-01",
      sourceFilename: null,
      importedAt: null,
      activatedAt: null,
      createdAt: "2027-01-01T00:00:00.000Z",
      weeks,
    },
  ]);

  const catalog = new MemorySchoolCatalogStore();
  catalog.replaceSnapshot({
    professions: [
      {
        id: "prf-meca",
        adminCode: "PRF-0001",
        label: "Mécanicien d'automobiles",
        classCodePrefix: "MECAUTO",
        durationYears: 4,
        sortOrder: 1,
        isActive: true,
        isArchived: false,
        archivedAt: null,
      },
    ],
    branches: [
      {
        id: "br-injection",
        code: "CP",
        label: "Injection",
        sortOrder: 1,
        isActive: true,
        adminCode: "BR-0001",
        isArchived: false,
        archivedAt: null,
        teachingType: "TECHNICAL",
      },
      {
        id: "br-chassis",
        code: "CP3",
        label: "Châssis",
        sortOrder: 2,
        isActive: true,
        adminCode: "BR-0002",
        isArchived: false,
        archivedAt: null,
        teachingType: "TECHNICAL",
      },
    ],
    contexts: [
      {
        id: CTX_INJECTION,
        adminCode: "CTX-0001",
        professionId: "prf-meca",
        trainingYear: 3,
        branchId: "br-injection",
        isActive: true,
        isArchived: false,
        archivedAt: null,
      },
      {
        id: CTX_CHASSIS,
        adminCode: "CTX-0002",
        professionId: "prf-meca",
        trainingYear: 3,
        branchId: "br-chassis",
        isActive: true,
        isArchived: false,
        archivedAt: null,
      },
    ],
    classes: [
      {
        id: TARGET_CLASS,
        code: "MECAUTO3A",
        label: "MECAUTO 3A",
        sortOrder: 1,
        isActive: true,
        schoolYearId: TARGET_YEAR,
        schoolYearLabel: "2027-2028",
        professionId: "prf-meca",
        trainingYear: 3,
        parallelCode: "A",
        isArchived: false,
        archivedAt: null,
      },
    ],
  });

  const courses = new MemoryAnnualCourseStore();
  await courses.createCourse(course(COURSE_INJECTION, CTX_INJECTION));
  await courses.createCourse(course(COURSE_CHASSIS, CTX_CHASSIS));

  const schedules = new MemoryCourseScheduleStore();
  await schedules.replaceMeetingDaysForAnnualCourse(COURSE_INJECTION, [
    {
      id: "md-inj-mon",
      annualCourseId: COURSE_INJECTION,
      dayOfWeek: 1,
      weekKind: "all",
      role: "PRIMARY",
      createdAt: "2027-03-01T00:00:00.000Z",
      updatedAt: "2027-03-01T00:00:00.000Z",
    },
    {
      id: "md-inj-thu",
      annualCourseId: COURSE_INJECTION,
      dayOfWeek: 4,
      weekKind: "B",
      role: "ADDITIONAL",
      createdAt: "2027-03-01T00:00:00.000Z",
      updatedAt: "2027-03-01T00:00:00.000Z",
    },
  ]);
  await schedules.replaceMeetingDaysForAnnualCourse(COURSE_CHASSIS, [
    {
      id: "md-cha-tue",
      annualCourseId: COURSE_CHASSIS,
      dayOfWeek: 2,
      weekKind: "all",
      role: "PRIMARY",
      createdAt: "2027-03-01T00:00:00.000Z",
      updatedAt: "2027-03-01T00:00:00.000Z",
    },
  ]);
  if (options.extraSlots) {
    await schedules.createSlot({
      id: "slot-inj-p3",
      annualCourseId: COURSE_INJECTION,
      dayOfWeek: 4,
      periodStart: 3,
      periodEnd: 4,
      weekKind: "B",
      validFrom: null,
      validTo: null,
      createdAt: "2027-03-01T00:00:00.000Z",
      updatedAt: "2027-03-01T00:00:00.000Z",
    });
  }

  const live = computeCourseSessions({
    schoolYearId: TARGET_YEAR,
    courses: [
      { id: COURSE_INJECTION, classId: TARGET_CLASS, contextId: CTX_INJECTION },
      { id: COURSE_CHASSIS, classId: TARGET_CLASS, contextId: CTX_CHASSIS },
    ],
    slots: await schedules.listSlots(),
    weeks,
    holidays: valaisHolidaysForSchoolYear("2027-2028"),
    exceptions: [],
    meetingDays: await schedules.listMeetingDays(),
  });
  const injection = live.filter((session) => session.annualCourseId === COURSE_INJECTION);
  const chassis = live.filter((session) => session.annualCourseId === COURSE_CHASSIS);
  const monday0609 = injection.find((session) => session.date === "2027-09-06");
  const thursday1609 = injection.find((session) => session.date === "2027-09-16");
  const monday2009 = injection.find((session) => session.date === "2027-09-20");
  assert.ok(monday0609, "lundi 06.09 attendu dans les CourseSession Injection");
  assert.ok(thursday1609, "jeudi 16.09 attendu dans les CourseSession Injection");
  assert.ok(monday2009, "lundi 20.09 attendu dans les CourseSession Injection");
  assert.ok(chassis[0], "au moins une séance Châssis");

  const notes = new MemoryAnnualCourseNotesStore();
  notes.replaceAllNotes(options.extraNotes ?? []);
  const agenda = new MemoryAgendaStore(options.extraItems ?? []);
  const years = new MemorySchoolYearStore();
  const deps: YearTransitionReclassifyDeps = {
    years,
    catalog,
    courses,
    agenda,
    notes,
    schedules,
  };

  return {
    deps,
    agenda,
    notes,
    schedules,
    injection,
    chassis,
    monday0609,
    thursday1609,
    monday2009,
  };
}

function queueItems(queue: Awaited<ReturnType<typeof listYearTransitionReclassifyQueue>>) {
  return queue.groups.flatMap((group) => group.courses.flatMap((course) => course.items));
}

test("1 — publication courseSessionKey null détectée UNPLACED", async () => {
  const seeded = await world({
    extraItems: [publication({ id: 1, title: "Devoir orphelin", type: "HOMEWORK" })],
  });
  const kind = inheritedPublicationReclassifyKind(
    (await seeded.agenda.exportAllItems())[0]!,
    TARGET_YEAR,
    new Set(seeded.injection.map((session) => session.key)),
  );
  assert.equal(kind, "UNPLACED");
  const queue = await listYearTransitionReclassifyQueue(seeded.deps, TARGET_YEAR, ADMIN);
  assert.equal(queue.count, 1);
  assert.equal(queueItems(queue)[0]?.reclassifyKind, "UNPLACED");
});

test("2 — note courseSessionKey null détectée UNPLACED", async () => {
  const seeded = await world({ extraNotes: [internalNote("note-c")] });
  const kind = inheritedNoteReclassifyKind(
    (await seeded.notes.getNote("note-c"))!,
    TARGET_YEAR,
    new Set(seeded.injection.map((session) => session.key)),
  );
  assert.equal(kind, "UNPLACED");
  const queue = await listYearTransitionReclassifyQueue(seeded.deps, TARGET_YEAR, ADMIN);
  assert.equal(queue.count, 1);
  assert.equal(queueItems(queue)[0]?.typeLabel, "Note interne");
  assert.equal(queueItems(queue)[0]?.title, null);
});

test("3 — publication avec clé inexistante détectée ORPHANED", async () => {
  const seeded = await world({
    extraItems: [
      publication({
        id: 2,
        title: "Contrôle orphelin",
        type: "TEST",
        courseSessionKey: `${TARGET_YEAR}|${COURSE_INJECTION}|1999-01-01`,
        courseSessionDate: "1999-01-01",
        schoolWeekNumber: 1,
      }),
    ],
  });
  const queue = await listYearTransitionReclassifyQueue(seeded.deps, TARGET_YEAR, ADMIN);
  assert.equal(queueItems(queue)[0]?.reclassifyKind, "ORPHANED");
});

test("4 — note avec clé inexistante détectée ORPHANED", async () => {
  const seeded = await world({
    extraNotes: [
      internalNote("note-orphan", {
        courseSessionKey: `${TARGET_YEAR}|${COURSE_INJECTION}|1999-01-01`,
      }),
    ],
  });
  const queue = await listYearTransitionReclassifyQueue(seeded.deps, TARGET_YEAR, ADMIN);
  assert.equal(queueItems(queue)[0]?.reclassifyKind, "ORPHANED");
});

test("sans provenance de transition : publication et note absentes du bac admin", async () => {
  const seeded = await world({
    extraItems: [
      publication({
        id: 40,
        title: "Créé par l’enseignant",
        type: "HOMEWORK",
        sourceTransitionId: null,
        sourceAgendaItemId: null,
      }),
    ],
    extraNotes: [
      internalNote("note-local", {
        sourceNoteId: null,
        inheritedAt: null,
        sourceSchoolYearId: null,
      }),
    ],
  });
  const queue = await listYearTransitionReclassifyQueue(seeded.deps, TARGET_YEAR, ADMIN);
  assert.equal(queue.count, 0);
});

test("5 — publication avec vraie séance valide absente du bac", async () => {
  const seeded = await world({
    extraItems: [
      publication({
        id: 3,
        title: "Devoir A",
        type: "HOMEWORK",
        courseSessionKey: `${TARGET_YEAR}|${COURSE_INJECTION}|2027-09-06`,
        courseSessionDate: "2027-09-06",
        schoolWeekNumber: 3,
        day: 0,
      }),
    ],
  });
  const queue = await listYearTransitionReclassifyQueue(seeded.deps, TARGET_YEAR, ADMIN);
  assert.equal(queue.count, 0);
  assert.equal(queue.complete, true);
});

test("6 — note avec vraie séance valide absente du bac", async () => {
  const seeded = await world({
    extraNotes: [
      internalNote("note-placed", {
        courseSessionKey: `${TARGET_YEAR}|${COURSE_INJECTION}|2027-09-06`,
      }),
    ],
  });
  const queue = await listYearTransitionReclassifyQueue(seeded.deps, TARGET_YEAR, ADMIN);
  assert.equal(queue.count, 0);
});

test("7-8 — séances candidates uniquement du même AnnualCourse et de l’année cible", async () => {
  const seeded = await world({
    extraItems: [publication({ id: 4, title: "Contrôle B", type: "TEST" })],
  });
  const queue = await listYearTransitionReclassifyQueue(seeded.deps, TARGET_YEAR, ADMIN);
  const course = queue.groups[0]?.courses.find((entry) => entry.annualCourseId === COURSE_INJECTION);
  assert.ok(course);
  assert.ok(course.sessions.length > 0);
  assert.ok(course.sessions.every((session) => session.annualCourseId === COURSE_INJECTION));
  assert.ok(course.sessions.every((session) => session.schoolYearId === TARGET_YEAR));
  assert.equal(
    course.sessions.some((session) => session.annualCourseId === COURSE_CHASSIS),
    false,
  );
  const chassisKeys = new Set(seeded.chassis.map((session) => session.key));
  assert.equal(course.sessions.some((session) => chassisKeys.has(session.key)), false);
  const listed = candidateSessionsForCourse(seeded.injection, TARGET_YEAR, COURSE_INJECTION);
  assert.deepEqual(
    listed.map((session) => session.key),
    course.sessions.map((session) => session.key),
  );
});

test("9-12 — admin peut reclasser HOMEWORK, TEST, INFORMATION et note", async () => {
  const seeded = await world({
    extraItems: [
      publication({ id: 10, title: "Devoir A", type: "HOMEWORK" }),
      publication({ id: 11, title: "Contrôle B", type: "TEST" }),
      publication({ id: 12, title: "Info D", type: "INFORMATION" }),
    ],
    extraNotes: [internalNote("note-c")],
  });
  const thursday = seeded.thursday1609.key;
  const monday = seeded.monday2009.key;
  for (const [kind, publicationId, noteId, key] of [
    ["publication", 10, null, thursday],
    ["publication", 11, null, thursday],
    ["publication", 12, null, monday],
    ["note", null, "note-c", monday],
  ] as const) {
    const result = await applyYearTransitionReclassify(
      seeded.deps,
      {
        schoolYearId: TARGET_YEAR,
        kind,
        publicationId,
        noteId,
        courseSessionKey: key,
      },
      ADMIN,
    );
    assert.equal(result.ok, true, JSON.stringify(result));
  }
  const queue = await listYearTransitionReclassifyQueue(seeded.deps, TARGET_YEAR, ADMIN);
  assert.equal(queue.count, 0);
});

test("13 — enseignant standard refusé", async () => {
  const seeded = await world({
    extraItems: [publication({ id: 13, title: "Contrôle B", type: "TEST" })],
  });
  await assert.rejects(
    () => listYearTransitionReclassifyQueue(seeded.deps, TARGET_YEAR, TEACHER),
    (error: unknown) => error instanceof Error && error.message === YEAR_TRANSITION_RECLASSIFY_FORBIDDEN,
  );
  const result = await applyYearTransitionReclassify(
    seeded.deps,
    {
      schoolYearId: TARGET_YEAR,
      kind: "publication",
      publicationId: 13,
      courseSessionKey: seeded.thursday1609.key,
    },
    TEACHER,
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 403);
  assert.equal(result.reason, YEAR_TRANSITION_RECLASSIFY_FORBIDDEN);
});

test("14 — élève refusé", async () => {
  const seeded = await world({
    extraItems: [publication({ id: 14, title: "Contrôle B", type: "TEST" })],
  });
  await assert.rejects(
    () => listYearTransitionReclassifyQueue(seeded.deps, TARGET_YEAR, STUDENT),
    /administrateur/,
  );
  const result = await applyYearTransitionReclassify(
    seeded.deps,
    {
      schoolYearId: TARGET_YEAR,
      kind: "publication",
      publicationId: 14,
      courseSessionKey: seeded.thursday1609.key,
    },
    STUDENT,
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 403);
});

test("15-17 — reclassement publication écrit la vraie séance et garde studentVisible false", async () => {
  const seeded = await world({
    extraItems: [publication({ id: 15, title: "Contrôle B", type: "TEST", studentVisible: false })],
  });
  const result = await applyYearTransitionReclassify(
    seeded.deps,
    {
      schoolYearId: TARGET_YEAR,
      kind: "publication",
      publicationId: 15,
      courseSessionKey: seeded.thursday1609.key,
    },
    ADMIN,
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.publication?.courseSessionKey, seeded.thursday1609.key);
  assert.equal(result.publication?.courseSessionDate, "2027-09-16");
  assert.equal(result.publication?.studentVisible, false);
  assert.equal(isVisibleToStudent(result.publication!), false);
});

test("18-19 — reclassement note écrit la vraie clé et conserve la provenance", async () => {
  const seeded = await world({ extraNotes: [internalNote("note-c")] });
  const before = (await seeded.notes.getNote("note-c"))!;
  const result = await applyYearTransitionReclassify(
    seeded.deps,
    {
      schoolYearId: TARGET_YEAR,
      kind: "note",
      noteId: "note-c",
      courseSessionKey: seeded.monday2009.key,
    },
    ADMIN,
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.note?.courseSessionKey, seeded.monday2009.key);
  assert.equal(result.note?.sourceNoteId, before.sourceNoteId);
  assert.equal(result.note?.inheritedAt, before.inheritedAt);
  assert.equal(result.note?.sourceSchoolYearId, before.sourceSchoolYearId);
  assert.equal(result.note?.authorTeacherId, before.authorTeacherId);
  assert.equal(result.note?.annualCourseId, COURSE_INJECTION);
  assert.equal(result.note?.schoolYearId, TARGET_YEAR);
  assert.equal(result.note?.classId, TARGET_CLASS);
  assert.equal(result.note?.contextId, CTX_INJECTION);
  assert.equal(result.note?.text, before.text);
});

test("20 — séance d’un autre AnnualCourse refusée", async () => {
  const seeded = await world({
    extraItems: [publication({ id: 20, title: "Contrôle B", type: "TEST" })],
  });
  const result = await applyYearTransitionReclassify(
    seeded.deps,
    {
      schoolYearId: TARGET_YEAR,
      kind: "publication",
      publicationId: 20,
      courseSessionKey: seeded.chassis[0]!.key,
    },
    ADMIN,
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, YEAR_TRANSITION_RECLASSIFY_OTHER_COURSE);
  const still = await seeded.agenda.findAgendaItem(20);
  assert.equal(still?.courseSessionKey, null);
});

test("21 — séance disparue entre chargement et sauvegarde refusée proprement", async () => {
  const seeded = await world({
    extraItems: [publication({ id: 21, title: "Contrôle B", type: "TEST" })],
  });
  const queue = await listYearTransitionReclassifyQueue(seeded.deps, TARGET_YEAR, ADMIN);
  const chosen = queue.groups[0]?.courses[0]?.sessions.find((session) => session.date === "2027-09-16");
  assert.ok(chosen);
  await seeded.schedules.replaceMeetingDaysForAnnualCourse(COURSE_INJECTION, [
    {
      id: "md-inj-wed-only",
      annualCourseId: COURSE_INJECTION,
      dayOfWeek: 3,
      weekKind: "all",
      role: "PRIMARY",
      createdAt: "2027-03-02T00:00:00.000Z",
      updatedAt: "2027-03-02T00:00:00.000Z",
    },
  ]);
  const result = await applyYearTransitionReclassify(
    seeded.deps,
    {
      schoolYearId: TARGET_YEAR,
      kind: "publication",
      publicationId: 21,
      courseSessionKey: chosen.key,
    },
    ADMIN,
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 409);
  assert.equal(result.reason, YEAR_TRANSITION_RECLASSIFY_SESSION_GONE);
});

test("22-24 — l’élément disparaît, le compteur diminue, 0 affiche l’état complet", async () => {
  const seeded = await world({
    extraItems: [
      publication({ id: 22, title: "Contrôle B", type: "TEST" }),
      publication({ id: 23, title: "Devoir restant", type: "HOMEWORK" }),
    ],
  });
  const before = await listYearTransitionReclassifyQueue(seeded.deps, TARGET_YEAR, ADMIN);
  assert.equal(before.count, 2);
  const first = await applyYearTransitionReclassify(
    seeded.deps,
    {
      schoolYearId: TARGET_YEAR,
      kind: "publication",
      publicationId: 22,
      courseSessionKey: seeded.thursday1609.key,
    },
    ADMIN,
  );
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.queue.count, 1);
  assert.equal(first.queue.complete, false);
  assert.equal(queueItems(first.queue).some((item) => item.publicationId === 22), false);
  const second = await applyYearTransitionReclassify(
    seeded.deps,
    {
      schoolYearId: TARGET_YEAR,
      kind: "publication",
      publicationId: 23,
      courseSessionKey: seeded.monday2009.key,
    },
    ADMIN,
  );
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.queue.count, 0);
  assert.equal(second.queue.complete, true);
  assert.equal(YEAR_TRANSITION_RECLASSIFY_COMPLETE, "Tous les éléments transférés sont positionnés.");
});

test("25 — provenance de transition inchangée après reclassement", async () => {
  const seeded = await world({
    extraItems: [
      publication({
        id: 25,
        title: "Contrôle B",
        type: "TEST",
        sourceTransitionId: TRANSITION,
        sourceAgendaItemId: 99,
        authorTeacherId: "teacher-historic",
      }),
    ],
  });
  const result = await applyYearTransitionReclassify(
    seeded.deps,
    {
      schoolYearId: TARGET_YEAR,
      kind: "publication",
      publicationId: 25,
      courseSessionKey: seeded.thursday1609.key,
    },
    ADMIN,
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.publication?.sourceTransitionId, TRANSITION);
  assert.equal(result.publication?.sourceAgendaItemId, 99);
  assert.equal(result.publication?.authorTeacherId, "teacher-historic");
  assert.equal(result.publication?.annualCourseId, COURSE_INJECTION);
  assert.equal(result.publication?.title, "Contrôle B");
});

test("cas fonctionnel — CP Injection, Contrôle B et Note C reclassés, Devoir A déjà planifié", async () => {
  const seeded = await world({
    extraItems: [
      publication({
        id: 101,
        title: "Devoir A",
        type: "HOMEWORK",
        courseSessionKey: `${TARGET_YEAR}|${COURSE_INJECTION}|2027-09-06`,
        courseSessionDate: "2027-09-06",
        schoolWeekNumber: 3,
        day: 0,
      }),
      publication({ id: 102, title: "Contrôle B", type: "TEST" }),
    ],
    extraNotes: [internalNote("note-c")],
  });
  const opened = await listYearTransitionReclassifyQueue(seeded.deps, TARGET_YEAR, ADMIN);
  assert.equal(opened.count, 2);
  assert.match(opened.yearLabel, /2027–2028|2027-2028/);
  assert.equal(opened.groups[0]?.classLabel, "MECAUTO3A");
  const injection = opened.groups[0]?.courses.find((entry) => entry.annualCourseId === COURSE_INJECTION);
  assert.match(injection?.courseLabel ?? "", /Injection/);
  assert.equal(injection?.items.some((item) => item.title === "Devoir A"), false);
  assert.ok(injection?.items.some((item) => item.title === "Contrôle B" && item.typeLabel === "Contrôle"));
  assert.ok(injection?.items.some((item) => item.typeLabel === "Note interne" && item.title === null));
  assert.equal(
    JSON.stringify(opened).includes("Contenu confidentiel de la note C"),
    false,
  );

  const control = await applyYearTransitionReclassify(
    seeded.deps,
    {
      schoolYearId: TARGET_YEAR,
      kind: "publication",
      publicationId: 102,
      courseSessionKey: seeded.thursday1609.key,
    },
    ADMIN,
  );
  assert.equal(control.ok, true);
  if (!control.ok) return;
  assert.equal(control.queue.count, 1);
  assert.equal(control.publication?.courseSessionDate, "2027-09-16");
  assert.equal(control.publication?.studentVisible, false);

  const note = await applyYearTransitionReclassify(
    seeded.deps,
    {
      schoolYearId: TARGET_YEAR,
      kind: "note",
      noteId: "note-c",
      courseSessionKey: seeded.monday2009.key,
    },
    ADMIN,
  );
  assert.equal(note.ok, true);
  if (!note.ok) return;
  assert.equal(note.queue.count, 0);
  assert.equal(note.queue.complete, true);
  assert.equal(note.note?.courseSessionKey, seeded.monday2009.key);

  const devoir = await seeded.agenda.findAgendaItem(101);
  assert.equal(devoir?.courseSessionKey, `${TARGET_YEAR}|${COURSE_INJECTION}|2027-09-06`);
  const controle = await seeded.agenda.findAgendaItem(102);
  assert.equal(controle?.studentVisible, false);
  assert.equal(isVisibleToStudent(controle!), false);
});

test("séances avec périodes affichent P3-P4, sans périodes seulement la date", async () => {
  const withPeriods = await world({ extraSlots: true, extraItems: [publication({ id: 30, title: "B", type: "TEST" })] });
  const labelled = withPeriods.thursday1609;
  assert.match(
    (await listYearTransitionReclassifyQueue(withPeriods.deps, TARGET_YEAR, ADMIN))
      .groups[0]?.courses[0]?.sessions.find((session) => session.key === labelled.key)?.label ?? "",
    /Jeudi 16 septembre 2027 — P3-P4/,
  );
  const without = await world({ extraItems: [publication({ id: 31, title: "B", type: "TEST" })] });
  const plain = (await listYearTransitionReclassifyQueue(without.deps, TARGET_YEAR, ADMIN))
    .groups[0]?.courses[0]?.sessions.find((session) => session.date === "2027-09-16")?.label ?? "";
  assert.equal(plain, "Jeudi 16 septembre 2027");
});

test("routes et UI : admin only, pas de bac Carnet, pas de texte de note", async () => {
  const route = await readFile(new URL("../web/app/api/admin/year-transition/reclassify/route.ts", import.meta.url), "utf8");
  assert.match(route, /requireAdminSession/);
  assert.match(route, /listYearTransitionReclassifyQueue/);
  assert.match(route, /applyYearTransitionReclassify/);
  const panel = await readFile(new URL("../web/app/components/year-transition-prepare-panel.tsx", import.meta.url), "utf8");
  assert.match(panel, /Reclasser les/);
  assert.match(panel, /Tous les éléments transférés sont positionnés/);
  assert.match(panel, /YearTransitionReclassifyPanel/);
  assert.doesNotMatch(panel, /Attributions des cours[\s\S]*À reclasser/);
  const view = await readFile(new URL("../web/app/components/year-transition-reclassify-panel.tsx", import.meta.url), "utf8");
  assert.match(view, /item\.typeLabel/);
  assert.match(view, /Séance cible/);
  assert.match(view, /queueMicrotask/);
  assert.doesNotMatch(view, /item\.text|note\.text|\.body/);
  const notebook = await readFile(new URL("../src/features/class-notebook/index.ts", import.meta.url), "utf8");
  assert.doesNotMatch(notebook, /YearTransitionReclassifyPanel/);
  const assignments = await readFile(new URL("../web/app/components/annual-courses-admin-panel.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(assignments, /YearTransitionReclassifyPanel/);
  const schedules = await readFile(new URL("../web/app/components/class-schedule-admin-panel.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(schedules, /YearTransitionReclassifyPanel/);
});
