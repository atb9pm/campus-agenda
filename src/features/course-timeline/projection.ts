import type { CourseSession } from "../course-sessions/types.ts";
import type { ReferencePedagogicalItem, ReferenceSession } from "../pedagogical-path/types.ts";
import type {
  BuildCourseTimelineInput,
  CourseTimelineBuildResult,
  CourseTimelineIdentity,
  CourseTimelineProjection,
} from "./types.ts";

function cloneCourseSession(session: CourseSession): CourseSession {
  return {
    ...session,
    segments: session.segments.map((segment) => ({ ...segment })),
  };
}

function cloneSortedItems(items: readonly ReferencePedagogicalItem[]): ReferencePedagogicalItem[] {
  return items
    .map((item) => ({ ...item }))
    .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
}

function cloneSortedReferenceSession(session: ReferenceSession): ReferenceSession {
  return {
    ...session,
    items: cloneSortedItems(session.items),
  };
}

function sessionMatchesIdentity(session: CourseSession, identity: CourseTimelineIdentity): boolean {
  return (
    session.schoolYearId === identity.schoolYearId &&
    session.classId === identity.classId &&
    session.annualCourseId === identity.annualCourseId &&
    session.contextId === identity.contextId
  );
}

/**
 * Associe les séances réelles calculées aux séances de référence du parcours CTX.
 * Pure : copies locales, tri déterministe, aucune I/O, aucune mutation d’entrée.
 */
export function buildCourseTimeline(input: BuildCourseTimelineInput): CourseTimelineBuildResult {
  const identity = input.identity;
  const courseSessions = input.courseSessions;
  const referencePath = input.referencePath;

  for (const session of courseSessions) {
    if (!sessionMatchesIdentity(session, identity)) {
      return { ok: false, reason: "Une séance réelle n’appartient pas au cours demandé." };
    }
  }

  if (referencePath !== null && referencePath.contextId !== identity.contextId) {
    return { ok: false, reason: "Le parcours pédagogique n’appartient pas au contexte du cours." };
  }

  const sortedSessions = courseSessions
    .map(cloneCourseSession)
    .sort(
      (left, right) =>
        left.sequenceNumber - right.sequenceNumber ||
        left.date.localeCompare(right.date) ||
        left.key.localeCompare(right.key),
    );

  const sortedReferences =
    referencePath === null
      ? []
      : referencePath.sessions
          .map(cloneSortedReferenceSession)
          .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));

  const referenceByPosition = new Map<number, ReferenceSession>();
  for (const session of sortedReferences) {
    if (!referenceByPosition.has(session.position)) {
      referenceByPosition.set(session.position, session);
    }
  }

  const scheduledPositions = new Set(sortedSessions.map((session) => session.sequenceNumber));

  const projection: CourseTimelineProjection = {
    annualCourseId: identity.annualCourseId,
    contextId: identity.contextId,
    referencePathExists: referencePath !== null,
    entries: sortedSessions.map((courseSession) => ({
      courseSession,
      referenceSession: referenceByPosition.get(courseSession.sequenceNumber) ?? null,
    })),
    unscheduledReferenceSessions: sortedReferences.filter(
      (session) => !scheduledPositions.has(session.position),
    ),
  };

  return { ok: true, value: projection };
}
