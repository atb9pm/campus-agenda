import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  archiveAnnualCourse,
  assignTeacherToCourse,
  assignTemporaryReplacement,
  createAnnualCourse,
  type AnnualCourseServiceDeps,
} from "../src/features/annual-courses/index.ts";
import type { CourseSession } from "../src/features/course-sessions/types.ts";
import { formatCourseSessionPeriods } from "../src/features/course-sessions/format.ts";
import {
  annualCourseIdFromSearchParams,
  buildCourseTimeline,
  COURSE_TIMELINE_COHERENCE_REASON,
  COURSE_TIMELINE_FORBIDDEN_REASON,
  COURSE_TIMELINE_MISSING_ID_REASON,
  COURSE_TIMELINE_NOT_FOUND_REASON,
  getTeacherCourseTimeline,
  sessionTeacherIdForTimelineApi,
  type CourseTimelineIdentity,
  type CourseTimelineServiceDeps,
} from "../src/features/course-timeline/index.ts";
import { createEmptyPath } from "../src/features/pedagogical-path/path-logic.ts";
import type {
  ReferencePedagogicalPath,
  ReferenceSession,
} from "../src/features/pedagogical-path/types.ts";
import { TEACHER_NAV_SECTIONS } from "../src/features/teacher/index.ts";
import { APP_VERSION } from "../src/lib/app-version.ts";
import {
  MemoryAnnualCourseStore,
  resetMemoryAnnualCourseStore,
} from "../src/lib/persistence/memory-annual-course-store.ts";
import { MemoryCourseScheduleStore } from "../src/lib/persistence/memory-course-schedule-store.ts";
import {
  MemoryPedagogicalPathStore,
  getMemoryAnnualCourseNotesStore,
  resetMemoryPedagogicalPathStore,
} from "../src/lib/persistence/memory-pedagogical-path-store.ts";
import {
  getMemorySchoolCatalogStore,
  resetMemorySchoolCatalogStore,
} from "../src/lib/persistence/memory-school-catalog-store.ts";
import {
  getMemoryTeacherAccountStore,
  resetMemoryTeacherAccountStore,
} from "../src/lib/persistence/memory-teacher-account-store.ts";
import { SQL_MIGRATION_FILES } from "../src/lib/persistence/sql/migrate.ts";
import type { SchoolYearRecord } from "../src/features/school-year/types.ts";
import type { SchoolYearStore } from "../src/lib/persistence/school-year-types.ts";
import type { PedagogicalPathStore } from "../src/lib/persistence/pedagogical-path-types.ts";
import type { CourseScheduleSlot } from "../src/features/course-schedule/types.ts";

const TODAY = "2027-10-15T12:00:00.000Z";
const IDENTITY: CourseTimelineIdentity = {
  schoolYearId: "SY-2026-27",
  classId: "class-ma3a",
  annualCourseId: "AC-MA3A-MOTEUR",
  contextId: "ctx-moteur-y3",
};

function yearRecord(
  id: string,
  label: string,
  status: SchoolYearRecord["status"],
): SchoolYearRecord {
  return {
    id,
    label,
    status,
    startsOn: `${label.slice(0, 4)}-08-01`,
    endsOn: `${label.slice(5)}-07-31`,
    sourceFilename: null,
    importedAt: null,
    activatedAt: status === "active" ? "2027-08-01T00:00:00.000Z" : null,
    createdAt: "2027-01-01T00:00:00.000Z",
  };
}

function mondayWeeks(startMonday: string, count: number) {
  const weeks: Array<{ number: number; kind: "A" | "B"; monday: string }> = [];
  const [year, month, day] = startMonday.split("-").map(Number);
  const cursor = new Date(year, month - 1, day, 12);
  for (let number = 1; number <= count; number += 1) {
    const iso = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
    weeks.push({ number, kind: number % 2 === 1 ? "A" : "B", monday: iso });
    cursor.setDate(cursor.getDate() + 7);
  }
  return weeks;
}

function yearsStoreWithWeeks(
  years: SchoolYearRecord[] = [
    yearRecord("year-2027", "2027-2028", "active"),
    yearRecord("year-2026", "2026-2027", "archived"),
  ],
): SchoolYearStore {
  const weeks2027 = mondayWeeks("2027-08-16", 24);
  const weeks2026 = mondayWeeks("2026-08-17", 8);
  return {
    listSchoolYears: async () => years,
    getActiveSchoolYear: async () => {
      const active = years.find((entry) => entry.status === "active");
      return active ? { ...active, weeks: weeks2027 } : null;
    },
    getSchoolYearById: async (id: string) => {
      const year = years.find((entry) => entry.id === id);
      if (!year) return null;
      return { ...year, weeks: year.id === "year-2026" ? weeks2026 : weeks2027 };
    },
    listDayExceptions: async () => [],
  } as SchoolYearStore;
}

function session(
  patch: Partial<CourseSession> & Pick<CourseSession, "sequenceNumber" | "date">,
): CourseSession {
  const annualCourseId = patch.annualCourseId ?? IDENTITY.annualCourseId;
  const schoolYearId = patch.schoolYearId ?? IDENTITY.schoolYearId;
  return {
    key: patch.key ?? `${schoolYearId}|${annualCourseId}|${patch.date}`,
    schoolYearId,
    annualCourseId,
    classId: patch.classId ?? IDENTITY.classId,
    contextId: patch.contextId ?? IDENTITY.contextId,
    date: patch.date,
    schoolWeekNumber: patch.schoolWeekNumber ?? patch.sequenceNumber,
    weekKind: patch.weekKind ?? "A",
    dayOfWeek: patch.dayOfWeek ?? 1,
    sequenceNumber: patch.sequenceNumber,
    segments: patch.segments ?? [{ scheduleSlotId: "slot-p2", periodStart: 2, periodEnd: 3 }],
  };
}

function reference(
  patch: Partial<ReferenceSession> & Pick<ReferenceSession, "id" | "position">,
): ReferenceSession {
  return {
    id: patch.id,
    position: patch.position,
    label: patch.label === undefined ? `Séance ${patch.position}` : patch.label,
    items: patch.items ?? [],
  };
}

function pathFor(
  sessions: ReferenceSession[],
  contextId = IDENTITY.contextId,
): ReferencePedagogicalPath {
  return {
    id: `path-${contextId}`,
    contextId,
    sessions,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function unwrap(result: ReturnType<typeof buildCourseTimeline>) {
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}

function mondaySlot(annualCourseId: string, id: string, start: number, end: number): CourseScheduleSlot {
  return {
    id,
    annualCourseId,
    dayOfWeek: 1,
    periodStart: start,
    periodEnd: end,
    weekKind: "all",
    validFrom: null,
    validTo: null,
    createdAt: "2027-08-01T00:00:00.000Z",
    updatedAt: "2027-08-01T00:00:00.000Z",
  };
}

async function fixture() {
  resetMemorySchoolCatalogStore();
  resetMemoryAnnualCourseStore();
  resetMemoryPedagogicalPathStore();
  resetMemoryTeacherAccountStore();
  const catalog = getMemorySchoolCatalogStore();
  await catalog.ensureSeeded();
  const profession = await catalog.createProfession({
    label: "Mécanicien en maintenance d’automobiles",
    durationYears: 4,
    classCodePrefix: "MECMA",
  });
  const branches = await catalog.listBranches();
  const moteur = branches.find((entry) => entry.label === "Moteur") ?? branches[0]!;
  const elec = branches.find((entry) => /électri/i.test(entry.label)) ?? branches[1] ?? moteur;
  await catalog.updateBranch(moteur.id, { teachingType: "TECHNICAL" });
  if (elec.id !== moteur.id) await catalog.updateBranch(elec.id, { teachingType: "TECHNICAL" });

  const ctxMoteur = await catalog.createContext({
    professionId: profession.id,
    trainingYear: 1,
    branchId: moteur.id,
  });
  const ctxElec = await catalog.createContext({
    professionId: profession.id,
    trainingYear: 1,
    branchId: elec.id,
  });
  const ctxMoteurY2 = await catalog.createContext({
    professionId: profession.id,
    trainingYear: 2,
    branchId: moteur.id,
  });
  assert.equal(ctxMoteur.ok && ctxElec.ok && ctxMoteurY2.ok, true);
  if (!ctxMoteur.ok || !ctxElec.ok || !ctxMoteurY2.ok) throw new Error("CTX");

  const classA = await catalog.createClass({
    code: "MECMA1A",
    label: "MECMA 1A",
    sortOrder: 2,
    schoolYearId: "year-2027",
    schoolYearLabel: "2027-2028",
    professionId: profession.id,
    trainingYear: 1,
    parallelCode: "A",
  });
  const classB = await catalog.createClass({
    code: "MECMA1B",
    label: "MECMA 1B",
    sortOrder: 3,
    schoolYearId: "year-2027",
    schoolYearLabel: "2027-2028",
    professionId: profession.id,
    trainingYear: 1,
    parallelCode: "B",
  });
  const classYear2 = await catalog.createClass({
    code: "MECMA2A",
    label: "MECMA 2A",
    sortOrder: 4,
    schoolYearId: "year-2027",
    schoolYearLabel: "2027-2028",
    professionId: profession.id,
    trainingYear: 2,
    parallelCode: "A",
  });
  const classLegacyYear = await catalog.createClass({
    code: "MECMA1A",
    label: "MECMA 1A 2026",
    sortOrder: 9,
    schoolYearId: "year-2026",
    schoolYearLabel: "2026-2027",
    professionId: profession.id,
    trainingYear: 1,
    parallelCode: "A",
  });

  const teachers = getMemoryTeacherAccountStore();
  const alice = await teachers.createAccount({
    displayName: "Alice Titulaire",
    initials: "AlT",
    teachingType: "TECHNICAL",
  });
  const bob = await teachers.createAccount({
    displayName: "Bob Coenseignant",
    initials: "BoC",
    teachingType: "TECHNICAL",
  });
  const admin = await teachers.createAccount({
    displayName: "Admin Sans cours",
    initials: "AdM",
    teachingType: "TECHNICAL",
    isAdmin: true,
  });
  assert.ok(alice.ok && bob.ok && admin.ok);

  const deps: AnnualCourseServiceDeps = {
    courses: new MemoryAnnualCourseStore(),
    catalog,
    years: yearsStoreWithWeeks(),
    teachers,
    notes: getMemoryAnnualCourseNotesStore(),
  };

  return {
    deps,
    catalog,
    moteur,
    ctxMoteur: ctxMoteur.value,
    ctxElec: ctxElec.value,
    ctxMoteurY2: ctxMoteurY2.value,
    classA,
    classB,
    classYear2,
    classLegacyYear,
    alice: alice.ok ? alice.account : null!,
    bob: bob.ok ? bob.account : null!,
    admin: admin.ok ? admin.account : null!,
    teachers,
  };
}

function watchPaths(inner: PedagogicalPathStore) {
  let saves = 0;
  const store: PedagogicalPathStore = {
    getPathByContextId: (contextId) => inner.getPathByContextId(contextId),
    listPaths: () => inner.listPaths(),
    savePath: async (path) => {
      saves += 1;
      return inner.savePath(path);
    },
    deletePathByContextId: (contextId) => inner.deletePathByContextId(contextId),
  };
  return { store, saved: () => saves };
}

function timelineDeps(
  fx: Awaited<ReturnType<typeof fixture>>,
  paths: PedagogicalPathStore,
  schedules = new MemoryCourseScheduleStore(),
): CourseTimelineServiceDeps {
  return {
    courses: fx.deps.courses,
    catalog: fx.catalog,
    years: fx.deps.years,
    teachers: fx.teachers,
    schedules,
    paths,
  };
}

async function seedAssignedCourse(
  fx: Awaited<ReturnType<typeof fixture>>,
  options: {
    teacherId: string;
    role?: "PRIMARY" | "CO_TEACHER";
    classId?: string;
    contextId?: string;
    schoolYearId?: string;
  },
) {
  const course = await createAnnualCourse(fx.deps, {
    schoolYearId: options.schoolYearId ?? "year-2027",
    classId: options.classId ?? fx.classA.id,
    contextId: options.contextId ?? fx.ctxMoteur.id,
  });
  assert.equal(course.ok, true);
  if (!course.ok) throw new Error(course.reason);
  const assigned = await assignTeacherToCourse(fx.deps, {
    annualCourseId: course.value.id,
    teacherId: options.teacherId,
    role: options.role ?? "PRIMARY",
    createdByAdminId: "admin-1",
    validFrom: "2027-08-01",
  });
  assert.equal(assigned.ok, true);
  if (!assigned.ok) throw new Error(assigned.reason);
  return course.value;
}

test("version 2.30.0 — déroulement, migration 0024, aucune table CourseSession", () => {
  assert.equal(APP_VERSION, "2.30.0");
  assert.equal(SQL_MIGRATION_FILES.at(-1), "0024_structured_agenda_bridge.sql");
  assert.equal(
    SQL_MIGRATION_FILES.some((file) => file.startsWith("0025")),
    false,
  );
  assert.deepEqual([...TEACHER_NAV_SECTIONS], [
    "mes-cours",
    "ma-semaine",
    "configuration",
    "administration",
  ]);
});

test("A — sequence 1,2,3 ↔ reference positions 1,2,3", () => {
  const projection = unwrap(
    buildCourseTimeline({
      identity: IDENTITY,
      courseSessions: [
        session({ sequenceNumber: 1, date: "2026-08-24" }),
        session({ sequenceNumber: 2, date: "2026-08-31" }),
        session({ sequenceNumber: 3, date: "2026-09-07" }),
      ],
      referencePath: pathFor([
        reference({ id: "rs-1", position: 1, label: "Introduction" }),
        reference({ id: "rs-2", position: 2, label: "Cycle 4 temps" }),
        reference({ id: "rs-3", position: 3, label: "Distribution" }),
      ]),
    }),
  );
  assert.equal(projection.referencePathExists, true);
  assert.deepEqual(
    projection.entries.map((entry) => [
      entry.courseSession.sequenceNumber,
      entry.referenceSession?.position,
      entry.referenceSession?.label,
    ]),
    [
      [1, 1, "Introduction"],
      [2, 2, "Cycle 4 temps"],
      [3, 3, "Distribution"],
    ],
  );
  assert.equal(projection.unscheduledReferenceSessions.length, 0);
});

test("B — CourseSession #7 P4 + P6 → une entrée → référence position 7", () => {
  const projection = unwrap(
    buildCourseTimeline({
      identity: IDENTITY,
      courseSessions: [
        session({
          sequenceNumber: 7,
          date: "2026-09-14",
          segments: [
            { scheduleSlotId: "p4", periodStart: 4, periodEnd: 4 },
            { scheduleSlotId: "p6", periodStart: 6, periodEnd: 6 },
          ],
        }),
      ],
      referencePath: pathFor([
        reference({ id: "rs-7", position: 7, label: "Lubrification" }),
        reference({ id: "rs-8", position: 8, label: "Ne doit pas être liée à P6" }),
      ]),
    }),
  );
  assert.equal(projection.entries.length, 1);
  assert.equal(projection.entries[0]?.referenceSession?.position, 7);
  assert.equal(projection.entries[0]?.referenceSession?.label, "Lubrification");
  assert.equal(projection.entries[0]?.courseSession.segments.length, 2);
  assert.equal(formatCourseSessionPeriods(projection.entries[0]!.courseSession.segments), "P4 · P6");
  assert.equal(projection.unscheduledReferenceSessions[0]?.position, 8);
});

test("C — dates non consécutives : la projection ignore les trous calendaires", () => {
  const projection = unwrap(
    buildCourseTimeline({
      identity: IDENTITY,
      courseSessions: [
        session({ sequenceNumber: 1, date: "2026-08-24" }),
        session({ sequenceNumber: 2, date: "2026-08-31" }),
        session({ sequenceNumber: 3, date: "2026-09-14" }),
      ],
      referencePath: pathFor([
        reference({ id: "rs-1", position: 1, label: "Introduction" }),
        reference({ id: "rs-2", position: 2, label: "Cycle 4 temps" }),
        reference({ id: "rs-3", position: 3, label: "Distribution" }),
      ]),
    }),
  );
  assert.deepEqual(
    projection.entries.map((entry) => [entry.courseSession.date, entry.referenceSession?.label]),
    [
      ["2026-08-24", "Introduction"],
      ["2026-08-31", "Cycle 4 temps"],
      ["2026-09-14", "Distribution"],
    ],
  );
});

test("D — parcours plus court : dates 21..34 restent visibles", () => {
  const courseSessions = Array.from({ length: 5 }, (_, index) =>
    session({ sequenceNumber: index + 1, date: `2026-08-${String(24 + index).padStart(2, "0")}` }),
  );
  const projection = unwrap(
    buildCourseTimeline({
      identity: IDENTITY,
      courseSessions,
      referencePath: pathFor([
        reference({ id: "rs-1", position: 1, label: "A" }),
        reference({ id: "rs-2", position: 2, label: "B" }),
      ]),
    }),
  );
  assert.equal(projection.entries.length, 5);
  assert.equal(projection.entries[1]?.referenceSession?.label, "B");
  assert.equal(projection.entries[2]?.referenceSession, null);
  assert.equal(projection.entries[4]?.referenceSession, null);
  assert.equal(projection.unscheduledReferenceSessions.length, 0);
});

test("E — parcours plus long : références 35..40 sans date inventée", () => {
  const projection = unwrap(
    buildCourseTimeline({
      identity: IDENTITY,
      courseSessions: [
        session({ sequenceNumber: 1, date: "2026-08-24" }),
        session({ sequenceNumber: 2, date: "2026-08-31" }),
      ],
      referencePath: pathFor([
        reference({ id: "rs-1", position: 1, label: "A" }),
        reference({ id: "rs-2", position: 2, label: "B" }),
        reference({ id: "rs-3", position: 3, label: "C" }),
        reference({ id: "rs-4", position: 4, label: "D" }),
      ]),
    }),
  );
  assert.equal(projection.entries.length, 2);
  assert.deepEqual(
    projection.unscheduledReferenceSessions.map((session) => session.position),
    [3, 4],
  );
  assert.equal(
    projection.unscheduledReferenceSessions.every((session) => !("date" in session)),
    true,
  );
});

test("F — path null : dates visibles, referencePathExists false", () => {
  const projection = unwrap(
    buildCourseTimeline({
      identity: IDENTITY,
      courseSessions: [session({ sequenceNumber: 1, date: "2026-08-24" })],
      referencePath: null,
    }),
  );
  assert.equal(projection.referencePathExists, false);
  assert.equal(projection.entries[0]?.referenceSession, null);
  assert.deepEqual(projection.unscheduledReferenceSessions, []);
});

test("G — path existant vide : referencePathExists true", () => {
  const projection = unwrap(
    buildCourseTimeline({
      identity: IDENTITY,
      courseSessions: [session({ sequenceNumber: 1, date: "2026-08-24" })],
      referencePath: pathFor([]),
    }),
  );
  assert.equal(projection.referencePathExists, true);
  assert.equal(projection.entries[0]?.referenceSession, null);
  assert.equal(projection.unscheduledReferenceSessions.length, 0);
});

test("H — réordonnancement A/B : la position actuelle gagne", () => {
  const sessionA = reference({ id: "rs-A", position: 2, label: "A" });
  const sessionB = reference({ id: "rs-B", position: 1, label: "B" });
  const projection = unwrap(
    buildCourseTimeline({
      identity: IDENTITY,
      courseSessions: [
        session({ sequenceNumber: 1, date: "2026-08-24" }),
        session({ sequenceNumber: 2, date: "2026-08-31" }),
      ],
      referencePath: pathFor([sessionA, sessionB]),
    }),
  );
  assert.equal(projection.entries[0]?.referenceSession?.id, "rs-B");
  assert.equal(projection.entries[1]?.referenceSession?.id, "rs-A");
});

test("I — deux CTX même nom de branche : l’identité est contextId", () => {
  const pathB = pathFor([reference({ id: "rs-b1", position: 1, label: "Parcours B" })], "ctx-moteur-prof-b");
  const mixed = buildCourseTimeline({
    identity: IDENTITY,
    courseSessions: [session({ sequenceNumber: 1, date: "2026-08-24" })],
    referencePath: pathB,
  });
  assert.equal(mixed.ok, false);

  const own = unwrap(
    buildCourseTimeline({
      identity: { ...IDENTITY, contextId: "ctx-moteur-prof-b", annualCourseId: "AC-B" },
      courseSessions: [
        session({
          sequenceNumber: 1,
          date: "2026-08-24",
          contextId: "ctx-moteur-prof-b",
          annualCourseId: "AC-B",
        }),
      ],
      referencePath: pathB,
    }),
  );
  assert.equal(own.entries[0]?.referenceSession?.label, "Parcours B");
});

test("J — deux AnnualCourse parallèles, même CTX, timelines indépendantes", () => {
  const shared = pathFor([
    reference({ id: "rs-1", position: 1, label: "Introduction" }),
    reference({ id: "rs-2", position: 2, label: "Cycle" }),
  ]);
  const timelineA = unwrap(
    buildCourseTimeline({
      identity: IDENTITY,
      courseSessions: [
        session({ sequenceNumber: 1, date: "2026-08-24" }),
        session({ sequenceNumber: 2, date: "2026-08-31" }),
      ],
      referencePath: shared,
    }),
  );
  const identityB = {
    ...IDENTITY,
    annualCourseId: "AC-MA3B-MOTEUR",
    classId: "class-ma3b",
  };
  const timelineB = unwrap(
    buildCourseTimeline({
      identity: identityB,
      courseSessions: [
        session({
          sequenceNumber: 1,
          date: "2026-08-25",
          annualCourseId: identityB.annualCourseId,
          classId: identityB.classId,
        }),
      ],
      referencePath: shared,
    }),
  );
  assert.equal(timelineA.entries.length, 2);
  assert.equal(timelineB.entries.length, 1);
  assert.equal(timelineA.entries[0]?.referenceSession?.id, timelineB.entries[0]?.referenceSession?.id);
  assert.equal(timelineA.annualCourseId, IDENTITY.annualCourseId);
  assert.equal(timelineB.annualCourseId, identityB.annualCourseId);
  assert.equal(timelineB.unscheduledReferenceSessions[0]?.position, 2);
});

test("K — ReferenceSession label null reste associée", () => {
  const projection = unwrap(
    buildCourseTimeline({
      identity: IDENTITY,
      courseSessions: [session({ sequenceNumber: 7, date: "2026-09-14" })],
      referencePath: pathFor([reference({ id: "rs-7", position: 7, label: null })]),
    }),
  );
  assert.equal(projection.entries[0]?.referenceSession?.id, "rs-7");
  assert.equal(projection.entries[0]?.referenceSession?.label, null);
});

test("L — items HOMEWORK / TEST / INFORMATION conservés dans l’ordre position puis id", () => {
  const projection = unwrap(
    buildCourseTimeline({
      identity: IDENTITY,
      courseSessions: [session({ sequenceNumber: 1, date: "2026-08-24" })],
      referencePath: pathFor([
        reference({
          id: "rs-1",
          position: 1,
          items: [
            { id: "i-info", type: "INFORMATION", title: "Circuit", detail: "Fonctionnement", position: 3 },
            { id: "i-hw", type: "HOMEWORK", title: "Exercices 4.1", detail: "", position: 1 },
            { id: "i-test", type: "TEST", title: "Contrôle lubrification", detail: "", position: 2 },
          ],
        }),
      ]),
    }),
  );
  assert.deepEqual(
    projection.entries[0]?.referenceSession?.items.map((item) => item.type),
    ["HOMEWORK", "TEST", "INFORMATION"],
  );
});

test("M — ordre d’entrée aléatoire → sortie déterministe", () => {
  const sessions = [
    session({ sequenceNumber: 3, date: "2026-09-07", key: "k-3" }),
    session({ sequenceNumber: 1, date: "2026-08-24", key: "k-1" }),
    session({ sequenceNumber: 2, date: "2026-08-31", key: "k-2" }),
  ];
  const refs = [
    reference({ id: "rs-c", position: 3, label: "C" }),
    reference({ id: "rs-a", position: 1, label: "A" }),
    reference({ id: "rs-b", position: 2, label: "B" }),
  ];
  const first = unwrap(
    buildCourseTimeline({ identity: IDENTITY, courseSessions: sessions, referencePath: pathFor(refs) }),
  );
  const second = unwrap(
    buildCourseTimeline({
      identity: IDENTITY,
      courseSessions: [...sessions].reverse(),
      referencePath: pathFor([...refs].reverse()),
    }),
  );
  assert.deepEqual(first, second);
  assert.deepEqual(
    first.entries.map((entry) => entry.courseSession.sequenceNumber),
    [1, 2, 3],
  );
});

test("N — les objets d’entrée ne sont pas mutés", () => {
  const courseSessions = [
    session({
      sequenceNumber: 2,
      date: "2026-08-31",
      segments: [{ scheduleSlotId: "a", periodStart: 2, periodEnd: 3 }],
    }),
    session({ sequenceNumber: 1, date: "2026-08-24" }),
  ];
  const referencePath = pathFor([
    reference({
      id: "rs-2",
      position: 2,
      items: [
        { id: "i-2", type: "TEST", title: "B", detail: "", position: 2 },
        { id: "i-1", type: "HOMEWORK", title: "A", detail: "", position: 1 },
      ],
    }),
    reference({ id: "rs-1", position: 1, label: "Intro" }),
  ]);
  const sessionsSnapshot = JSON.stringify(courseSessions);
  const pathSnapshot = JSON.stringify(referencePath);
  unwrap(buildCourseTimeline({ identity: IDENTITY, courseSessions, referencePath }));
  assert.equal(JSON.stringify(courseSessions), sessionsSnapshot);
  assert.equal(JSON.stringify(referencePath), pathSnapshot);
});

test("O — CourseSession contextId incorrect → erreur de cohérence", () => {
  const result = buildCourseTimeline({
    identity: IDENTITY,
    courseSessions: [session({ sequenceNumber: 1, date: "2026-08-24", contextId: "ctx-autre" })],
    referencePath: null,
  });
  assert.equal(result.ok, false);
});

test("P — ReferencePath contextId incorrect → erreur de cohérence", () => {
  const result = buildCourseTimeline({
    identity: IDENTITY,
    courseSessions: [session({ sequenceNumber: 1, date: "2026-08-24" })],
    referencePath: pathFor([reference({ id: "rs-1", position: 1 })], "ctx-autre"),
  });
  assert.equal(result.ok, false);
});

test("service — path absent : GET ne crée rien", async () => {
  const fx = await fixture();
  const course = await seedAssignedCourse(fx, { teacherId: fx.alice.id });
  const inner = new MemoryPedagogicalPathStore();
  const watched = watchPaths(inner);
  const schedules = new MemoryCourseScheduleStore();
  await schedules.createSlot(mondaySlot(course.id, "slot-1", 2, 3));
  const before = await inner.listPaths();
  const result = await getTeacherCourseTimeline(timelineDeps(fx, watched.store, schedules), {
    teacherId: fx.alice.id,
    annualCourseId: course.id,
    at: TODAY,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.timeline.referencePathExists, false);
  assert.ok(result.timeline.entries.length > 0);
  assert.equal(result.timeline.entries.every((entry) => entry.referenceSession === null), true);
  assert.equal(watched.saved(), 0);
  assert.equal(await inner.getPathByContextId(fx.ctxMoteur.id), null);
  assert.deepEqual(await inner.listPaths(), before);
});

test("service — PRIMARY actif : accès", async () => {
  const fx = await fixture();
  const course = await seedAssignedCourse(fx, { teacherId: fx.alice.id, role: "PRIMARY" });
  const result = await getTeacherCourseTimeline(timelineDeps(fx, new MemoryPedagogicalPathStore()), {
    teacherId: fx.alice.id,
    annualCourseId: course.id,
    at: TODAY,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.course.role, "PRIMARY");
  assert.equal(result.course.annualCourseId, course.id);
});

test("service — CO_TEACHER actif : accès", async () => {
  const fx = await fixture();
  const course = await seedAssignedCourse(fx, { teacherId: fx.alice.id, role: "PRIMARY" });
  const co = await assignTeacherToCourse(fx.deps, {
    annualCourseId: course.id,
    teacherId: fx.bob.id,
    role: "CO_TEACHER",
    createdByAdminId: "admin-1",
    validFrom: "2027-08-01",
  });
  assert.equal(co.ok, true);
  const result = await getTeacherCourseTimeline(timelineDeps(fx, new MemoryPedagogicalPathStore()), {
    teacherId: fx.bob.id,
    annualCourseId: course.id,
    at: TODAY,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.course.role, "CO_TEACHER");
});

test("service — REPLACEMENT actif / futur / expiré", async () => {
  const fx = await fixture();
  const course = await seedAssignedCourse(fx, { teacherId: fx.alice.id });
  const replacement = await assignTemporaryReplacement(fx.deps, {
    annualCourseId: course.id,
    teacherId: fx.bob.id,
    createdByAdminId: "admin-1",
    validFrom: "2027-10-01",
    validTo: "2027-10-31",
  });
  assert.equal(replacement.ok, true);
  const deps = timelineDeps(fx, new MemoryPedagogicalPathStore());

  const active = await getTeacherCourseTimeline(deps, {
    teacherId: fx.bob.id,
    annualCourseId: course.id,
    at: "2027-10-15T12:00:00.000Z",
  });
  assert.equal(active.ok, true);

  const future = await getTeacherCourseTimeline(deps, {
    teacherId: fx.bob.id,
    annualCourseId: course.id,
    at: "2027-09-15T12:00:00.000Z",
  });
  assert.equal(future.ok, false);
  if (!future.ok) assert.equal(future.status, 403);

  const expired = await getTeacherCourseTimeline(deps, {
    teacherId: fx.bob.id,
    annualCourseId: course.id,
    at: "2027-11-15T12:00:00.000Z",
  });
  assert.equal(expired.ok, false);
  if (!expired.ok) assert.equal(expired.status, 403);
});

test("service — remplacement actif voit toute la timeline, TCA ne filtre pas les dates", async () => {
  const fx = await fixture();
  const course = await seedAssignedCourse(fx, { teacherId: fx.alice.id });
  const replacement = await assignTemporaryReplacement(fx.deps, {
    annualCourseId: course.id,
    teacherId: fx.bob.id,
    createdByAdminId: "admin-1",
    validFrom: "2027-10-01",
    validTo: "2027-10-31",
  });
  assert.equal(replacement.ok, true);
  const schedules = new MemoryCourseScheduleStore();
  await schedules.createSlot(mondaySlot(course.id, "slot-1", 2, 3));
  const deps = timelineDeps(fx, new MemoryPedagogicalPathStore(), schedules);
  const result = await getTeacherCourseTimeline(deps, {
    teacherId: fx.bob.id,
    annualCourseId: course.id,
    at: "2027-10-15T12:00:00.000Z",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const dates = result.timeline.entries.map((entry) => entry.courseSession.date);
  assert.ok(dates.some((date) => date < "2027-10-01"), "séances avant le remplacement");
  assert.ok(
    dates.some((date) => date >= "2027-10-01" && date <= "2027-10-31"),
    "séances pendant le remplacement",
  );
  assert.ok(dates.some((date) => date > "2027-10-31"), "séances après le remplacement");
});

test("service — enseignant non affecté, y compris admin, → 403", async () => {
  const fx = await fixture();
  const course = await seedAssignedCourse(fx, { teacherId: fx.alice.id });
  const deps = timelineDeps(fx, new MemoryPedagogicalPathStore());
  const bob = await getTeacherCourseTimeline(deps, {
    teacherId: fx.bob.id,
    annualCourseId: course.id,
    at: TODAY,
  });
  assert.equal(bob.ok, false);
  if (!bob.ok) {
    assert.equal(bob.status, 403);
    assert.equal(bob.reason, COURSE_TIMELINE_FORBIDDEN_REASON);
  }
  const admin = await getTeacherCourseTimeline(deps, {
    teacherId: fx.admin.id,
    annualCourseId: course.id,
    at: TODAY,
  });
  assert.equal(admin.ok, false);
  if (!admin.ok) assert.equal(admin.status, 403);
});

test("service — teacherId session uniquement, pas de bypass client", async () => {
  const fx = await fixture();
  const course = await seedAssignedCourse(fx, { teacherId: fx.alice.id });
  const deps = timelineDeps(fx, new MemoryPedagogicalPathStore());
  const result = await getTeacherCourseTimeline(deps, {
    teacherId: sessionTeacherIdForTimelineApi(fx.bob.id),
    annualCourseId: course.id,
    at: TODAY,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 403);
});

test("service — AnnualCourse hors année opérationnelle → 403, pas 404", async () => {
  const fx = await fixture();
  const course = await fx.deps.courses.createCourse({
    id: "ac-legacy-2026",
    schoolYearId: "year-2026",
    classId: fx.classLegacyYear.id,
    contextId: fx.ctxMoteur.id,
    isArchived: false,
    archivedAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  });
  await fx.deps.courses.createAssignment({
    id: "tca-legacy-2026",
    annualCourseId: course.id,
    teacherId: fx.alice.id,
    role: "PRIMARY",
    validFrom: "2026-08-01",
    validTo: null,
    createdByAdminId: "admin-1",
    createdAt: "2026-08-01T00:00:00.000Z",
    endedAt: null,
    overrideReason: null,
    overrideByAdminId: null,
  });
  const result = await getTeacherCourseTimeline(timelineDeps(fx, new MemoryPedagogicalPathStore()), {
    teacherId: fx.alice.id,
    annualCourseId: course.id,
    at: TODAY,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 403);
});

test("service — cours inconnu 404, id vide 400", async () => {
  const fx = await fixture();
  const deps = timelineDeps(fx, new MemoryPedagogicalPathStore());
  const missing = await getTeacherCourseTimeline(deps, {
    teacherId: fx.alice.id,
    annualCourseId: "unknown-course",
    at: TODAY,
  });
  assert.equal(missing.ok, false);
  if (!missing.ok) {
    assert.equal(missing.status, 404);
    assert.equal(missing.reason, COURSE_TIMELINE_NOT_FOUND_REASON);
  }
  const empty = await getTeacherCourseTimeline(deps, {
    teacherId: fx.alice.id,
    annualCourseId: "   ",
    at: TODAY,
  });
  assert.equal(empty.ok, false);
  if (!empty.ok) {
    assert.equal(empty.status, 400);
    assert.equal(empty.reason, COURSE_TIMELINE_MISSING_ID_REASON);
  }
});

test("service — deux classes, même CTX, timelines indépendantes", async () => {
  const fx = await fixture();
  const courseA = await seedAssignedCourse(fx, {
    teacherId: fx.alice.id,
    classId: fx.classA.id,
    contextId: fx.ctxMoteur.id,
  });
  const courseB = await seedAssignedCourse(fx, {
    teacherId: fx.alice.id,
    classId: fx.classB.id,
    contextId: fx.ctxMoteur.id,
  });
  const paths = new MemoryPedagogicalPathStore();
  await paths.savePath(
    pathFor([reference({ id: "rs-1", position: 1, label: "Introduction" })], fx.ctxMoteur.id),
  );
  const schedules = new MemoryCourseScheduleStore();
  await schedules.createSlot(mondaySlot(courseA.id, "slot-a", 2, 3));
  await schedules.createSlot(mondaySlot(courseB.id, "slot-b", 4, 4));
  const deps = timelineDeps(fx, paths, schedules);
  const timelineA = await getTeacherCourseTimeline(deps, {
    teacherId: fx.alice.id,
    annualCourseId: courseA.id,
    at: TODAY,
  });
  const timelineB = await getTeacherCourseTimeline(deps, {
    teacherId: fx.alice.id,
    annualCourseId: courseB.id,
    at: TODAY,
  });
  assert.equal(timelineA.ok && timelineB.ok, true);
  if (!timelineA.ok || !timelineB.ok) return;
  assert.equal(timelineA.timeline.contextId, timelineB.timeline.contextId);
  assert.notEqual(timelineA.timeline.annualCourseId, timelineB.timeline.annualCourseId);
  assert.equal(timelineA.timeline.entries[0]?.referenceSession?.label, "Introduction");
  assert.equal(timelineB.timeline.entries[0]?.referenceSession?.label, "Introduction");
  assert.equal(
    timelineA.timeline.entries.every((entry) => entry.courseSession.annualCourseId === courseA.id),
    true,
  );
  assert.equal(
    timelineB.timeline.entries.every((entry) => entry.courseSession.annualCourseId === courseB.id),
    true,
  );
});

test("service — deux CTX même branche : pas de mélange de parcours", async () => {
  const fx = await fixture();
  const courseA = await seedAssignedCourse(fx, {
    teacherId: fx.alice.id,
    contextId: fx.ctxMoteur.id,
  });
  const courseB = await seedAssignedCourse(fx, {
    teacherId: fx.alice.id,
    classId: fx.classYear2.id,
    contextId: fx.ctxMoteurY2.id,
  });
  assert.equal(fx.ctxMoteur.branchId, fx.ctxMoteurY2.branchId);
  const paths = new MemoryPedagogicalPathStore();
  await paths.savePath(pathFor([reference({ id: "rs-a", position: 1, label: "Parcours 1re" })], fx.ctxMoteur.id));
  await paths.savePath(
    pathFor([reference({ id: "rs-b", position: 1, label: "Parcours 2e" })], fx.ctxMoteurY2.id),
  );
  const schedules = new MemoryCourseScheduleStore();
  await schedules.createSlot(mondaySlot(courseA.id, "slot-a", 2, 3));
  await schedules.createSlot(mondaySlot(courseB.id, "slot-b", 2, 3));
  const deps = timelineDeps(fx, paths, schedules);
  const timelineA = await getTeacherCourseTimeline(deps, {
    teacherId: fx.alice.id,
    annualCourseId: courseA.id,
    at: TODAY,
  });
  const timelineB = await getTeacherCourseTimeline(deps, {
    teacherId: fx.alice.id,
    annualCourseId: courseB.id,
    at: TODAY,
  });
  assert.equal(timelineA.ok && timelineB.ok, true);
  if (!timelineA.ok || !timelineB.ok) return;
  assert.equal(timelineA.timeline.entries[0]?.referenceSession?.label, "Parcours 1re");
  assert.equal(timelineB.timeline.entries[0]?.referenceSession?.label, "Parcours 2e");
});

test("service — cohérence interne → 500 générique", async () => {
  const fx = await fixture();
  const course = await seedAssignedCourse(fx, { teacherId: fx.alice.id });
  const paths = new MemoryPedagogicalPathStore();
  await paths.savePath(pathFor([reference({ id: "rs-x", position: 1 })], "ctx-étranger"));
  const originalGet = paths.getPathByContextId.bind(paths);
  paths.getPathByContextId = async () => originalGet("ctx-étranger");
  const result = await getTeacherCourseTimeline(timelineDeps(fx, paths), {
    teacherId: fx.alice.id,
    annualCourseId: course.id,
    at: TODAY,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 500);
    assert.equal(result.reason, COURSE_TIMELINE_COHERENCE_REASON);
  }
});

test("service — annualCourseId trim, teacherId helper, search params", () => {
  assert.equal(annualCourseIdFromSearchParams(new URLSearchParams("annualCourseId=  AC-1  ")), "AC-1");
  assert.equal(annualCourseIdFromSearchParams(new URLSearchParams("teacherId=Teacher-A")), "");
  assert.equal(sessionTeacherIdForTimelineApi("session-teacher"), "session-teacher");
});

test("service — cours archivé hors workspace opérationnel → 403", async () => {
  const fx = await fixture();
  const course = await seedAssignedCourse(fx, { teacherId: fx.alice.id });
  const archived = await archiveAnnualCourse(fx.deps, course.id);
  assert.equal(archived.ok, true);
  const result = await getTeacherCourseTimeline(timelineDeps(fx, new MemoryPedagogicalPathStore()), {
    teacherId: fx.alice.id,
    annualCourseId: course.id,
    at: TODAY,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 403);
});

test("sources — GET enseignant lecture seule, pas d’ensurePath, pas de calendrier dupliqué", async () => {
  const [service, projection, route, page, nav, mesCours, timelineUi, compute, format, itemLabels] =
    await Promise.all([
      readFile(new URL("../src/features/course-timeline/service.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/features/course-timeline/projection.ts", import.meta.url), "utf8"),
      readFile(new URL("../web/app/api/teacher/course-timeline/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../web/app/page.tsx", import.meta.url), "utf8"),
      readFile(new URL("../src/features/teacher/navigation.ts", import.meta.url), "utf8"),
      readFile(new URL("../web/app/components/mes-cours-panel.tsx", import.meta.url), "utf8"),
      readFile(new URL("../web/app/components/teacher-course-timeline-panel.tsx", import.meta.url), "utf8"),
      readFile(new URL("../src/features/course-sessions/compute.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/features/course-sessions/format.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/features/pedagogical-path/types.ts", import.meta.url), "utf8"),
    ]);

  assert.match(service, /listComputedCourseSessions/);
  assert.match(service, /getPathByContextId/);
  assert.match(service, /listTeacherCourses/);
  assert.doesNotMatch(service, /ensurePathForContext/);
  assert.doesNotMatch(service, /computeCourseSessions\(/);
  assert.doesNotMatch(service, /buildSchoolDayPlan/);
  assert.doesNotMatch(service, /valaisHolidaysForSchoolYear/);
  assert.doesNotMatch(projection, /Date\.now\(/);
  assert.doesNotMatch(projection, /new Date\(/);
  assert.doesNotMatch(projection, /Math\.random/);
  assert.doesNotMatch(projection, /randomUUID/);

  assert.match(route, /requireTeacherSession/);
  assert.match(route, /withApiObservability\("\/api\/teacher\/course-timeline"/);
  assert.match(route, /sessionTeacherIdForTimelineApi/);
  assert.doesNotMatch(route, /searchParams\.get\("teacherId"\)/);
  assert.doesNotMatch(route, /ensurePathForContext/);
  assert.doesNotMatch(route, /export const POST/);
  assert.doesNotMatch(route, /export const PUT/);
  assert.doesNotMatch(route, /export const PATCH/);
  assert.doesNotMatch(route, /export const DELETE/);

  assert.match(page, /openTimelineCourseId/);
  assert.match(page, /TeacherCourseTimelinePanel/);
  assert.match(page, /onOpenCourse/);
  assert.doesNotMatch(nav, /déroulement/);
  assert.match(nav, /"mes-cours"/);
  assert.match(mesCours, /Voir le déroulement/);
  assert.match(mesCours, /Ouvrir le carnet/);
  assert.match(timelineUi, /Retour à Mes cours/);
  assert.match(timelineUi, /formatCourseSessionNumber/);
  assert.match(timelineUi, /formatCourseSessionPeriods/);
  assert.match(format, /Séance n°/);
  assert.match(format, /P4 · P6/);
  assert.match(itemLabels, /HOMEWORK: "Devoir"/);
  assert.match(itemLabels, /TEST: "Contrôle"/);
  assert.match(itemLabels, /INFORMATION: "Information"/);
  assert.match(timelineUi, /Publier dans l’Agenda/);
  assert.match(timelineUi, /Publié dans l’Agenda/);
  assert.match(timelineUi, /REFERENCE_ITEM_TYPE_LABELS/);
  assert.match(timelineUi, /AbortController/);
  assert.match(timelineUi, /publishTeacherCoursePublicationApi/);
  assert.doesNotMatch(timelineUi, /Créer devoir/);
  assert.doesNotMatch(timelineUi, /Créer contrôle/);
  assert.doesNotMatch(timelineUi, /Passée/);
  assert.doesNotMatch(timelineUi, /Aujourd’hui/);
  assert.doesNotMatch(compute, /CourseTimeline/);
});

test("createEmptyPath n’est pas un ensure : path vide vs path absent", () => {
  const empty = createEmptyPath({
    id: "path-empty",
    contextId: IDENTITY.contextId,
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  const existingEmpty = unwrap(
    buildCourseTimeline({
      identity: IDENTITY,
      courseSessions: [session({ sequenceNumber: 1, date: "2026-08-24" })],
      referencePath: empty,
    }),
  );
  const missing = unwrap(
    buildCourseTimeline({
      identity: IDENTITY,
      courseSessions: [session({ sequenceNumber: 1, date: "2026-08-24" })],
      referencePath: null,
    }),
  );
  assert.equal(existingEmpty.referencePathExists, true);
  assert.equal(missing.referencePathExists, false);
});
