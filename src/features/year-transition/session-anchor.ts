import type { PrototypeAgendaItem } from "../agenda/demo-items.ts";
import type { AnnualCourse } from "../annual-courses/types.ts";
import { parseCourseSessionKey } from "../course-sessions/compute.ts";
import type { CourseSession } from "../course-sessions/types.ts";
import { resolveAgendaItemSession } from "../notebook-export/session-match.ts";
import type { ReferencePedagogicalPath, ReferenceSession } from "../pedagogical-path/types.ts";

export function trimAnchorId(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

export function sourceSessionsForCourse(
  sessions: readonly CourseSession[],
  course: Pick<AnnualCourse, "id" | "schoolYearId" | "classId">,
): CourseSession[] {
  return sessions.filter(
    (session) =>
      session.annualCourseId === course.id &&
      session.schoolYearId === course.schoolYearId &&
      session.classId === course.classId,
  );
}

export function pathSessionsForContext(
  paths: readonly ReferencePedagogicalPath[],
  contextId: string,
): ReferenceSession[] {
  return paths.filter((path) => path.contextId === contextId).flatMap((path) => path.sessions);
}

export function contextPathPresent(
  paths: readonly ReferencePedagogicalPath[],
  contextId: string,
): boolean {
  return pathSessionsForContext(paths, contextId).length > 0;
}

export function uniquePathSessionAtPosition(
  sessions: readonly ReferenceSession[],
  position: number,
): ReferenceSession | null {
  const atPosition = sessions.filter((session) => session.position === position);
  return atPosition.length === 1 ? atPosition[0]! : null;
}

/**
 * Identifie la séance annuelle source comme le Carnet : clé encore valide,
 * puis date, puis couple semaine/jour non ambigu. Jamais un décalage de dates.
 */
export function resolveUniqueSourceCourseSession(
  item: Pick<PrototypeAgendaItem, "courseSessionKey" | "courseSessionDate" | "schoolWeekNumber" | "day">,
  course: Pick<AnnualCourse, "id" | "schoolYearId" | "classId">,
  sourceSessions: readonly CourseSession[],
): CourseSession | null {
  const scoped = sourceSessionsForCourse(sourceSessions, course);
  const resolved = resolveAgendaItemSession(item, scoped);
  return resolved.kind === "UNMATCHED" ? null : resolved.session;
}

/**
 * Notes privées : clé de séance, puis date extraite de la clé.
 * Pas de fallback semaine/jour — une note n’a pas ces champs Agenda.
 */
export function resolveUniqueSourceCourseSessionFromKey(
  courseSessionKey: string | null | undefined,
  course: Pick<AnnualCourse, "id" | "schoolYearId" | "classId">,
  sourceSessions: readonly CourseSession[],
): CourseSession | null {
  const scoped = sourceSessionsForCourse(sourceSessions, course);
  const key = trimAnchorId(courseSessionKey);
  if (!key) return null;
  const byKey = scoped.filter((session) => session.key === key);
  if (byKey.length === 1) return byKey[0]!;
  if (byKey.length > 1) return null;
  const parsed = parseCourseSessionKey(key);
  if (!parsed || parsed.annualCourseId !== course.id || parsed.schoolYearId !== course.schoolYearId) {
    return null;
  }
  const byDate = scoped.filter((session) => session.date === parsed.date);
  return byDate.length === 1 ? byDate[0]! : null;
}

export function uniqueTargetSessionAtSequence(
  sessions: readonly CourseSession[],
  target: {
    schoolYearId: string;
    annualCourseId: string;
    classId?: string | null;
    contextId?: string | null;
  },
  sequenceNumber: number,
): CourseSession | null {
  const matches = sessions.filter(
    (session) =>
      session.schoolYearId === target.schoolYearId &&
      session.annualCourseId === target.annualCourseId &&
      session.sequenceNumber === sequenceNumber &&
      (target.classId == null || session.classId === target.classId) &&
      (target.contextId == null || session.contextId === target.contextId),
  );
  return matches.length === 1 ? matches[0]! : null;
}
