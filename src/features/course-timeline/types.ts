import type { CourseSession } from "../course-sessions/types.ts";
import type { ReferencePedagogicalPath, ReferenceSession } from "../pedagogical-path/types.ts";
import type { TeacherCourseWorkspaceEntry } from "../teacher-workspace/types.ts";

/** Identité opérationnelle d’un AnnualCourse pour la projection pédagogique. */
export interface CourseTimelineIdentity {
  schoolYearId: string;
  classId: string;
  annualCourseId: string;
  contextId: string;
}

/**
 * Une séance réelle calculée, associée à la séance de référence
 * dont `position === courseSession.sequenceNumber`, ou `null`.
 */
export interface CourseTimelineEntry {
  courseSession: CourseSession;
  referenceSession: ReferenceSession | null;
}

/**
 * Projection calculée, jamais persistée.
 * `CourseSession.sequenceNumber` = `ReferenceSession.position`.
 */
export interface CourseTimelineProjection {
  annualCourseId: string;
  contextId: string;
  /** `false` si aucun parcours n’existe encore (distinct d’un parcours vide). */
  referencePathExists: boolean;
  entries: CourseTimelineEntry[];
  unscheduledReferenceSessions: ReferenceSession[];
}

export interface BuildCourseTimelineInput {
  identity: CourseTimelineIdentity;
  courseSessions: readonly CourseSession[];
  referencePath: ReferencePedagogicalPath | null;
}

export type CourseTimelineBuildOk = { ok: true; value: CourseTimelineProjection };
export type CourseTimelineBuildErr = { ok: false; reason: string };
export type CourseTimelineBuildResult = CourseTimelineBuildOk | CourseTimelineBuildErr;

/** Métadonnées de cours exposées à l’UI enseignant — sous-ensemble de Mes cours. */
export type TeacherCourseTimelineCourse = Pick<
  TeacherCourseWorkspaceEntry,
  | "annualCourseId"
  | "role"
  | "schoolYearId"
  | "schoolYearLabel"
  | "classId"
  | "classCode"
  | "classLabel"
  | "professionId"
  | "professionLabel"
  | "trainingYear"
  | "parallelCode"
  | "contextId"
  | "branchId"
  | "branchCode"
  | "branchLabel"
>;
