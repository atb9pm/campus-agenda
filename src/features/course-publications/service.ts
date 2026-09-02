import type { PrototypeAgendaItem } from "../agenda/demo-items.ts";
import type { AgendaStore } from "../../lib/persistence/types.ts";
import type { AnnualCourseStore } from "../../lib/persistence/annual-course-types.ts";
import type { CourseScheduleStore } from "../../lib/persistence/course-schedule-types.ts";
import type { PedagogicalPathStore } from "../../lib/persistence/pedagogical-path-types.ts";
import type { RuntimeAgendaAdapterStore } from "../../lib/persistence/runtime-agenda-types.ts";
import type { SchoolCatalogStore } from "../../lib/persistence/school-catalog-types.ts";
import type { SchoolYearStore } from "../../lib/persistence/school-year-types.ts";
import type { TeacherAccountStore } from "../../lib/persistence/teacher-account-types.ts";
import { validateAttributionReferential } from "../annual-courses/validation.ts";
import type { AnnualCourse } from "../annual-courses/types.ts";
import type { PedagogicalContextRecord, SchoolProfessionRecord } from "../school-catalog/profession-types.ts";
import type { SchoolBranchRecord, SchoolClassRecord } from "../school-catalog/types.ts";
import type { SchoolYearRecord } from "../school-year/types.ts";
import { listComputedCourseSessions } from "../course-sessions/index.ts";
import {
  assignmentInstantForSessionDate,
  contextBranchForCourse,
  ensureRuntimeSubjectForAnnualCourse,
  teacherHasStructuredPublishAccess,
} from "../agenda-bridge/index.ts";

/** Compatibilité Agenda historique. Ce n'est PAS l'identité de la CourseSession. */
export const STRUCTURED_AGENDA_COMPAT_HOUR = 8;

export const STRUCTURED_PUBLISH_ALREADY_REASON =
  "Cet élément de référence a déjà été publié dans l’Agenda pour ce cours.";
export const STRUCTURED_PUBLISH_SESSION_GONE_REASON =
  "Cette séance n’existe plus dans l’horaire actuel. Impossible de publier.";
export const STRUCTURED_PUBLISH_ITEM_MOVED_REASON =
  "Cet élément n’appartient plus à la séance de référence correspondant à cette date.";
export const STRUCTURED_PUBLISH_FORBIDDEN_REASON =
  "Vous n’êtes pas autorisé à publier cet élément : vous n’êtes pas affecté à ce cours à cette date.";
export const STRUCTURED_PUBLISH_YEAR_DRAFT_REASON =
  "Cette année scolaire est en brouillon. Impossible de publier un nouvel élément.";
export const STRUCTURED_PUBLISH_YEAR_ARCHIVED_REASON =
  "Cette année scolaire est archivée. Impossible de publier un nouvel élément.";
export const STRUCTURED_PUBLISH_COURSE_ARCHIVED_REASON =
  "Ce cours annuel est archivé. Impossible de publier.";

export function structuredPublishReferentialGuard(options: {
  year: SchoolYearRecord | null | undefined;
  schoolClass: SchoolClassRecord | null | undefined;
  profession: SchoolProfessionRecord | null | undefined;
  context: PedagogicalContextRecord | null | undefined;
  branch: SchoolBranchRecord | null | undefined;
  course: AnnualCourse;
}): StructuredPublishErr | null {
  if (!options.year) {
    return { ok: false, reason: "Année scolaire introuvable.", status: 404 };
  }
  if (options.year.status === "draft") {
    return { ok: false, reason: STRUCTURED_PUBLISH_YEAR_DRAFT_REASON, status: 409 };
  }
  if (options.year.status !== "active") {
    return { ok: false, reason: STRUCTURED_PUBLISH_YEAR_ARCHIVED_REASON, status: 409 };
  }
  if (options.course.isArchived) {
    return { ok: false, reason: STRUCTURED_PUBLISH_COURSE_ARCHIVED_REASON, status: 409 };
  }

  const referential = validateAttributionReferential({
    year: options.year,
    schoolClass: options.schoolClass,
    profession: options.profession,
    context: options.context,
    branch: options.branch,
  });
  if (!referential.ok) {
    return { ok: false, reason: referential.reason, status: 409 };
  }
  return null;
}

export async function recoverStructuredPublishUniqueConflict(
  agenda: AgendaStore,
  annualCourseId: string,
  referenceItemId: string,
): Promise<StructuredPublishErr | null> {
  const existing = await agenda.findAgendaItemByReferenceItem(annualCourseId, referenceItemId);
  if (!existing) return null;
  return { ok: false, reason: STRUCTURED_PUBLISH_ALREADY_REASON, status: 409 };
}

export interface StructuredPublishDeps {
  courses: AnnualCourseStore;
  catalog: SchoolCatalogStore;
  years: SchoolYearStore;
  teachers: TeacherAccountStore;
  schedules: CourseScheduleStore;
  paths: PedagogicalPathStore;
  agenda: AgendaStore;
  adapters: RuntimeAgendaAdapterStore;
}

export type StructuredPublishOk = { ok: true; item: PrototypeAgendaItem };
export type StructuredPublishErr = { ok: false; reason: string; status: 400 | 403 | 404 | 409 };
export type StructuredPublishResult = StructuredPublishOk | StructuredPublishErr;

export interface StructuredPublishInput {
  teacherId: string;
  annualCourseId: string;
  courseSessionKey: string;
  referenceItemId: string;
}

export function structuredPublishIdsFromBody(body: unknown): {
  annualCourseId: string;
  courseSessionKey: string;
  referenceItemId: string;
} {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  return {
    annualCourseId: typeof record.annualCourseId === "string" ? record.annualCourseId.trim() : "",
    courseSessionKey: typeof record.courseSessionKey === "string" ? record.courseSessionKey.trim() : "",
    referenceItemId: typeof record.referenceItemId === "string" ? record.referenceItemId.trim() : "",
  };
}

export async function publishReferenceItemToAgenda(
  deps: StructuredPublishDeps,
  input: StructuredPublishInput,
): Promise<StructuredPublishResult> {
  const annualCourseId = input.annualCourseId.trim();
  const courseSessionKey = input.courseSessionKey.trim();
  const referenceItemId = input.referenceItemId.trim();
  if (!annualCourseId || !courseSessionKey || !referenceItemId) {
    return { ok: false, reason: "Identifiants de publication incomplets.", status: 400 };
  }

  const teacher = await deps.teachers.findAccount(input.teacherId);
  if (!teacher || !teacher.isActive || teacher.isArchived) {
    return { ok: false, reason: STRUCTURED_PUBLISH_FORBIDDEN_REASON, status: 403 };
  }

  const course = await deps.courses.getCourse(annualCourseId);
  if (!course) return { ok: false, reason: "Cours annuel introuvable.", status: 404 };

  await deps.catalog.ensureSeeded();
  const [classes, branches, contexts, professions, year] = await Promise.all([
    deps.catalog.listClasses(),
    deps.catalog.listBranches(),
    deps.catalog.listContexts(),
    deps.catalog.listProfessions(),
    deps.years.getSchoolYearById(course.schoolYearId),
  ]);

  const schoolClass = classes.find((entry) => entry.id === course.classId) ?? null;
  if (!schoolClass) return { ok: false, reason: "Classe introuvable.", status: 404 };

  const branchInfo = contextBranchForCourse({ course, contexts, branches });
  const profession = schoolClass.professionId
    ? professions.find((entry) => entry.id === schoolClass.professionId) ?? null
    : undefined;
  const referential = structuredPublishReferentialGuard({
    year,
    schoolClass,
    profession,
    context: branchInfo?.context ?? null,
    branch: branchInfo ? branchInfo.branch : null,
    course,
  });
  if (referential) return referential;

  const sessionsResult = await listComputedCourseSessions(deps, {
    schoolYearId: course.schoolYearId,
    classId: course.classId,
    annualCourseId: course.id,
  });
  if (!sessionsResult.ok) {
    return { ok: false, reason: sessionsResult.reason, status: 409 };
  }

  const courseSession = sessionsResult.value.find((entry) => entry.key === courseSessionKey) ?? null;
  if (!courseSession) {
    return { ok: false, reason: STRUCTURED_PUBLISH_SESSION_GONE_REASON, status: 409 };
  }

  const at = assignmentInstantForSessionDate(courseSession.date);
  const assignments = await deps.courses.listAssignments(course.id);
  if (
    !teacherHasStructuredPublishAccess({
      teacherId: teacher.id,
      annualCourseId: course.id,
      assignments,
      at,
    })
  ) {
    return { ok: false, reason: STRUCTURED_PUBLISH_FORBIDDEN_REASON, status: 403 };
  }

  const path = await deps.paths.getPathByContextId(course.contextId);
  if (!path) {
    return { ok: false, reason: "Aucun parcours pédagogique de référence n’est défini pour ce cours.", status: 409 };
  }

  const referenceSession =
    path.sessions.find((session) => session.position === courseSession.sequenceNumber) ?? null;
  const itemAnywhere = path.sessions.flatMap((session) => session.items).find((item) => item.id === referenceItemId);
  if (!itemAnywhere) {
    return { ok: false, reason: "Élément pédagogique de référence introuvable.", status: 404 };
  }
  const existing = await deps.agenda.findAgendaItemByReferenceItem(course.id, itemAnywhere.id);
  if (existing) {
    return { ok: false, reason: STRUCTURED_PUBLISH_ALREADY_REASON, status: 409 };
  }
  if (!referenceSession) {
    return { ok: false, reason: STRUCTURED_PUBLISH_ITEM_MOVED_REASON, status: 409 };
  }
  const referenceItem = referenceSession.items.find((item) => item.id === referenceItemId) ?? null;
  if (!referenceItem) {
    return { ok: false, reason: STRUCTURED_PUBLISH_ITEM_MOVED_REASON, status: 409 };
  }

  if (!branchInfo) {
    return { ok: false, reason: "Contexte pédagogique du cours introuvable.", status: 409 };
  }

  const allCourses = await deps.courses.listCourses();
  const adapters = await ensureRuntimeSubjectForAnnualCourse(deps.adapters, {
    schoolClass,
    course,
    branch: branchInfo.branch,
    allSchoolClasses: classes,
    courses: allCourses,
    contexts,
    branches,
  });
  if (!adapters.ok) {
    return { ok: false, reason: adapters.reason, status: 409 };
  }

  try {
    const item = await deps.agenda.createAgendaItem({
      classroomId: adapters.value.classroom.id,
      subjectId: adapters.value.subject.id,
      authorTeacherId: teacher.id,
      day: courseSession.dayOfWeek - 1,
      hour: STRUCTURED_AGENDA_COMPAT_HOUR,
      weekOffset: 0,
      schoolWeekNumber: courseSession.schoolWeekNumber,
      type: referenceItem.type,
      title: referenceItem.title,
      detail: referenceItem.detail,
      schoolYearId: courseSession.schoolYearId,
      annualCourseId: course.id,
      courseSessionKey: courseSession.key,
      courseSessionDate: courseSession.date,
      referenceSessionId: referenceSession.id,
      referenceItemId: referenceItem.id,
    });
    return { ok: true, item };
  } catch (error) {
    const raced = await recoverStructuredPublishUniqueConflict(deps.agenda, course.id, referenceItem.id);
    if (raced) return raced;
    throw error;
  }
}
