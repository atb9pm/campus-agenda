import type { PrototypeAgendaItem } from "../agenda/demo-items.ts";
import { isCarnetOwnedPublication } from "./rich-agenda.ts";
import {
  contextBranchForCourse,
  ensureRuntimeSubjectForAnnualCourse,
} from "../agenda-bridge/index.ts";
import type { AnnualCourse } from "../annual-courses/types.ts";
import type { AnnualCourseStore } from "../../lib/persistence/annual-course-types.ts";
import type { AgendaStore } from "../../lib/persistence/types.ts";
import type {
  RuntimeAgendaAdapterStore,
  RuntimeClassroom,
  RuntimeSubject,
} from "../../lib/persistence/runtime-agenda-types.ts";
import type { SchoolCatalogStore } from "../../lib/persistence/school-catalog-types.ts";
import type { SchoolYearStore } from "../../lib/persistence/school-year-types.ts";
import type { SchoolClassRecord } from "../school-catalog/types.ts";
import type { SchoolYearRecord } from "../school-year/types.ts";
import {
  evaluateNotebookPublishAccess,
  NOTEBOOK_PUBLISH_ARCHIVED,
  NOTEBOOK_PUBLISH_CLASS_UNAVAILABLE,
  NOTEBOOK_PUBLISH_COURSE_MISSING,
  NOTEBOOK_PUBLISH_ENDED,
  NOTEBOOK_PUBLISH_FUTURE,
  NOTEBOOK_PUBLISH_NOT_ASSIGNED,
  NOTEBOOK_PUBLISH_YEAR_INACTIVE,
} from "./publish-access.ts";

export const NOTEBOOK_PUBLICATION_TYPES = ["HOMEWORK", "INFORMATION"] as const;
export type NotebookPublicationType = (typeof NOTEBOOK_PUBLICATION_TYPES)[number];

export const NOTEBOOK_PUBLICATION_INVALID_REASON = "Données de publication invalides.";
export const NOTEBOOK_PUBLICATION_TITLE_REQUIRED = "Le titre est obligatoire.";
export const NOTEBOOK_CONTEXT_MISSING_REASON = "Contexte pédagogique du cours introuvable.";

export interface NotebookPublicationDeps {
  courses: AnnualCourseStore;
  catalog: SchoolCatalogStore;
  years: SchoolYearStore;
  adapters: RuntimeAgendaAdapterStore;
  agenda: AgendaStore;
}

export interface ResolvedNotebookPublishContext {
  course: AnnualCourse;
  schoolClass: SchoolClassRecord;
  year: SchoolYearRecord;
  classroom: RuntimeClassroom;
  subject: RuntimeSubject;
}

export type NotebookPublishResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string; status: number };

export function isNotebookPublicationType(value: string): value is NotebookPublicationType {
  return (NOTEBOOK_PUBLICATION_TYPES as readonly string[]).includes(value);
}

export function notebookPublicationFromBody(body: unknown): {
  annualCourseId: string;
  schoolWeekNumber: number;
  day: number;
  type: NotebookPublicationType;
  title: string;
  detail: string;
  ensureOnly: boolean;
} {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const typeRaw = String(record.type ?? "HOMEWORK").trim();
  return {
    annualCourseId: String(record.annualCourseId ?? "").trim(),
    schoolWeekNumber: Number(record.schoolWeekNumber ?? 0),
    day: Number(record.day ?? 0),
    type: isNotebookPublicationType(typeRaw) ? typeRaw : "HOMEWORK",
    title: String(record.title ?? ""),
    detail: String(record.detail ?? ""),
    ensureOnly: record.ensureOnly === true,
  };
}

function statusForPublishReason(reason: string): number {
  if (reason === NOTEBOOK_PUBLISH_COURSE_MISSING) return 404;
  if (
    reason === NOTEBOOK_PUBLISH_NOT_ASSIGNED ||
    reason === NOTEBOOK_PUBLISH_FUTURE ||
    reason === NOTEBOOK_PUBLISH_ENDED ||
    reason === NOTEBOOK_PUBLISH_ARCHIVED
  ) {
    return 403;
  }
  if (reason === NOTEBOOK_PUBLISH_CLASS_UNAVAILABLE || reason === NOTEBOOK_PUBLISH_YEAR_INACTIVE) {
    return 409;
  }
  return 403;
}

export async function resolveNotebookPublishContext(
  deps: NotebookPublicationDeps,
  options: {
    teacherId: string;
    annualCourseId: string;
    at?: string;
  },
): Promise<NotebookPublishResult<ResolvedNotebookPublishContext>> {
  const annualCourseId = options.annualCourseId.trim();
  if (!annualCourseId) {
    return { ok: false, reason: NOTEBOOK_PUBLICATION_INVALID_REASON, status: 400 };
  }

  const [course, classes, assignments, contexts, branches, allCourses, activeYear] = await Promise.all([
    deps.courses.getCourse(annualCourseId),
    deps.catalog.listClasses(),
    deps.courses.listAssignments(annualCourseId),
    deps.catalog.listContexts(),
    deps.catalog.listBranches(),
    deps.courses.listCourses(),
    deps.years.getActiveSchoolYear(),
  ]);

  const schoolClass = course ? classes.find((entry) => entry.id === course.classId) ?? null : null;
  const access = evaluateNotebookPublishAccess({
    teacherId: options.teacherId,
    annualCourse: course,
    schoolClass,
    activeYear,
    assignments,
    at: options.at,
  });
  if (!access.canPublish) {
    return { ok: false, reason: access.reason, status: statusForPublishReason(access.reason) };
  }
  if (!course || !schoolClass || !activeYear) {
    return { ok: false, reason: NOTEBOOK_PUBLISH_COURSE_MISSING, status: 404 };
  }

  const branchInfo = contextBranchForCourse({
    course,
    contexts,
    branches,
  });
  if (!branchInfo) {
    return { ok: false, reason: NOTEBOOK_CONTEXT_MISSING_REASON, status: 409 };
  }

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

  return {
    ok: true,
    value: {
      course,
      schoolClass,
      year: activeYear,
      classroom: adapters.value.classroom,
      subject: adapters.value.subject,
    },
  };
}

export async function createNotebookPublication(
  deps: NotebookPublicationDeps,
  input: {
    teacherId: string;
    annualCourseId: string;
    schoolWeekNumber: number;
    day: number;
    type: NotebookPublicationType;
    title: string;
    detail: string;
    at?: string;
  },
): Promise<NotebookPublishResult<PrototypeAgendaItem>> {
  if (!isNotebookPublicationType(input.type)) {
    return { ok: false, reason: NOTEBOOK_PUBLICATION_INVALID_REASON, status: 400 };
  }
  if (!Number.isFinite(input.schoolWeekNumber) || input.schoolWeekNumber <= 0) {
    return { ok: false, reason: NOTEBOOK_PUBLICATION_INVALID_REASON, status: 400 };
  }
  if (!input.title.trim()) {
    return { ok: false, reason: NOTEBOOK_PUBLICATION_TITLE_REQUIRED, status: 400 };
  }

  const resolved = await resolveNotebookPublishContext(deps, {
    teacherId: input.teacherId,
    annualCourseId: input.annualCourseId,
    at: input.at,
  });
  if (!resolved.ok) return resolved;

  const item = await deps.agenda.createAgendaItem({
    classroomId: resolved.value.classroom.id,
    subjectId: resolved.value.subject.id,
    authorTeacherId: input.teacherId,
    day: input.day,
    hour: 8,
    weekOffset: 0,
    schoolWeekNumber: input.schoolWeekNumber,
    type: input.type,
    title: input.title,
    detail: input.detail,
    schoolYearId: resolved.value.course.schoolYearId,
    annualCourseId: resolved.value.course.id,
  });

  return { ok: true, value: item };
}

export async function authorizeNotebookOwnedItemMutation(
  deps: NotebookPublicationDeps,
  options: {
    teacherId: string;
    item: PrototypeAgendaItem;
    at?: string;
  },
): Promise<NotebookPublishResult<true> | null> {
  const annualCourseId = options.item.annualCourseId?.trim() || "";
  if (!annualCourseId || !isCarnetOwnedPublication(options.item)) {
    return null;
  }
  const resolved = await resolveNotebookPublishContext(deps, {
    teacherId: options.teacherId,
    annualCourseId,
    at: options.at,
  });
  if (!resolved.ok) return resolved;
  return { ok: true, value: true };
}
