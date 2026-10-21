import type { PrototypeAgendaItem } from "../agenda/demo-items.ts";
import type { AnnualCourse } from "../annual-courses/types.ts";
import type { CourseSession } from "../course-sessions/types.ts";
import type { ReferencePedagogicalItem, ReferencePedagogicalPath, ReferenceSession } from "../pedagogical-path/types.ts";
import { indexClassMappings, resolveClassMapping } from "./class-mapping.ts";
import { yearTransitionPreviewFingerprint } from "./fingerprint.ts";
import { previewPrivateNotes } from "./private-notes.ts";
import {
  contextPathPresent,
  pathSessionsForContext,
  resolveUniqueSourceCourseSession,
  trimAnchorId,
  uniquePathSessionAtPosition,
} from "./session-anchor.ts";
import {
  YEAR_TRANSITION_PREVIEW_REASON_ORDER,
  type YearTransitionPreviewReason,
  type YearTransitionPreviewWarning,
} from "./reasons.ts";
import type {
  YearTransitionPreviewEntry,
  YearTransitionPreviewInput,
  YearTransitionPreviewResult,
  YearTransitionProposedPlacement,
  YearTransitionSourceTemporal,
} from "./types.ts";

/**
 * Heure Agenda historique, identique à STRUCTURED_AGENDA_COMPAT_HOUR.
 * Ce n’est PAS une donnée temporelle de N et PAS l’identité de la CourseSession.
 */
export const YEAR_TRANSITION_AGENDA_COMPAT_HOUR = 8;

interface PathHit {
  path: ReferencePedagogicalPath;
  session: ReferenceSession;
  item: ReferencePedagogicalItem;
}

function cloneCourseSession(session: CourseSession): CourseSession {
  return {
    ...session,
    segments: session.segments.map((segment) => ({ ...segment })),
  };
}

function trimId(value: string | null | undefined): string | null {
  return trimAnchorId(value);
}

function sourceTemporal(item: PrototypeAgendaItem): YearTransitionSourceTemporal {
  return {
    schoolWeekNumber: item.schoolWeekNumber,
    day: item.day,
    hour: item.hour,
    weekOffset: item.weekOffset,
    courseSessionDate: item.courseSessionDate ?? null,
    courseSessionKey: item.courseSessionKey ?? null,
  };
}

function emptyEntry(item: PrototypeAgendaItem, reason: YearTransitionPreviewReason): YearTransitionPreviewEntry {
  return {
    reason,
    warnings: [],
    sourceAgendaItemId: item.id,
    sourceAnnualCourseId: trimId(item.annualCourseId),
    sourceClassId: null,
    targetClassId: null,
    targetAnnualCourseId: null,
    referenceItemId: trimId(item.referenceItemId),
    sourceReferenceSessionId: trimId(item.referenceSessionId),
    resolvedReferenceSessionId: null,
    pedagogicalPosition: null,
    targetCourseSession: null,
    proposedPlacement: null,
    sourceTemporal: sourceTemporal(item),
  };
}

function coursesById(courses: readonly AnnualCourse[], schoolYearId: string): Map<string, AnnualCourse> {
  const map = new Map<string, AnnualCourse>();
  const ordered = [...courses]
    .filter((course) => course.schoolYearId === schoolYearId)
    .sort(
      (left, right) =>
        left.id.localeCompare(right.id) ||
        left.classId.localeCompare(right.classId) ||
        left.contextId.localeCompare(right.contextId),
    );
  for (const course of ordered) {
    if (!map.has(course.id)) map.set(course.id, course);
  }
  return map;
}

function indexPathHits(paths: readonly ReferencePedagogicalPath[]): Map<string, PathHit[]> {
  const hits = new Map<string, PathHit[]>();
  for (const path of paths) {
    for (const session of path.sessions) {
      for (const item of session.items) {
        const list = hits.get(item.id) ?? [];
        list.push({ path, session, item });
        hits.set(item.id, list);
      }
    }
  }
  return hits;
}

function indexTargetRefs(items: readonly PrototypeAgendaItem[], targetYearId: string): Map<string, PrototypeAgendaItem[]> {
  const map = new Map<string, PrototypeAgendaItem[]>();
  for (const item of items) {
    if ((item.schoolYearId ?? null) !== targetYearId) continue;
    const courseId = trimId(item.annualCourseId);
    const ref = trimId(item.referenceItemId);
    if (!courseId || !ref) continue;
    const key = `${courseId}\0${ref}`;
    const list = map.get(key) ?? [];
    list.push(item);
    map.set(key, list);
  }
  return map;
}

function indexTargetSessions(
  sessions: readonly CourseSession[],
  targetYearId: string,
): Map<string, CourseSession[]> {
  const map = new Map<string, CourseSession[]>();
  for (const session of sessions) {
    if (session.schoolYearId !== targetYearId) continue;
    const key = `${session.annualCourseId}\0${session.sequenceNumber}`;
    const list = map.get(key) ?? [];
    list.push(session);
    map.set(key, list);
  }
  return map;
}

function existingMatchesExpected(
  existing: PrototypeAgendaItem,
  expected: { course: AnnualCourse; session: CourseSession; referenceItemId: string; referenceSessionId: string },
): boolean {
  return (
    trimId(existing.annualCourseId) === expected.course.id &&
    trimId(existing.referenceItemId) === expected.referenceItemId &&
    trimId(existing.courseSessionKey) === expected.session.key &&
    trimId(existing.courseSessionDate) === expected.session.date &&
    trimId(existing.referenceSessionId) === expected.referenceSessionId
  );
}

function placementFromSession(session: CourseSession): YearTransitionProposedPlacement {
  return {
    schoolYearId: session.schoolYearId,
    annualCourseId: session.annualCourseId,
    courseSessionKey: session.key,
    courseSessionDate: session.date,
    schoolWeekNumber: session.schoolWeekNumber,
    day: session.dayOfWeek - 1,
    hour: YEAR_TRANSITION_AGENDA_COMPAT_HOUR,
    sequenceNumber: session.sequenceNumber,
  };
}

function compareEntries(left: YearTransitionPreviewEntry, right: YearTransitionPreviewEntry): number {
  return (
    YEAR_TRANSITION_PREVIEW_REASON_ORDER[left.reason] - YEAR_TRANSITION_PREVIEW_REASON_ORDER[right.reason] ||
    left.sourceAgendaItemId - right.sourceAgendaItemId ||
    (left.referenceItemId ?? "").localeCompare(right.referenceItemId ?? "")
  );
}

interface PartialResolution {
  item: PrototypeAgendaItem;
  referenceItemId: string | null;
  resolvedReferenceSessionId: string | null;
  pedagogicalPosition: number | null;
  carnetOwned: boolean;
  sourceCourse: AnnualCourse | null;
  sourceClassId: string | null;
  targetClassId: string | null;
  targetCourse: AnnualCourse | null;
  structuralReason: YearTransitionPreviewReason | null;
}

function emptyStructure(
  item: PrototypeAgendaItem,
  reason: YearTransitionPreviewReason,
  extras: Partial<PartialResolution> = {},
): PartialResolution {
  return {
    item,
    referenceItemId: trimId(item.referenceItemId),
    resolvedReferenceSessionId: trimId(item.referenceSessionId),
    pedagogicalPosition: null,
    carnetOwned: !trimId(item.referenceItemId) && !trimId(item.referenceSessionId),
    sourceCourse: null,
    sourceClassId: null,
    targetClassId: null,
    targetCourse: null,
    structuralReason: reason,
    ...extras,
  };
}

function resolvePedagogicalAnchor(
  item: PrototypeAgendaItem,
  sourceCourse: AnnualCourse,
  pathSnapshots: readonly ReferencePedagogicalPath[],
  sourceSessions: readonly CourseSession[],
): Pick<PartialResolution, "referenceItemId" | "resolvedReferenceSessionId" | "pedagogicalPosition" | "structuralReason"> {
  const sessions = pathSessionsForContext(pathSnapshots, sourceCourse.contextId);
  const itemRef = trimId(item.referenceItemId);
  if (itemRef) {
    return {
      referenceItemId: itemRef,
      resolvedReferenceSessionId: trimId(item.referenceSessionId),
      pedagogicalPosition: null,
      structuralReason: null,
    };
  }

  const sessionRef = trimId(item.referenceSessionId);
  if (sessionRef) {
    if (sessions.length === 0) {
      return {
        referenceItemId: null,
        resolvedReferenceSessionId: sessionRef,
        pedagogicalPosition: null,
        structuralReason: "PATH_ABSENT",
      };
    }
    const hits = sessions.filter((session) => session.id === sessionRef);
    const position = hits[0]?.position ?? null;
    if (hits.length !== 1 || position == null || !Number.isInteger(position) || position < 1) {
      return {
        referenceItemId: null,
        resolvedReferenceSessionId: sessionRef,
        pedagogicalPosition: null,
        structuralReason: hits.length === 0 ? "PATH_POSITION_UNRESOLVED" : "ORPHAN_DEAD_REFERENCE_ITEM",
      };
    }
    if (sessions.filter((session) => session.position === position).length !== 1) {
      return {
        referenceItemId: null,
        resolvedReferenceSessionId: sessionRef,
        pedagogicalPosition: position,
        structuralReason: "SNAPSHOT_REFERENCE_CONFLICT",
      };
    }
    const uniqueItem = hits[0]!.items.length === 1 ? hits[0]!.items[0]!.id : null;
    return {
      referenceItemId: uniqueItem,
      resolvedReferenceSessionId: sessionRef,
      pedagogicalPosition: position,
      structuralReason: null,
    };
  }

  const sourceSession = resolveUniqueSourceCourseSession(item, sourceCourse, sourceSessions);
  if (sourceSession) {
    const position = sourceSession.sequenceNumber;
    const atPosition = uniquePathSessionAtPosition(sessions, position);
    return {
      referenceItemId: null,
      resolvedReferenceSessionId: atPosition?.id ?? null,
      pedagogicalPosition: position,
      structuralReason: null,
    };
  }
  return {
    referenceItemId: null,
    resolvedReferenceSessionId: null,
    pedagogicalPosition: null,
    structuralReason: trimId(item.courseSessionKey) ? "SOURCE_SESSION_UNRESOLVED" : "ORPHAN_NO_REFERENCE_ITEM",
  };
}

function resolveStructure(
  item: PrototypeAgendaItem,
  sourceCourses: Map<string, AnnualCourse>,
  targetCourses: readonly AnnualCourse[],
  targetYearId: string,
  mappingIndex: ReturnType<typeof indexClassMappings>,
  pathSnapshots: readonly ReferencePedagogicalPath[],
  sourceSessions: readonly CourseSession[],
): PartialResolution {
  const sourceCourseId = trimId(item.annualCourseId);
  const sourceCourse = sourceCourseId ? sourceCourses.get(sourceCourseId) ?? null : null;
  if (!sourceCourseId || !sourceCourse) {
    return emptyStructure(item, "SOURCE_COURSE_MISSING");
  }
  const sourceClassId = sourceCourse.classId;

  const mapping = resolveClassMapping(sourceClassId, mappingIndex);
  const withSource = { sourceCourse, sourceClassId };
  if (mapping.status === "missing") {
    return emptyStructure(item, "CLASS_MAPPING_MISSING", withSource);
  }
  if (mapping.status === "no_continuation") {
    return emptyStructure(item, "CLASS_CONTINUATION_ABSENT", withSource);
  }
  if (mapping.status === "conflict") {
    return emptyStructure(item, "CLASS_MAPPING_CONFLICT", {
      ...withSource,
      targetClassId: mapping.targetClassId,
    });
  }
  if (mapping.status === "unsupported") {
    return emptyStructure(item, "UNSUPPORTED_CLASS_MAPPING_CARDINALITY", withSource);
  }

  const candidates = targetCourses.filter(
    (course) =>
      course.schoolYearId === targetYearId &&
      course.classId === mapping.targetClassId &&
      course.contextId === sourceCourse.contextId,
  );
  if (candidates.length === 0) {
    return emptyStructure(item, "TARGET_COURSE_MISSING", {
      ...withSource,
      targetClassId: mapping.targetClassId,
    });
  }
  if (candidates.length > 1) {
    return emptyStructure(item, "TARGET_COURSE_AMBIGUOUS", {
      ...withSource,
      targetClassId: mapping.targetClassId,
    });
  }

  const targetCourse = candidates[0]!;
  if (targetCourse.isArchived) {
    return emptyStructure(item, "TARGET_COURSE_ARCHIVED", {
      ...withSource,
      targetClassId: mapping.targetClassId,
      targetCourse,
    });
  }

  const anchor = resolvePedagogicalAnchor(item, sourceCourse, pathSnapshots, sourceSessions);
  return {
    item,
    carnetOwned: !trimId(item.referenceItemId) && !trimId(item.referenceSessionId),
    sourceCourse,
    sourceClassId,
    targetClassId: mapping.targetClassId,
    targetCourse,
    referenceItemId: anchor.referenceItemId,
    resolvedReferenceSessionId: anchor.resolvedReferenceSessionId,
    pedagogicalPosition: anchor.pedagogicalPosition,
    structuralReason: anchor.structuralReason,
  };
}

function applyEntry(
  resolved: PartialResolution,
  reason: YearTransitionPreviewReason,
  extras: Partial<YearTransitionPreviewEntry> = {},
): YearTransitionPreviewEntry {
  return {
    ...emptyEntry(resolved.item, reason),
    sourceAnnualCourseId: resolved.sourceCourse?.id ?? trimId(resolved.item.annualCourseId),
    sourceClassId: resolved.sourceClassId,
    targetClassId: resolved.targetClassId,
    targetAnnualCourseId: resolved.targetCourse?.id ?? null,
    referenceItemId: resolved.referenceItemId,
    resolvedReferenceSessionId: resolved.resolvedReferenceSessionId,
    pedagogicalPosition: resolved.pedagogicalPosition,
    ...extras,
    reason,
  };
}

/**
 * PREVIEW N → N+1. Fonction pure : pas d’I/O, pas de Date.now, pas d’UUID, pas de mutation d’entrée.
 * Le placement N+1 vient exclusivement de la CourseSession cible.
 */
export function buildYearTransitionPreview(input: YearTransitionPreviewInput): YearTransitionPreviewResult {
  const mappingIndex = indexClassMappings(input.classMappings);
  const sourceCourses = coursesById(input.sourceCourses, input.sourceSchoolYearId);
  const pathHits = indexPathHits(input.pathSnapshots);
  const targetRefs = indexTargetRefs(input.targetItems, input.targetSchoolYearId);
  const targetSessions = indexTargetSessions(input.targetCourseSessions, input.targetSchoolYearId);
  const sourceSessions = input.sourceCourseSessions ?? [];

  const sourceItems = input.sourceItems.filter((item) => (item.schoolYearId ?? null) === input.sourceSchoolYearId);
  const partials = sourceItems.map((item) =>
    resolveStructure(
      item,
      sourceCourses,
      input.targetCourses,
      input.targetSchoolYearId,
      mappingIndex,
      input.pathSnapshots,
      sourceSessions,
    ),
  );

  const duplicateKeys = new Map<string, number>();
  for (const partial of partials) {
    if (partial.carnetOwned || !partial.referenceItemId || partial.structuralReason) continue;
    const key = `${partial.targetCourse!.id}\0${partial.referenceItemId}`;
    duplicateKeys.set(key, (duplicateKeys.get(key) ?? 0) + 1);
  }

  const entries: YearTransitionPreviewEntry[] = [];

  for (const partial of partials) {
    if (partial.structuralReason) {
      entries.push(applyEntry(partial, partial.structuralReason));
      continue;
    }

    const targetCourse = partial.targetCourse!;
    const referenceItemId = partial.referenceItemId;
    if (referenceItemId && !partial.carnetOwned && (duplicateKeys.get(`${targetCourse.id}\0${referenceItemId}`) ?? 0) > 1) {
      entries.push(applyEntry(partial, "DUPLICATE_SOURCE_REFERENCE"));
      continue;
    }

    let position = partial.pedagogicalPosition;
    let resolvedSessionId = partial.resolvedReferenceSessionId;
    if (referenceItemId && position == null) {
      const hits = pathHits.get(referenceItemId) ?? [];
      const scoped = hits.filter((hit) => hit.path.contextId === targetCourse.contextId);
      if (scoped.length === 0) {
        entries.push(
          applyEntry(
            partial,
            contextPathPresent(input.pathSnapshots, targetCourse.contextId)
              ? "ORPHAN_DEAD_REFERENCE_ITEM"
              : "PATH_ABSENT",
          ),
        );
        continue;
      }
      if (scoped.length > 1) {
        entries.push(applyEntry(partial, "SNAPSHOT_REFERENCE_CONFLICT"));
        continue;
      }
      const hit = scoped[0]!;
      position = hit.session.position;
      resolvedSessionId = hit.session.id;
    }
    if (position == null || !Number.isInteger(position) || position < 1) {
      entries.push(
        applyEntry(partial, "INVALID_REFERENCE_SESSION_POSITION", {
          resolvedReferenceSessionId: resolvedSessionId,
          pedagogicalPosition: Number.isInteger(position) ? position : null,
        }),
      );
      continue;
    }
    if (!resolvedSessionId && !partial.carnetOwned) {
      entries.push(
        applyEntry(
          partial,
          contextPathPresent(input.pathSnapshots, targetCourse.contextId)
            ? "PATH_POSITION_UNRESOLVED"
            : "PATH_ABSENT",
          { pedagogicalPosition: position },
        ),
      );
      continue;
    }

    const warnings: YearTransitionPreviewWarning[] = [];
    const sourceSessionId = trimId(partial.item.referenceSessionId);
    if (sourceSessionId && sourceSessionId !== resolvedSessionId) {
      warnings.push("REFERENCE_SESSION_CHANGED");
    }

    const sessions = [...(targetSessions.get(`${targetCourse.id}\0${position}`) ?? [])].sort(
      (left, right) => left.key.localeCompare(right.key) || left.date.localeCompare(right.date),
    );
    if (sessions.length === 0) {
      entries.push(
        applyEntry(partial, "UNSCHEDULED_REFERENCE_SESSION", {
          warnings,
          resolvedReferenceSessionId: resolvedSessionId,
          pedagogicalPosition: position,
        }),
      );
      continue;
    }
    if (sessions.length > 1) {
      entries.push(
        applyEntry(partial, "TARGET_SESSION_AMBIGUOUS", {
          warnings,
          resolvedReferenceSessionId: resolvedSessionId,
          pedagogicalPosition: position,
        }),
      );
      continue;
    }

    const courseSession = cloneCourseSession(sessions[0]!);
    const existing = partial.carnetOwned
      ? input.targetItems
          .filter(
            (candidate) =>
              (candidate.schoolYearId ?? null) === input.targetSchoolYearId &&
              trimId(candidate.annualCourseId) === targetCourse.id &&
              candidate.sourceAgendaItemId === partial.item.id,
          )
          .sort((left, right) => left.id - right.id)
      : [...(targetRefs.get(`${targetCourse.id}\0${referenceItemId ?? ""}`) ?? [])].sort(
          (left, right) => left.id - right.id,
        );
    if (!partial.carnetOwned && existing.length > 1) {
      entries.push(
        applyEntry(partial, "TARGET_REFERENCE_CONFLICT", {
          warnings,
          resolvedReferenceSessionId: resolvedSessionId,
          pedagogicalPosition: position,
          targetCourseSession: courseSession,
          proposedPlacement: placementFromSession(courseSession),
        }),
      );
      continue;
    }
    if (existing.length === 1) {
      const matches = partial.carnetOwned
        ? trimId(existing[0]!.courseSessionKey) === courseSession.key
        : existingMatchesExpected(existing[0]!, {
            course: targetCourse,
            session: courseSession,
            referenceItemId: referenceItemId ?? "",
            referenceSessionId: resolvedSessionId ?? "",
          });
      entries.push(
        applyEntry(partial, matches ? "ALREADY_PRESENT" : "TARGET_EXISTING_DIVERGED", {
          warnings,
          resolvedReferenceSessionId: resolvedSessionId,
          pedagogicalPosition: position,
          targetCourseSession: courseSession,
          proposedPlacement: matches ? null : placementFromSession(courseSession),
        }),
      );
      continue;
    }

    entries.push(
      applyEntry(partial, "PROJECTABLE", {
        warnings,
        resolvedReferenceSessionId: resolvedSessionId,
        pedagogicalPosition: position,
        targetCourseSession: courseSession,
        proposedPlacement: placementFromSession(courseSession),
      }),
    );
  }

  entries.sort(compareEntries);

  return {
    sourceSchoolYearId: input.sourceSchoolYearId,
    targetSchoolYearId: input.targetSchoolYearId,
    fingerprint: yearTransitionPreviewFingerprint(input),
    mappingSummary: mappingIndex.summary,
    ...(input.includePrivateNotes ? { privateNotes: previewPrivateNotes(input) } : {}),
    entries,
  };
}
