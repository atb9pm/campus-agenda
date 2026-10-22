/**
 * Chargement du Carnet en consultation administrative d'une année DRAFT.
 * Le contenu N→N+1 est déjà appliqué : la suite passe par les mêmes fonctions
 * que la page (agenda de l'année, filtre du cours, séance, document de notes).
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { PrototypeAgendaItem } from "../src/features/agenda/demo-items.ts";
import { agendaItemsForSchoolYear, isVisibleToStudent } from "../src/features/agenda/visibility.ts";
import type { AnnualCourseMeetingDay } from "../src/features/annual-courses/meeting-days.ts";
import type { AnnualCourse, TeacherCourseAssignment } from "../src/features/annual-courses/types.ts";
import {
  loadTeacherNotebookDocument,
} from "../src/features/class-notebook/annual-private-notes.ts";
import { filterNotebookItemsForSubject } from "../src/features/class-notebook/open-course.ts";
import { listSessionNotes } from "../src/features/class-notebook/notes-storage.ts";
import { itemsForCourseSession, sessionNotesKey } from "../src/features/class-notebook/session-window.ts";
import { computeCourseSessions } from "../src/features/course-sessions/compute.ts";
import { listComputedCourseSessions } from "../src/features/course-sessions/service.ts";
import type { CourseSession } from "../src/features/course-sessions/types.ts";
import type { CourseWeekday } from "../src/features/course-schedule/types.ts";
import { valaisHolidaysForSchoolYear } from "../src/features/school-days/holidays-valais.ts";
import type { SchoolWeekEntry } from "../src/features/school-year/types.ts";
import { getStudentAgendaItems } from "../src/features/student/agenda.ts";
import {
  applyPersistedYearTransition,
  applyYearTransitionReclassify,
  assembleLiveYearTransitionPreviewInput,
  createPersistedYearTransitionPreview,
  listYearTransitionReclassifyQueue,
  pendingTargetClassId,
  type ApplyPersistedYearTransitionDeps,
  type YearTransitionReclassifyDeps,
  type YearTransitionTargetMeetingDayPlan,
} from "../src/features/year-transition/index.ts";
import { MemoryAnnualCourseStore } from "../src/lib/persistence/memory-annual-course-store.ts";
import { MemoryAgendaStore } from "../src/lib/persistence/memory-store.ts";
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
import type { ClassNotesDocument } from "../src/features/class-notebook/types.ts";

const SOURCE_YEAR = "year-2026";
const TARGET_YEAR = "year-2027";
const TEACHER_SOURCE = "teacher-source";
const TEACHER_NEW = "teacher-new";
const ADMIN = "admin-consult";
const NOW = "2026-08-01T00:00:00.000Z";
const TODAY = "2026-10-15T12:00:00.000Z";
const AFTER_ASSIGNMENT = "2027-10-15T12:00:00.000Z";
const CLASSROOM = "rt-injection-n";
const THURSDAY: CourseWeekday = 4;

process.env.CAMPUS_DEMO_SEED = "false";

type Campus = {
  deps: ApplyPersistedYearTransitionDeps;
  teacherNotes: MemoryTeacherNotesStore;
  classId: string;
  injectionId: string;
  autreId: string;
  injectionContextId: string;
  autreContextId: string;
};

function mondayWeeks(startMonday: string, count: number): SchoolWeekEntry[] {
  const weeks: SchoolWeekEntry[] = [];
  const [year, month, day] = startMonday.split("-").map(Number);
  const cursor = new Date(Date.UTC(year!, month! - 1, day!, 12));
  let number = 1;
  while (weeks.length < count) {
    weeks.push({
      number,
      kind: number % 2 === 1 ? "A" : "B",
      monday: cursor.toISOString().slice(0, 10),
    });
    number += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  return weeks;
}

function meetingDay(annualCourseId: string): AnnualCourseMeetingDay {
  return {
    id: `md-${annualCourseId}-thu`,
    annualCourseId,
    dayOfWeek: THURSDAY,
    weekKind: "all",
    role: "PRIMARY",
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function courseRecord(id: string, classId: string, contextId: string): AnnualCourse {
  return {
    id,
    schoolYearId: SOURCE_YEAR,
    classId,
    contextId,
    isArchived: false,
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function assignment(id: string, annualCourseId: string, teacherId: string, validFrom: string): TeacherCourseAssignment {
  return {
    id,
    annualCourseId,
    teacherId,
    role: "PRIMARY",
    validFrom,
    validTo: null,
    createdByAdminId: ADMIN,
    createdAt: NOW,
    endedAt: null,
    overrideReason: null,
    overrideByAdminId: null,
  };
}

function reclassifyDeps(deps: ApplyPersistedYearTransitionDeps): YearTransitionReclassifyDeps {
  return {
    years: deps.years,
    catalog: deps.catalog,
    courses: deps.courses,
    agenda: deps.agenda,
    notes: deps.notes,
    schedules: deps.schedules,
  };
}

async function openCampus(): Promise<Campus> {
  resetMemorySchoolYearStore();
  resetMemoryLegacySchool();
  replaceMemoryLegacySchool({ classrooms: [], subjects: [], memberships: [], studentAccesses: [] });
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
      weeks: mondayWeeks("2026-08-17", 12),
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
      weeks: mondayWeeks("2027-08-23", 12),
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
  const applyStore = new MemoryYearTransitionApplyStore(agenda, notes);
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

  const profession = await catalog.createProfession({
    label: "Mécanicien automobile",
    durationYears: 4,
    classCodePrefix: "INJ",
    sortOrder: 1,
    isActive: true,
  });
  const injectionBranch = await catalog.createBranch({
    code: "INJ",
    label: "CP Léger Injection, dépollution",
    sortOrder: 1,
    isActive: true,
    teachingType: "TECHNICAL",
  });
  const autreBranch = await catalog.createBranch({
    code: "AUT",
    label: "Autre cours",
    sortOrder: 2,
    isActive: true,
    teachingType: "TECHNICAL",
  });
  const injectionContext = await catalog.createContext({
    professionId: profession.id,
    trainingYear: 3,
    branchId: injectionBranch.id,
    isActive: true,
  });
  const autreContext = await catalog.createContext({
    professionId: profession.id,
    trainingYear: 3,
    branchId: autreBranch.id,
    isActive: true,
  });
  if (!injectionContext.ok || !autreContext.ok) throw new Error("Contexte pédagogique refusé.");
  const schoolClass = await catalog.createClass({
    code: "INJ3A",
    label: "INJ 3A",
    schoolYearId: SOURCE_YEAR,
    schoolYearLabel: "2026-2027",
    professionId: profession.id,
    trainingYear: 3,
    parallelCode: "A",
    isActive: true,
  });

  const injectionId = "ac-injection-n";
  const autreId = "ac-autre-n";
  await courses.createCourse(courseRecord(injectionId, schoolClass.id, injectionContext.value.id));
  await courses.createCourse(courseRecord(autreId, schoolClass.id, autreContext.value.id));
  await courses.createAssignment(assignment("asg-source-injection", injectionId, TEACHER_SOURCE, NOW));
  await courses.createAssignment(assignment("asg-source-autre", autreId, TEACHER_SOURCE, NOW));
  await schedules.replaceMeetingDaysForAnnualCourse(injectionId, [meetingDay(injectionId)]);
  await schedules.replaceMeetingDaysForAnnualCourse(autreId, [meetingDay(autreId)]);
  await adapters.upsertClassroom({
    id: CLASSROOM,
    name: "INJ3A",
    programLabel: "Mécanique",
    accessCodeHint: "inj",
    schoolClassId: schoolClass.id,
  });
  await adapters.upsertSubject({
    id: "subj-injection",
    classroomId: CLASSROOM,
    name: "CP Léger Injection, dépollution",
    annualCourseId: injectionId,
  });
  await adapters.upsertSubject({
    id: "subj-autre",
    classroomId: CLASSROOM,
    name: "Autre cours",
    annualCourseId: autreId,
  });

  return {
    deps,
    teacherNotes,
    classId: schoolClass.id,
    injectionId,
    autreId,
    injectionContextId: injectionContext.value.id,
    autreContextId: autreContext.value.id,
  };
}

async function sessionsFor(deps: ApplyPersistedYearTransitionDeps, schoolYearId: string, annualCourseId: string) {
  const year = await deps.years.getSchoolYearById(schoolYearId);
  assert.ok(year);
  const course = await deps.courses.getCourse(annualCourseId);
  assert.ok(course);
  return computeCourseSessions({
    schoolYearId,
    courses: [{ id: course.id, classId: course.classId, contextId: course.contextId }],
    slots: await deps.schedules.listSlotsByAnnualCourse(course.id),
    weeks: year.weeks,
    holidays: valaisHolidaysForSchoolYear(year.label),
    meetingDays: (await deps.schedules.listMeetingDaysByAnnualCourse(course.id)).map((day) => ({
      annualCourseId: day.annualCourseId,
      dayOfWeek: day.dayOfWeek,
      weekKind: day.weekKind,
    })),
  });
}

async function publish(
  deps: ApplyPersistedYearTransitionDeps,
  annualCourseId: string,
  subjectId: string,
  title: string,
  type: PrototypeAgendaItem["type"],
  session: { key: string; date: string; schoolWeekNumber: number; dayOfWeek: number } | null,
) {
  return deps.agenda.createAgendaItem({
    classroomId: CLASSROOM,
    subjectId,
    authorTeacherId: TEACHER_SOURCE,
    day: session ? session.dayOfWeek - 1 : 0,
    hour: 8,
    weekOffset: 0,
    schoolWeekNumber: session?.schoolWeekNumber ?? 0,
    type,
    title,
    detail: "Contenu source",
    schoolYearId: SOURCE_YEAR,
    annualCourseId,
    courseSessionKey: session?.key ?? null,
    courseSessionDate: session?.date ?? null,
    studentVisible: true,
  });
}

function titles(items: readonly PrototypeAgendaItem[]): string[] {
  return items.map((item) => item.title).sort();
}

function queueItems(queue: Awaited<ReturnType<typeof listYearTransitionReclassifyQueue>>) {
  return queue.groups.flatMap((group) => group.courses.flatMap((course) => course.items));
}

/** Même chaîne que page.tsx : GET agenda filtré par année, puis filtre du cours ouvert. */
async function notebookItemsForCourse(
  deps: ApplyPersistedYearTransitionDeps,
  classroomId: string,
  schoolYearId: string | null,
  annualCourseId: string,
  viewerTeacherId: string,
) {
  const listed = await deps.agenda.listAgendaItems(classroomId);
  const forYear = agendaItemsForSchoolYear(listed, schoolYearId);
  return filterNotebookItemsForSubject(forYear, {
    classroomId,
    teacherId: viewerTeacherId,
    subjectId: null,
    annualCourseId,
    restrictToSubject: true,
  });
}

function publicationsOnSession(
  items: readonly PrototypeAgendaItem[],
  session: CourseSession,
  sessions: readonly CourseSession[],
) {
  return itemsForCourseSession(items, session, sessions);
}

async function carnetSessions(deps: ApplyPersistedYearTransitionDeps, annualCourseId: string) {
  const loaded = await listComputedCourseSessions(
    {
      years: deps.years,
      catalog: deps.catalog,
      courses: deps.courses,
      schedules: deps.schedules,
    },
    { schoolYearId: TARGET_YEAR, annualCourseId },
  );
  assert.equal(loaded.ok, true);
  if (!loaded.ok) throw new Error(loaded.reason);
  return loaded.value;
}

async function consultNotes(
  campus: Campus,
  teacherId: string,
  options: { isAdmin: boolean; adminConsult: boolean; schoolYearId?: string | null; at?: string },
) {
  return loadTeacherNotebookDocument(
    teacherId,
    { teacherNotes: campus.teacherNotes, courseNotes: campus.deps.notes, courses: campus.deps.courses },
    {
      ...options,
      catalog: campus.deps.catalog,
      years: campus.deps.years,
    },
  );
}

function noteTexts(document: ClassNotesDocument | null, sessionKey: string): string[] {
  if (!document) return [];
  return listSessionNotes(document, sessionNotesKey(sessionKey)).map((note) => note.text);
}

test("Carnet 2027–2028 — publications et notes héritées, lecture seule", async () => {
  const campus = await openCampus();
  const { deps } = campus;
  const sourceSessions = await sessionsFor(deps, SOURCE_YEAR, campus.injectionId);
  const sourceSeven = sourceSessions.find((session) => session.sequenceNumber === 7);
  assert.ok(sourceSeven);
  assert.equal(sourceSeven.date, "2026-10-01");
  assert.equal(sourceSeven.dayOfWeek, THURSDAY);

  await publish(deps, campus.injectionId, "subj-injection", "Devoir A", "HOMEWORK", sourceSeven);
  await publish(deps, campus.injectionId, "subj-injection", "Information B", "INFORMATION", sourceSeven);
  await publish(deps, campus.injectionId, "subj-injection", "Devoir à reclasser", "HOMEWORK", null);
  await publish(deps, campus.injectionId, "subj-injection", "Information orpheline", "INFORMATION", null);
  const autreSessions = await sessionsFor(deps, SOURCE_YEAR, campus.autreId);
  const autreSeven = autreSessions.find((session) => session.sequenceNumber === 7);
  assert.ok(autreSeven);
  await publish(deps, campus.autreId, "subj-autre", "Devoir autre cours", "HOMEWORK", autreSeven);

  await deps.notes.createNote("n-c", {
    schoolYearId: SOURCE_YEAR,
    classId: campus.classId,
    contextId: campus.injectionContextId,
    annualCourseId: campus.injectionId,
    authorTeacherId: TEACHER_SOURCE,
    ownerTeacherId: TEACHER_SOURCE,
    text: "Note interne C",
    courseSessionKey: sourceSeven.key,
  });
  await deps.notes.createNote("n-reclass", {
    schoolYearId: SOURCE_YEAR,
    classId: campus.classId,
    contextId: campus.injectionContextId,
    annualCourseId: campus.injectionId,
    authorTeacherId: TEACHER_SOURCE,
    ownerTeacherId: TEACHER_SOURCE,
    text: "Note à reclasser",
    courseSessionKey: null,
  });
  await deps.notes.createNote("n-autre", {
    schoolYearId: SOURCE_YEAR,
    classId: campus.classId,
    contextId: campus.autreContextId,
    annualCourseId: campus.autreId,
    authorTeacherId: TEACHER_SOURCE,
    ownerTeacherId: TEACHER_SOURCE,
    text: "Note autre cours",
    courseSessionKey: autreSeven.key,
  });

  const plans: YearTransitionTargetMeetingDayPlan[] = [
    { sourceAnnualCourseId: campus.injectionId, days: [{ dayOfWeek: THURSDAY, weekKind: "all", role: "PRIMARY" }] },
    { sourceAnnualCourseId: campus.autreId, days: [{ dayOfWeek: THURSDAY, weekKind: "all", role: "PRIMARY" }] },
  ];
  const input = await assembleLiveYearTransitionPreviewInput(
    {
      includePrivateNotes: true,
      privateNotesOwnerTeacherId: TEACHER_SOURCE,
      sourceSchoolYearId: SOURCE_YEAR,
      targetSchoolYearId: TARGET_YEAR,
      classMappings: [{ sourceClassId: campus.classId, targetClassId: pendingTargetClassId(campus.classId) }],
      selectedSourceClassIds: [campus.classId],
      selectedSourceAnnualCourseIds: [campus.injectionId, campus.autreId],
      targetMeetingDayPlans: plans,
    },
    deps,
  );
  const persisted = await createPersistedYearTransitionPreview(input, {
    store: deps.previews,
    idGenerator: () => "draft-carnet-content",
    now: () => "2027-03-01T00:00:00.000Z",
  });
  const sourceItems = (await deps.agenda.exportAllItems()).filter((item) => item.schoolYearId === SOURCE_YEAR);
  for (const title of ["Devoir A", "Information B"]) {
    const source = sourceItems.find((item) => item.title === title);
    assert.equal(
      persisted.preview.entries.find((entry) => entry.sourceAgendaItemId === source?.id)?.disposition,
      "PROJECTABLE",
      title,
    );
  }
  assert.equal(
    persisted.preview.privateNotes?.find((entry) => entry.sourceNoteId === "n-c")?.disposition,
    "PROJECTABLE",
  );
  const applied = await applyPersistedYearTransition(persisted.id, deps);
  assert.equal(applied.ok, true);
  if (!applied.ok) throw new Error(applied.reason ?? applied.code);

  const targetInjection = (await deps.courses.listCourses()).find(
    (course) => course.schoolYearId === TARGET_YEAR && course.contextId === campus.injectionContextId,
  );
  const targetAutre = (await deps.courses.listCourses()).find(
    (course) => course.schoolYearId === TARGET_YEAR && course.contextId === campus.autreContextId,
  );
  assert.ok(targetInjection);
  assert.ok(targetAutre);

  const sessions = await carnetSessions(deps, targetInjection.id);
  const sessionSeven = sessions.find((session) => session.sequenceNumber === 7);
  const sessionEight = sessions.find((session) => session.sequenceNumber === 8);
  assert.ok(sessionSeven);
  assert.ok(sessionEight);
  assert.equal(sessionSeven.date, "2027-10-07");
  assert.equal(sessionSeven.dayOfWeek, THURSDAY);

  const copied = (await deps.agenda.exportAllItems()).filter(
    (item) => item.schoolYearId === TARGET_YEAR && item.annualCourseId === targetInjection.id,
  );
  const devoirA = copied.find((item) => item.title === "Devoir A");
  const informationB = copied.find((item) => item.title === "Information B");
  assert.ok(devoirA);
  assert.ok(informationB);
  assert.equal(devoirA.studentVisible, false);
  assert.equal(informationB.studentVisible, false);
  assert.equal(devoirA.authorTeacherId, TEACHER_SOURCE);
  assert.notEqual(devoirA.authorTeacherId, ADMIN);
  const targetClassroomId = devoirA.classroomId;
  assert.notEqual(targetClassroomId, CLASSROOM);

  await deps.agenda.createAgendaItem({
    classroomId: targetClassroomId,
    subjectId: devoirA.subjectId,
    authorTeacherId: TEACHER_SOURCE,
    day: 3,
    hour: 8,
    weekOffset: 0,
    schoolWeekNumber: sessionSeven.schoolWeekNumber,
    type: "INFORMATION",
    title: "Publication autre année",
    detail: "Ne doit pas apparaître dans 2027–2028",
    schoolYearId: SOURCE_YEAR,
    annualCourseId: targetInjection.id,
    courseSessionKey: sessionSeven.key,
    courseSessionDate: sessionSeven.date,
    studentVisible: true,
  });

  assert.equal((await deps.courses.listAssignmentsForTeacher(ADMIN)).length, 0);

  let commits = 0;
  const commitNotebook = campus.teacherNotes.commitNotebook.bind(campus.teacherNotes);
  campus.teacherNotes.commitNotebook = async (...args) => {
    commits += 1;
    return commitNotebook(...args);
  };
  const notesBefore = (await deps.notes.listNotesByAnnualCourse(targetInjection.id))
    .map((note) => ({ id: note.id, key: note.courseSessionKey, text: note.text }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const visibilityBefore = copied.map((item) => ({ id: item.id, studentVisible: item.studentVisible }));

  const adminItems = await notebookItemsForCourse(
    deps,
    targetClassroomId,
    TARGET_YEAR,
    targetInjection.id,
    ADMIN,
  );
  const onSeven = publicationsOnSession(adminItems, sessionSeven, sessions);
  assert.deepEqual(titles(onSeven), ["Devoir A", "Information B"]);

  const adminDocument = await consultNotes(campus, ADMIN, {
    isAdmin: true,
    adminConsult: true,
    schoolYearId: TARGET_YEAR,
    at: TODAY,
  });
  assert.deepEqual(noteTexts(adminDocument, sessionSeven.key), ["Note interne C"]);
  assert.equal(commits, 0, "consultation admin : aucune écriture de notes");
  assert.deepEqual(
    (await deps.notes.listNotesByAnnualCourse(targetInjection.id))
      .map((note) => ({ id: note.id, key: note.courseSessionKey, text: note.text }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    notesBefore,
  );
  const copiedAfter = (await deps.agenda.exportAllItems()).filter((item) =>
    visibilityBefore.some((before) => before.id === item.id),
  );
  assert.deepEqual(
    copiedAfter.map((item) => ({ id: item.id, studentVisible: item.studentVisible })).sort((left, right) => left.id - right.id),
    visibilityBefore.sort((left, right) => left.id - right.id),
  );
  assert.equal((await deps.courses.listAssignmentsForTeacher(ADMIN)).length, 0);

  const storedC = (await deps.notes.listNotesByAnnualCourse(targetInjection.id)).find((note) => note.text === "Note interne C");
  assert.ok(storedC);
  assert.equal(storedC.authorTeacherId, TEACHER_SOURCE);
  assert.equal(storedC.annualCourseId, targetInjection.id);

  const autreItems = await notebookItemsForCourse(
    deps,
    targetClassroomId,
    TARGET_YEAR,
    targetAutre.id,
    TEACHER_NEW,
  );
  const autreSessionsTarget = await carnetSessions(deps, targetAutre.id);
  const autreSevenTarget = autreSessionsTarget.find((session) => session.sequenceNumber === 7);
  assert.ok(autreSevenTarget);
  assert.deepEqual(titles(publicationsOnSession(autreItems, autreSevenTarget, autreSessionsTarget)), ["Devoir autre cours"]);
  assert.equal(adminItems.some((item) => item.title === "Devoir autre cours"), false);
  assert.equal(
    sessions.some((session) => noteTexts(adminDocument, session.key).includes("Note autre cours")),
    false,
  );
  assert.deepEqual(noteTexts(adminDocument, autreSevenTarget.key), ["Note autre cours"]);

  const otherYear = await notebookItemsForCourse(
    deps,
    targetClassroomId,
    SOURCE_YEAR,
    targetInjection.id,
    ADMIN,
  );
  assert.deepEqual(titles(publicationsOnSession(otherYear, sessionSeven, sessions)), ["Publication autre année"]);
  assert.equal(adminItems.some((item) => item.title === "Publication autre année"), false);

  const unfiltered = agendaItemsForSchoolYear(await deps.agenda.listAgendaItems(targetClassroomId), null);
  assert.equal(unfiltered.some((item) => item.title === "Devoir A"), true);
  assert.equal(unfiltered.some((item) => item.title === "Publication autre année"), true);

  const studentItems = getStudentAgendaItems(
    agendaItemsForSchoolYear(await deps.agenda.listAgendaItems(targetClassroomId), TARGET_YEAR),
    targetClassroomId,
  );
  assert.equal(studentItems.some((item) => item.title === "Devoir A" || item.title === "Information B"), false);
  assert.equal(isVisibleToStudent(devoirA), false);
  assert.equal(isVisibleToStudent(informationB), false);

  const queueBefore = await listYearTransitionReclassifyQueue(reclassifyDeps(deps), TARGET_YEAR, {
    isAdmin: true,
    kind: "admin",
  });
  const waiting = queueItems(queueBefore).filter((item) => item.annualCourseId === targetInjection.id);
  const unplacedPublication = waiting.find((item) => item.title === "Devoir à reclasser");
  const orphanSource = waiting.find((item) => item.title === "Information orpheline");
  assert.equal(unplacedPublication?.reclassifyKind, "UNPLACED");
  assert.equal(orphanSource?.reclassifyKind, "UNPLACED");
  const reclassNote = (await deps.notes.listNotesByAnnualCourse(targetInjection.id)).find(
    (note) => note.text === "Note à reclasser",
  );
  assert.ok(reclassNote);
  assert.equal(waiting.find((item) => item.noteId === reclassNote.id)?.reclassifyKind, "UNPLACED");
  for (const session of sessions) {
    const shown = titles(publicationsOnSession(adminItems, session, sessions));
    assert.equal(shown.includes("Devoir à reclasser"), false);
    assert.equal(shown.includes("Information orpheline"), false);
    const shownNotes = noteTexts(adminDocument, session.key);
    assert.equal(shownNotes.includes("Note à reclasser"), false);
  }

  const deadKey = `${TARGET_YEAR}|${targetInjection.id}|2099-01-01`;
  const placedOrphan = await deps.agenda.placeAgendaItemOnCourseSession(orphanSource!.publicationId!, {
    courseSessionKey: deadKey,
    courseSessionDate: "2099-01-01",
    schoolWeekNumber: 0,
    day: 3,
  });
  assert.equal(placedOrphan.ok, true);
  await deps.notes.updateNoteCourseSession(reclassNote.id, deadKey);

  const afterOrphanItems = await notebookItemsForCourse(
    deps,
    targetClassroomId,
    TARGET_YEAR,
    targetInjection.id,
    ADMIN,
  );
  const afterOrphanNotes = await consultNotes(campus, ADMIN, {
    isAdmin: true,
    adminConsult: true,
    schoolYearId: TARGET_YEAR,
    at: TODAY,
  });
  for (const session of sessions) {
    assert.equal(
      titles(publicationsOnSession(afterOrphanItems, session, sessions)).includes("Information orpheline"),
      false,
    );
    assert.equal(noteTexts(afterOrphanNotes, session.key).includes("Note à reclasser"), false);
  }
  const queueOrphan = queueItems(
    await listYearTransitionReclassifyQueue(reclassifyDeps(deps), TARGET_YEAR, { isAdmin: true, kind: "admin" }),
  );
  assert.equal(
    queueOrphan.find((item) => item.title === "Information orpheline")?.reclassifyKind,
    "ORPHANED",
  );
  assert.equal(queueOrphan.find((item) => item.noteId === reclassNote.id)?.reclassifyKind, "ORPHANED");
  assert.equal(commits, 0, "consultation admin : aucune migration persistée");

  const reclassified = await applyYearTransitionReclassify(
    reclassifyDeps(deps),
    {
      schoolYearId: TARGET_YEAR,
      kind: "publication",
      publicationId: unplacedPublication!.publicationId,
      courseSessionKey: sessionEight.key,
    },
    { isAdmin: true, kind: "admin" },
  );
  assert.equal(reclassified.ok, true);
  if (!reclassified.ok) throw new Error(reclassified.reason);
  assert.equal(reclassified.publication?.studentVisible, false);
  const afterMove = await notebookItemsForCourse(
    deps,
    targetClassroomId,
    TARGET_YEAR,
    targetInjection.id,
    ADMIN,
  );
  assert.deepEqual(titles(publicationsOnSession(afterMove, sessionEight, sessions)), ["Devoir à reclasser"]);
  assert.equal(titles(publicationsOnSession(afterMove, sessionSeven, sessions)).includes("Devoir à reclasser"), false);
  assert.equal(
    queueItems(
      await listYearTransitionReclassifyQueue(reclassifyDeps(deps), TARGET_YEAR, { isAdmin: true, kind: "admin" }),
    ).some((item) => item.title === "Devoir à reclasser"),
    false,
  );
  const studentAfter = getStudentAgendaItems(
    agendaItemsForSchoolYear(await deps.agenda.listAgendaItems(targetClassroomId), TARGET_YEAR),
    targetClassroomId,
  );
  assert.equal(studentAfter.some((item) => item.title === "Devoir à reclasser"), false);

  await deps.courses.createAssignment(
    assignment("asg-new-injection", targetInjection.id, TEACHER_NEW, "2027-08-01T00:00:00.000Z"),
  );
  const futureTeacherNow = await consultNotes(campus, TEACHER_NEW, {
    isAdmin: false,
    adminConsult: false,
    at: TODAY,
  });
  assert.equal(noteTexts(futureTeacherNow, sessionSeven.key).includes("Note interne C"), false);

  const futureTeacherLater = await consultNotes(campus, TEACHER_NEW, {
    isAdmin: false,
    adminConsult: false,
    at: AFTER_ASSIGNMENT,
  });
  assert.deepEqual(noteTexts(futureTeacherLater, sessionSeven.key), ["Note interne C"]);
  const newTeacherItems = await notebookItemsForCourse(
    deps,
    targetClassroomId,
    TARGET_YEAR,
    targetInjection.id,
    TEACHER_NEW,
  );
  assert.deepEqual(titles(publicationsOnSession(newTeacherItems, sessionSeven, sessions)), ["Devoir A", "Information B"]);

  const sourceDocument = await consultNotes(campus, TEACHER_SOURCE, {
    isAdmin: false,
    adminConsult: false,
    at: TODAY,
  });
  assert.equal(noteTexts(sourceDocument, sourceSeven.key).includes("Note interne C"), true);
  assert.equal(noteTexts(sourceDocument, sessionSeven.key).includes("Note interne C"), false);

  const forced = await consultNotes(campus, TEACHER_SOURCE, {
    isAdmin: false,
    adminConsult: true,
    schoolYearId: TARGET_YEAR,
    at: TODAY,
  });
  assert.equal(noteTexts(forced, sessionSeven.key).includes("Note interne C"), false);
  assert.equal((await deps.courses.listAssignmentsForTeacher(ADMIN)).length, 0);
});

test("la page et les routes n’écrivent pas pendant la consultation admin", async () => {
  const [page, panel, notesRoute, agendaRoute, client] = await Promise.all([
    readFile(new URL("../web/app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/components/class-notebook-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/api/teacher/notes/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/app/api/agenda/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/lib/api-client.ts", import.meta.url), "utf8"),
  ]);

  assert.match(page, /fetchTeacherNotesApi\(consult\)/);
  assert.match(page, /adminConsult: true as const/);
  assert.match(page, /schoolYearId: viewedSchoolYearId/);
  const autosave = page.indexOf("if (adminYearConsult) return;");
  const saveCall = page.indexOf("saveTeacherNotesApi(classNotesDocument)");
  assert.ok(autosave > 0 && autosave < saveCall);
  assert.match(page, /loadTeacherAgendaItems\(classroomIds, viewedSchoolYearId, \{\s*adminConsult: true,\s*\}\)/);
  assert.match(
    page,
    /fetchAgendaItems\(\s*notebookClassroomId,\s*adminYearConsult \? viewedSchoolYearId : null,\s*\{ adminConsult: adminYearConsult \},\s*\)/,
  );
  assert.match(agendaRoute, /requireClassroomReadAccess\(request, classroomId, \{ adminConsult, schoolYearId \}\)/);
  assert.match(agendaRoute, /const readOnly = adminConsult \|\|/);
  assert.match(
    page,
    /Consultation administrative en lecture seule\. Les enseignants et les élèves utilisent toujours l’année active\./,
  );

  const guard = panel.indexOf("if (adminConsult) return;");
  const migrate = panel.indexOf("migrateClassNotesToSessions(");
  assert.ok(guard > 0 && guard < migrate);

  assert.match(notesRoute, /auth\.store!\.teacherIsAdmin\(teacherId\)/);
  assert.equal(notesRoute.includes('searchParams.get("isAdmin")'), false);
  assert.equal(notesRoute.includes("body.teacherId"), false);
  const refusal = notesRoute.indexOf("Consultation administrative en lecture seule.");
  const persist = notesRoute.indexOf("persistTeacherNotebookDocument(");
  assert.ok(refusal > 0 && refusal < persist);
  assert.match(notesRoute, /loadTeacherNotebookDocument\(teacherId, deps,/);
  assert.match(agendaRoute, /agendaItemsForSchoolYear\(/);

  const notesClient = client.slice(client.indexOf("export async function fetchTeacherNotesApi"));
  assert.match(notesClient, /if \(options\?\.adminConsult\)/);
  assert.match(notesClient, /params\.set\("consult", "1"\)/);
  const agendaClient = client.slice(client.indexOf("export async function fetchAgendaView"));
  assert.match(agendaClient, /if \(schoolYearId\?\.trim\(\)\) params\.set\("schoolYearId", schoolYearId\.trim\(\)\)/);
});

test("Carnet : un chargement refusé s'affiche au lieu de cartes vides", async () => {
  const [page, panel] = await Promise.all([
    readFile(new URL("../web/app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/components/class-notebook-panel.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(panel, /\{loadError \? \(\s*<p className="class-notebook-warning" role="alert">\{loadError\}<\/p>/);
  assert.match(page, /loadError=\{\[notebookAgendaLoadError, notebookNotesLoadError\]\.filter\(Boolean\)\.join\(" "\)\}/);
  assert.equal(page.match(/`Devoirs et informations non chargés : /g)?.length, 2);
  assert.equal(page.match(/`Notes du Carnet non chargées : /g)?.length, 1);
  const openEffect = page.slice(page.indexOf("void fetchAgendaItems(\n      notebookClassroomId"));
  assert.match(openEffect.slice(0, 900), /\.catch\(\(error: unknown\) => \{\s*loadedAgendaClassroomIdsRef\.current\.delete\(agendaKey\);/);
});
