import {
  bindNoteToCourseSession,
  bindPublicationToCourseSession,
  noteReclassifyKind,
  publicationReclassifyKind,
  type ReclassifyPlacementKind,
} from "../class-notebook/reclassify.ts";
import type { PrototypeAgendaItem } from "../agenda/demo-items.ts";
import type { CourseSession } from "../course-sessions/types.ts";
import { computeCourseSessions, parseCourseSessionKey } from "../course-sessions/compute.ts";
import { formatCourseSessionPeriods, formatSwissDate } from "../course-sessions/format.ts";
import { COURSE_WEEKDAY_LABELS } from "../course-schedule/types.ts";
import type { AnnualCourseNote } from "../pedagogical-path/annual-notes.ts";
import { valaisHolidaysForSchoolYear } from "../school-days/holidays-valais.ts";
import { formatSchoolYearLabelFr } from "../school-year/official-plan-logic.ts";
import type { AnnualCourseStore } from "../../lib/persistence/annual-course-types.ts";
import type { CourseScheduleStore } from "../../lib/persistence/course-schedule-types.ts";
import type { AnnualCourseNotesStore } from "../../lib/persistence/pedagogical-path-types.ts";
import type { SchoolCatalogStore } from "../../lib/persistence/school-catalog-types.ts";
import type { SchoolYearStore } from "../../lib/persistence/school-year-types.ts";
import type { AgendaStore } from "../../lib/persistence/types.ts";
import { presentTransitionClass, presentTransitionCourse } from "./presentation.ts";

export const YEAR_TRANSITION_RECLASSIFY_FORBIDDEN = "Accès administrateur requis.";
export const YEAR_TRANSITION_RECLASSIFY_SESSION_GONE =
  "Cette séance n’existe plus. Actualisez la liste et choisissez une nouvelle séance.";
export const YEAR_TRANSITION_RECLASSIFY_OTHER_COURSE =
  "Le reclassement ne peut se faire que vers une séance du même cours.";
export const YEAR_TRANSITION_RECLASSIFY_COMPLETE = "Tous les éléments transférés sont positionnés.";

const MONTHS_FR = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
] as const;

const PUBLICATION_TYPE_LABELS = {
  HOMEWORK: "Devoir",
  TEST: "Contrôle",
  INFORMATION: "Information",
} as const;

export type YearTransitionReclassifyActor = {
  isAdmin: boolean;
  kind?: "admin" | "teacher" | "student";
};

export type YearTransitionReclassifyDeps = {
  years: SchoolYearStore;
  catalog: SchoolCatalogStore;
  courses: AnnualCourseStore;
  agenda: AgendaStore;
  notes: AnnualCourseNotesStore;
  schedules: CourseScheduleStore;
};

export type YearTransitionReclassifyItemKind = "publication" | "note";

export type YearTransitionReclassifySessionOption = {
  key: string;
  date: string;
  sequenceNumber: number;
  label: string;
  annualCourseId: string;
  schoolYearId: string;
};

export type YearTransitionReclassifyItem = {
  id: string;
  kind: YearTransitionReclassifyItemKind;
  publicationId: number | null;
  noteId: string | null;
  type: PrototypeAgendaItem["type"] | "NOTE";
  typeLabel: string;
  title: string | null;
  annualCourseId: string;
  classId: string;
  courseLabel: string;
  classLabel: string;
  reclassifyKind: ReclassifyPlacementKind;
  reasonLabel: string;
  sourceSessionLabel: string | null;
  studentVisible: boolean | null;
};

export type YearTransitionReclassifyCourseGroup = {
  annualCourseId: string;
  courseLabel: string;
  classId: string;
  sessions: YearTransitionReclassifySessionOption[];
  items: YearTransitionReclassifyItem[];
};

export type YearTransitionReclassifyClassGroup = {
  classId: string;
  classLabel: string;
  courses: YearTransitionReclassifyCourseGroup[];
};

export type YearTransitionReclassifyQueue = {
  schoolYearId: string;
  yearLabel: string;
  count: number;
  complete: boolean;
  groups: YearTransitionReclassifyClassGroup[];
};

export type YearTransitionReclassifyFailure = {
  ok: false;
  status: 400 | 403 | 404 | 409;
  code: string;
  reason: string;
};

export type YearTransitionReclassifySuccess = {
  ok: true;
  queue: YearTransitionReclassifyQueue;
  publication?: PrototypeAgendaItem;
  note?: AnnualCourseNote;
};

export class YearTransitionReclassifyAuthError extends Error {
  readonly status = 403 as const;
  readonly code = "FORBIDDEN";
  constructor(message = YEAR_TRANSITION_RECLASSIFY_FORBIDDEN) {
    super(message);
    this.name = "YearTransitionReclassifyAuthError";
  }
}

export function assertAdminReclassifyAccess(actor: YearTransitionReclassifyActor): void {
  if (actor.isAdmin && actor.kind !== "teacher" && actor.kind !== "student") return;
  throw new YearTransitionReclassifyAuthError();
}

export function inheritedPublicationReclassifyKind(
  item: Pick<PrototypeAgendaItem, "annualCourseId" | "courseSessionKey" | "sourceTransitionId" | "schoolYearId">,
  targetYearId: string,
  liveSessionKeys: ReadonlySet<string>,
): ReclassifyPlacementKind | null {
  if ((item.schoolYearId ?? "").trim() !== targetYearId) return null;
  if (!item.sourceTransitionId?.trim()) return null;
  return publicationReclassifyKind(item, liveSessionKeys);
}

export function inheritedNoteReclassifyKind(
  note: Pick<AnnualCourseNote, "annualCourseId" | "courseSessionKey" | "sourceNoteId" | "inheritedAt" | "schoolYearId">,
  targetYearId: string,
  liveSessionKeys: ReadonlySet<string>,
): ReclassifyPlacementKind | null {
  if (note.schoolYearId !== targetYearId) return null;
  if (!note.annualCourseId?.trim()) return null;
  if (!note.sourceNoteId?.trim() && !note.inheritedAt?.trim()) return null;
  return noteReclassifyKind(note, liveSessionKeys);
}

export function formatReclassifySessionLabel(session: Pick<CourseSession, "date" | "dayOfWeek" | "segments">): string {
  const weekday = COURSE_WEEKDAY_LABELS[session.dayOfWeek];
  const longDate = formatLongFrenchDate(session.date);
  const heading = `${weekday} ${longDate}`;
  const periods = formatCourseSessionPeriods(session.segments);
  return periods ? `${heading} — ${periods}` : heading;
}

export function candidateSessionsForCourse(
  sessions: readonly CourseSession[],
  schoolYearId: string,
  annualCourseId: string,
): YearTransitionReclassifySessionOption[] {
  return sessions
    .filter((session) => session.schoolYearId === schoolYearId && session.annualCourseId === annualCourseId)
    .slice()
    .sort((left, right) => left.date.localeCompare(right.date) || left.sequenceNumber - right.sequenceNumber)
    .map((session) => ({
      key: session.key,
      date: session.date,
      sequenceNumber: session.sequenceNumber,
      label: formatReclassifySessionLabel(session),
      annualCourseId: session.annualCourseId,
      schoolYearId: session.schoolYearId,
    }));
}

export async function listYearTransitionReclassifyQueue(
  deps: YearTransitionReclassifyDeps,
  schoolYearId: string,
  actor: YearTransitionReclassifyActor,
): Promise<YearTransitionReclassifyQueue> {
  assertAdminReclassifyAccess(actor);
  return buildQueue(deps, schoolYearId.trim());
}

export async function applyYearTransitionReclassify(
  deps: YearTransitionReclassifyDeps,
  input: {
    schoolYearId: string;
    kind: YearTransitionReclassifyItemKind;
    publicationId?: number | null;
    noteId?: string | null;
    courseSessionKey: string;
  },
  actor: YearTransitionReclassifyActor,
): Promise<YearTransitionReclassifySuccess | YearTransitionReclassifyFailure> {
  try {
    assertAdminReclassifyAccess(actor);
  } catch (error) {
    if (error instanceof YearTransitionReclassifyAuthError) {
      return { ok: false, status: 403, code: error.code, reason: error.message };
    }
    throw error;
  }

  const schoolYearId = input.schoolYearId.trim();
  const courseSessionKey = input.courseSessionKey.trim();
  if (!schoolYearId || !courseSessionKey) {
    return { ok: false, status: 400, code: "INVALID", reason: "Année et séance cible obligatoires." };
  }

  const sessions = await liveSessionsForYear(deps, schoolYearId);
  if (sessions === null) {
    return { ok: false, status: 404, code: "YEAR_NOT_FOUND", reason: "Année scolaire introuvable." };
  }
  const session = sessions.find((entry) => entry.key === courseSessionKey) ?? null;
  if (!session) {
    return {
      ok: false,
      status: 409,
      code: "SESSION_GONE",
      reason: YEAR_TRANSITION_RECLASSIFY_SESSION_GONE,
    };
  }
  if (session.schoolYearId !== schoolYearId) {
    return { ok: false, status: 400, code: "OTHER_YEAR", reason: YEAR_TRANSITION_RECLASSIFY_OTHER_COURSE };
  }

  if (input.kind === "publication") {
    const placed = await reclassifyPublication(deps, input.publicationId, session, schoolYearId, sessions);
    if (!placed.ok) return placed;
    return { ok: true, queue: await buildQueue(deps, schoolYearId), publication: placed.item };
  }

  const placed = await reclassifyNote(deps, input.noteId, session, schoolYearId, sessions);
  if (!placed.ok) return placed;
  return { ok: true, queue: await buildQueue(deps, schoolYearId), note: placed.note };
}

function formatLongFrenchDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  if (!year || !month || !day) return isoDate;
  const monthLabel = MONTHS_FR[Number(month) - 1];
  return monthLabel ? `${Number(day)} ${monthLabel} ${year}` : isoDate;
}

function liveKeysForCourse(sessions: readonly CourseSession[], annualCourseId: string): Set<string> {
  return new Set(
    sessions.filter((session) => session.annualCourseId === annualCourseId).map((session) => session.key),
  );
}

function hasPublicationProvenance(item: Pick<PrototypeAgendaItem, "sourceTransitionId">): boolean {
  return Boolean(item.sourceTransitionId?.trim());
}

function hasNoteProvenance(note: Pick<AnnualCourseNote, "sourceNoteId" | "inheritedAt">): boolean {
  return Boolean(note.sourceNoteId?.trim() || note.inheritedAt?.trim());
}

function publicationReason(kind: ReclassifyPlacementKind): string {
  return kind === "ORPHANED"
    ? "La séance précédemment associée n’existe plus après modification des jours de cours."
    : "Aucune séance cible unique n’a pu être déterminée.";
}

function noteReason(kind: ReclassifyPlacementKind): string {
  return kind === "ORPHANED"
    ? "La séance précédemment associée n’existe plus après modification des jours de cours."
    : "Ancienne référence pédagogique sans correspondance directe.";
}

function sourceSessionLabel(
  kind: ReclassifyPlacementKind,
  courseSessionKey: string | null | undefined,
  referenceSessionId: string | null | undefined,
): string | null {
  if (kind === "ORPHANED") {
    const parsed = parseCourseSessionKey(courseSessionKey ?? "");
    if (parsed) return `Ancienne référence : séance du ${formatSwissDate(parsed.date)}`;
  }
  if (referenceSessionId?.trim()) return "Ancienne référence pédagogique";
  return null;
}

async function liveSessionsForYear(
  deps: YearTransitionReclassifyDeps,
  schoolYearId: string,
): Promise<CourseSession[] | null> {
  const year = await deps.years.getSchoolYearById(schoolYearId);
  if (!year) return null;
  const courses = (await deps.courses.listCourses()).filter(
    (course) => course.schoolYearId === schoolYearId && !course.isArchived,
  );
  const courseIds = new Set(courses.map((course) => course.id));
  const [slots, meetingDays, exceptions] = await Promise.all([
    deps.schedules.listSlots(),
    deps.schedules.listMeetingDays(),
    deps.years.listDayExceptions(schoolYearId),
  ]);
  return computeCourseSessions({
    schoolYearId: year.id,
    courses: courses.map((course) => ({
      id: course.id,
      classId: course.classId,
      contextId: course.contextId,
    })),
    slots: slots.filter((slot) => courseIds.has(slot.annualCourseId)),
    weeks: year.weeks,
    holidays: valaisHolidaysForSchoolYear(year.label),
    exceptions,
    meetingDays: meetingDays.filter((day) => courseIds.has(day.annualCourseId)),
  });
}

async function buildQueue(
  deps: YearTransitionReclassifyDeps,
  schoolYearId: string,
): Promise<YearTransitionReclassifyQueue> {
  const year = await deps.years.getSchoolYearById(schoolYearId);
  if (!year) {
    return {
      schoolYearId,
      yearLabel: schoolYearId,
      count: 0,
      complete: true,
      groups: [],
    };
  }

  const [courses, classes, professions, contexts, branches, items, sessions] = await Promise.all([
    deps.courses.listCourses(),
    deps.catalog.listClasses(),
    deps.catalog.listProfessions(),
    deps.catalog.listContexts(),
    deps.catalog.listBranches(),
    deps.agenda.exportAllItems(),
    liveSessionsForYear(deps, schoolYearId),
  ]);
  const liveSessions = sessions ?? [];
  const yearCourses = courses.filter((course) => course.schoolYearId === schoolYearId && !course.isArchived);
  const lookups = { classes, professions, contexts, branches, courses: yearCourses };
  const notes = (
    await Promise.all(yearCourses.map((course) => deps.notes.listNotesByAnnualCourse(course.id)))
  ).flat();

  const groupsByClass = new Map<string, YearTransitionReclassifyClassGroup>();

  for (const course of yearCourses) {
    const keys = liveKeysForCourse(liveSessions, course.id);
    const courseItems: YearTransitionReclassifyItem[] = [];
    const classOption = presentTransitionClass(
      classes.find((entry) => entry.id === course.classId) ?? {
        id: course.classId,
        code: course.classId,
        label: course.classId,
        sortOrder: 0,
        isActive: true,
        schoolYearId,
        schoolYearLabel: year.label,
        professionId: null,
        trainingYear: null,
        parallelCode: null,
        isArchived: false,
        archivedAt: null,
      },
      professions,
    );
    const presentedCourse = presentTransitionCourse(course, lookups);
    const courseLabel = presentedCourse.label || presentedCourse.branchLabel;
    const classLabel = classOption.code.trim() || classOption.displayName;

    for (const item of items) {
      const kind = inheritedPublicationReclassifyKind(item, schoolYearId, keys);
      if (!kind || item.annualCourseId !== course.id) continue;
      courseItems.push({
        id: `publication:${item.id}`,
        kind: "publication",
        publicationId: item.id,
        noteId: null,
        type: item.type,
        typeLabel: PUBLICATION_TYPE_LABELS[item.type],
        title: item.title,
        annualCourseId: course.id,
        classId: course.classId,
        courseLabel,
        classLabel,
        reclassifyKind: kind,
        reasonLabel: publicationReason(kind),
        sourceSessionLabel: sourceSessionLabel(kind, item.courseSessionKey, item.referenceSessionId),
        studentVisible: item.studentVisible === false ? false : Boolean(item.studentVisible),
      });
    }

    for (const note of notes) {
      const kind = inheritedNoteReclassifyKind(note, schoolYearId, keys);
      if (!kind || note.annualCourseId !== course.id) continue;
      courseItems.push({
        id: `note:${note.id}`,
        kind: "note",
        publicationId: null,
        noteId: note.id,
        type: "NOTE",
        typeLabel: "Note interne",
        title: null,
        annualCourseId: course.id,
        classId: course.classId,
        courseLabel,
        classLabel,
        reclassifyKind: kind,
        reasonLabel: noteReason(kind),
        sourceSessionLabel: sourceSessionLabel(kind, note.courseSessionKey, note.referenceSessionId),
        studentVisible: null,
      });
    }

    if (courseItems.length === 0) continue;
    courseItems.sort((left, right) => (left.title ?? left.typeLabel).localeCompare(right.title ?? right.typeLabel, "fr"));

    const classGroup = groupsByClass.get(course.classId) ?? {
      classId: course.classId,
      classLabel,
      courses: [],
    };
    classGroup.courses.push({
      annualCourseId: course.id,
      courseLabel,
      classId: course.classId,
      sessions: candidateSessionsForCourse(liveSessions, schoolYearId, course.id),
      items: courseItems,
    });
    groupsByClass.set(course.classId, classGroup);
  }

  const groups = [...groupsByClass.values()]
    .map((group) => ({
      ...group,
      courses: group.courses.sort((left, right) => left.courseLabel.localeCompare(right.courseLabel, "fr")),
    }))
    .sort((left, right) => left.classLabel.localeCompare(right.classLabel, "fr"));
  const count = groups.reduce(
    (total, group) => total + group.courses.reduce((sum, course) => sum + course.items.length, 0),
    0,
  );

  return {
    schoolYearId: year.id,
    yearLabel: formatSchoolYearLabelFr(year.label),
    count,
    complete: count === 0,
    groups,
  };
}

async function reclassifyPublication(
  deps: YearTransitionReclassifyDeps,
  publicationId: number | null | undefined,
  session: CourseSession,
  schoolYearId: string,
  sessions: readonly CourseSession[],
): Promise<{ ok: true; item: PrototypeAgendaItem } | YearTransitionReclassifyFailure> {
  if (!Number.isInteger(publicationId) || !publicationId) {
    return { ok: false, status: 400, code: "INVALID", reason: "Publication introuvable." };
  }
  const item = await deps.agenda.findAgendaItem(publicationId);
  if (!item) return { ok: false, status: 404, code: "NOT_FOUND", reason: "Publication introuvable." };
  if (!hasPublicationProvenance(item) || (item.schoolYearId ?? "") !== schoolYearId) {
    return { ok: false, status: 400, code: "NOT_ELIGIBLE", reason: "Cet élément n’est plus à reclasser." };
  }
  const annualCourseId = item.annualCourseId?.trim() ?? "";
  if (!annualCourseId) {
    return { ok: false, status: 400, code: "NOT_ELIGIBLE", reason: "Cet élément n’est plus à reclasser." };
  }
  if (session.annualCourseId !== annualCourseId) {
    return { ok: false, status: 400, code: "OTHER_COURSE", reason: YEAR_TRANSITION_RECLASSIFY_OTHER_COURSE };
  }
  const keys = liveKeysForCourse(sessions, annualCourseId);
  if (!inheritedPublicationReclassifyKind(item, schoolYearId, keys)) {
    return { ok: false, status: 400, code: "NOT_ELIGIBLE", reason: "Cet élément n’est plus à reclasser." };
  }
  const bound = bindPublicationToCourseSession(item, session);
  const written = await deps.agenda.placeAgendaItemOnCourseSession(item.id, {
    courseSessionKey: bound.courseSessionKey!,
    courseSessionDate: bound.courseSessionDate!,
    schoolWeekNumber: bound.schoolWeekNumber,
    day: bound.day,
  });
  if (!written.ok) {
    return { ok: false, status: written.status === 404 ? 404 : 400, code: "WRITE_FAILED", reason: written.reason };
  }
  return { ok: true, item: written.item };
}

async function reclassifyNote(
  deps: YearTransitionReclassifyDeps,
  noteId: string | null | undefined,
  session: CourseSession,
  schoolYearId: string,
  sessions: readonly CourseSession[],
): Promise<{ ok: true; note: AnnualCourseNote } | YearTransitionReclassifyFailure> {
  const id = noteId?.trim() ?? "";
  if (!id) return { ok: false, status: 400, code: "INVALID", reason: "Note introuvable." };
  const note = await deps.notes.getNote(id);
  if (!note) return { ok: false, status: 404, code: "NOT_FOUND", reason: "Note introuvable." };
  if (!hasNoteProvenance(note) || note.schoolYearId !== schoolYearId) {
    return { ok: false, status: 400, code: "NOT_ELIGIBLE", reason: "Cet élément n’est plus à reclasser." };
  }
  const annualCourseId = note.annualCourseId?.trim() ?? "";
  if (!annualCourseId) {
    return { ok: false, status: 400, code: "NOT_ELIGIBLE", reason: "Cet élément n’est plus à reclasser." };
  }
  if (session.annualCourseId !== annualCourseId) {
    return { ok: false, status: 400, code: "OTHER_COURSE", reason: YEAR_TRANSITION_RECLASSIFY_OTHER_COURSE };
  }
  const keys = liveKeysForCourse(sessions, annualCourseId);
  if (!inheritedNoteReclassifyKind(note, schoolYearId, keys)) {
    return { ok: false, status: 400, code: "NOT_ELIGIBLE", reason: "Cet élément n’est plus à reclasser." };
  }
  const bound = bindNoteToCourseSession(note, session);
  const written = await deps.notes.updateNoteCourseSession(note.id, bound.courseSessionKey!);
  if (!written) return { ok: false, status: 404, code: "NOT_FOUND", reason: "Note introuvable." };
  return { ok: true, note: written };
}

export function parseYearTransitionReclassifyRequest(body: unknown): {
  schoolYearId: string;
  kind: YearTransitionReclassifyItemKind;
  publicationId: number | null;
  noteId: string | null;
  courseSessionKey: string;
} {
  if (!body || typeof body !== "object") {
    throw new Error("Corps JSON invalide.");
  }
  const record = body as Record<string, unknown>;
  const schoolYearId = typeof record.schoolYearId === "string" ? record.schoolYearId.trim() : "";
  const courseSessionKey = typeof record.courseSessionKey === "string" ? record.courseSessionKey.trim() : "";
  const kind = record.kind === "note" ? "note" : record.kind === "publication" ? "publication" : "";
  if (!schoolYearId || !courseSessionKey || !kind) {
    throw new Error("Année, type et séance cible obligatoires.");
  }
  const publicationId =
    typeof record.publicationId === "number"
      ? record.publicationId
      : typeof record.publicationId === "string" && record.publicationId.trim()
        ? Number(record.publicationId)
        : null;
  const noteId = typeof record.noteId === "string" ? record.noteId.trim() : null;
  if (kind === "publication" && (!publicationId || !Number.isInteger(publicationId))) {
    throw new Error("Publication introuvable.");
  }
  if (kind === "note" && !noteId) {
    throw new Error("Note introuvable.");
  }
  return { schoolYearId, kind, publicationId, noteId, courseSessionKey };
}
