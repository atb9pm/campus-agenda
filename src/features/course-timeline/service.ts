import type { CourseScheduleServiceDeps } from "../course-schedule/service.ts";
import { listComputedCourseSessions } from "../course-sessions/index.ts";
import type { PedagogicalPathStore } from "../../lib/persistence/pedagogical-path-types.ts";
import { listTeacherCourses } from "../teacher-workspace/service.ts";
import type { TeacherCourseWorkspaceEntry } from "../teacher-workspace/types.ts";
import { buildCourseTimeline } from "./projection.ts";
import type { CourseTimelineProjection, TeacherCourseTimelineCourse } from "./types.ts";

export const COURSE_TIMELINE_MISSING_ID_REASON = "L’identifiant du cours annuel est obligatoire.";
export const COURSE_TIMELINE_NOT_FOUND_REASON = "Cours annuel introuvable.";
export const COURSE_TIMELINE_FORBIDDEN_REASON =
  "Vous n’êtes pas autorisé à consulter le déroulement de ce cours.";
export const COURSE_TIMELINE_COHERENCE_REASON = "Incohérence des données du cours.";

export interface CourseTimelineServiceDeps extends CourseScheduleServiceDeps {
  paths: PedagogicalPathStore;
}

export type TeacherCourseTimelineOk = {
  ok: true;
  course: TeacherCourseTimelineCourse;
  timeline: CourseTimelineProjection;
};
export type TeacherCourseTimelineErr = { ok: false; reason: string; status: number };
export type TeacherCourseTimelineResult = TeacherCourseTimelineOk | TeacherCourseTimelineErr;

function toTimelineCourse(entry: TeacherCourseWorkspaceEntry): TeacherCourseTimelineCourse {
  return {
    annualCourseId: entry.annualCourseId,
    role: entry.role,
    schoolYearId: entry.schoolYearId,
    schoolYearLabel: entry.schoolYearLabel,
    classId: entry.classId,
    classCode: entry.classCode,
    classLabel: entry.classLabel,
    professionId: entry.professionId,
    professionLabel: entry.professionLabel,
    trainingYear: entry.trainingYear,
    parallelCode: entry.parallelCode,
    contextId: entry.contextId,
    branchId: entry.branchId,
    branchCode: entry.branchCode,
    branchLabel: entry.branchLabel,
  };
}

/**
 * Lecture enseignant : séances réelles (PR57) + parcours CTX, sans écriture.
 * L’autorisation réutilise `listTeacherCourses` (espace opérationnel, TCA active).
 * Une fois autorisé, la timeline n’est pas filtrée par validFrom/validTo.
 */
export async function getTeacherCourseTimeline(
  deps: CourseTimelineServiceDeps,
  options: {
    teacherId: string;
    annualCourseId: string;
    at?: string;
  },
): Promise<TeacherCourseTimelineResult> {
  const annualCourseId = options.annualCourseId.trim();
  if (!annualCourseId) {
    return { ok: false, reason: COURSE_TIMELINE_MISSING_ID_REASON, status: 400 };
  }

  const existing = await deps.courses.getCourse(annualCourseId);
  if (!existing) {
    return { ok: false, reason: COURSE_TIMELINE_NOT_FOUND_REASON, status: 404 };
  }

  const workspace = await listTeacherCourses(deps, {
    teacherId: options.teacherId,
    at: options.at,
  });
  const entry = workspace.courses.find((course) => course.annualCourseId === annualCourseId);
  if (!entry) {
    return { ok: false, reason: COURSE_TIMELINE_FORBIDDEN_REASON, status: 403 };
  }

  const sessionsResult = await listComputedCourseSessions(deps, {
    schoolYearId: entry.schoolYearId,
    classId: entry.classId,
    annualCourseId: entry.annualCourseId,
  });
  if (!sessionsResult.ok) {
    return { ok: false, reason: COURSE_TIMELINE_COHERENCE_REASON, status: 500 };
  }

  const referencePath = await deps.paths.getPathByContextId(entry.contextId);
  const projection = buildCourseTimeline({
    identity: {
      schoolYearId: entry.schoolYearId,
      classId: entry.classId,
      annualCourseId: entry.annualCourseId,
      contextId: entry.contextId,
    },
    courseSessions: sessionsResult.value,
    referencePath,
  });
  if (!projection.ok) {
    return { ok: false, reason: COURSE_TIMELINE_COHERENCE_REASON, status: 500 };
  }

  return {
    ok: true,
    course: toTimelineCourse(entry),
    timeline: projection.value,
  };
}

/** Le `teacherId` client est ignoré : seule la session compte. */
export function sessionTeacherIdForTimelineApi(sessionTeacherId: string): string {
  return sessionTeacherId;
}

export function annualCourseIdFromSearchParams(searchParams: URLSearchParams): string {
  return searchParams.get("annualCourseId")?.trim() ?? "";
}
