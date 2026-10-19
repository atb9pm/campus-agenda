import type { PrototypeAgendaItem } from "../agenda/demo-items.ts";
import type { AnnualCourse } from "../annual-courses/types.ts";
import type { CourseSession } from "../course-sessions/types.ts";
import type { ReferencePedagogicalItem, ReferencePedagogicalPath, ReferenceSession } from "../pedagogical-path/types.ts";
import { indexClassMappings, resolveClassMapping } from "./class-mapping.ts";
import { yearTransitionPreviewFingerprint } from "./fingerprint.ts";
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
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
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
  sourceCourse: AnnualCourse | null;
  sourceClassId: string | null;
  targetClassId: string | null;
  targetCourse: AnnualCourse | null;
  structuralReason: YearTransitionPreviewReason | null;
}

function resolveStructure(
  item: PrototypeAgendaItem,
  sourceCourses: Map<string, AnnualCourse>,
  targetCourses: readonly AnnualCourse[],
  targetYearId: string,
  mappingIndex: ReturnType<typeof indexClassMappings>,
): PartialResolution {
  const referenceItemId = trimId(item.referenceItemId);
  if (!referenceItemId) {
    return {
      item,
      referenceItemId: null,
      sourceCourse: null,
      sourceClassId: null,
      targetClassId: null,
      targetCourse: null,
      structuralReason: "ORPHAN_NO_REFERENCE_ITEM",
    };
  }

  const sourceCourseId = trimId(item.annualCourseId);
  const sourceCourse = sourceCourseId ? sourceCourses.get(sourceCourseId) ?? null : null;
  if (!sourceCourseId || !sourceCourse) {
    return {
      item,
      referenceItemId,
      sourceCourse: null,
      sourceClassId: null,
      targetClassId: null,
      targetCourse: null,
      structuralReason: "SOURCE_COURSE_MISSING",
    };
  }
  const sourceClassId = sourceCourse.classId;

  const mapping = resolveClassMapping(sourceClassId, mappingIndex);
  if (mapping.status === "missing") {
    return {
      item,
      referenceItemId,
      sourceCourse,
      sourceClassId,
      targetClassId: null,
      targetCourse: null,
      structuralReason: "CLASS_MAPPING_MISSING",
    };
  }
  if (mapping.status === "no_continuation") {
    return {
      item,
      referenceItemId,
      sourceCourse,
      sourceClassId,
      targetClassId: null,
      targetCourse: null,
      structuralReason: "CLASS_CONTINUATION_ABSENT",
    };
  }
  if (mapping.status === "conflict") {
    return {
      item,
      referenceItemId,
      sourceCourse,
      sourceClassId,
      targetClassId: mapping.targetClassId,
      targetCourse: null,
      structuralReason: "CLASS_MAPPING_CONFLICT",
    };
  }
  if (mapping.status === "unsupported") {
    return {
      item,
      referenceItemId,
      sourceCourse,
      sourceClassId,
      targetClassId: null,
      targetCourse: null,
      structuralReason: "UNSUPPORTED_CLASS_MAPPING_CARDINALITY",
    };
  }

  const candidates = targetCourses.filter(
    (course) =>
      course.schoolYearId === targetYearId &&
      course.classId === mapping.targetClassId &&
      course.contextId === sourceCourse.contextId,
  );
  if (candidates.length === 0) {
    return {
      item,
      referenceItemId,
      sourceCourse,
      sourceClassId,
      targetClassId: mapping.targetClassId,
      targetCourse: null,
      structuralReason: "TARGET_COURSE_MISSING",
    };
  }
  if (candidates.length > 1) {
    return {
      item,
      referenceItemId,
      sourceCourse,
      sourceClassId,
      targetClassId: mapping.targetClassId,
      targetCourse: null,
      structuralReason: "TARGET_COURSE_AMBIGUOUS",
    };
  }

  const targetCourse = candidates[0]!;
  if (targetCourse.isArchived) {
    return {
      item,
      referenceItemId,
      sourceCourse,
      sourceClassId,
      targetClassId: mapping.targetClassId,
      targetCourse,
      structuralReason: "TARGET_COURSE_ARCHIVED",
    };
  }

  return {
    item,
    referenceItemId,
    sourceCourse,
    sourceClassId,
    targetClassId: mapping.targetClassId,
    targetCourse,
    structuralReason: null,
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

  const sourceItems = input.sourceItems.filter((item) => (item.schoolYearId ?? null) === input.sourceSchoolYearId);
  const partials = sourceItems.map((item) =>
    resolveStructure(item, sourceCourses, input.targetCourses, input.targetSchoolYearId, mappingIndex),
  );

  const duplicateKeys = new Map<string, number>();
  for (const partial of partials) {
    if (!partial.referenceItemId || partial.structuralReason) continue;
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
    const referenceItemId = partial.referenceItemId!;
    const dupKey = `${targetCourse.id}\0${referenceItemId}`;
    if ((duplicateKeys.get(dupKey) ?? 0) > 1) {
      entries.push(applyEntry(partial, "DUPLICATE_SOURCE_REFERENCE"));
      continue;
    }

    const hits = pathHits.get(referenceItemId) ?? [];
    const scoped = hits.filter((hit) => hit.path.contextId === targetCourse.contextId);
    if (scoped.length === 0) {
      entries.push(applyEntry(partial, "ORPHAN_DEAD_REFERENCE_ITEM"));
      continue;
    }
    if (scoped.length > 1) {
      entries.push(applyEntry(partial, "SNAPSHOT_REFERENCE_CONFLICT"));
      continue;
    }

    const hit = scoped[0]!;
    const position = hit.session.position;
    if (!Number.isInteger(position) || position < 1) {
      entries.push(
        applyEntry(partial, "INVALID_REFERENCE_SESSION_POSITION", {
          resolvedReferenceSessionId: hit.session.id,
          pedagogicalPosition: Number.isInteger(position) ? position : null,
        }),
      );
      continue;
    }

    const warnings: YearTransitionPreviewWarning[] = [];
    const sourceSessionId = trimId(partial.item.referenceSessionId);
    if (sourceSessionId && sourceSessionId !== hit.session.id) {
      warnings.push("REFERENCE_SESSION_CHANGED");
    }

    const sessions = [...(targetSessions.get(`${targetCourse.id}\0${position}`) ?? [])].sort(
      (left, right) => left.key.localeCompare(right.key) || left.date.localeCompare(right.date),
    );
    if (sessions.length === 0) {
      entries.push(
        applyEntry(partial, "UNSCHEDULED_REFERENCE_SESSION", {
          warnings,
          resolvedReferenceSessionId: hit.session.id,
          pedagogicalPosition: position,
        }),
      );
      continue;
    }
    if (sessions.length > 1) {
      entries.push(
        applyEntry(partial, "TARGET_SESSION_AMBIGUOUS", {
          warnings,
          resolvedReferenceSessionId: hit.session.id,
          pedagogicalPosition: position,
        }),
      );
      continue;
    }

    const courseSession = cloneCourseSession(sessions[0]!);
    const existing = [...(targetRefs.get(dupKey) ?? [])].sort((left, right) => left.id - right.id);
    if (existing.length > 1) {
      entries.push(
        applyEntry(partial, "TARGET_REFERENCE_CONFLICT", {
          warnings,
          resolvedReferenceSessionId: hit.session.id,
          pedagogicalPosition: position,
          targetCourseSession: courseSession,
          proposedPlacement: placementFromSession(courseSession),
        }),
      );
      continue;
    }
    if (existing.length === 1) {
      const matches = existingMatchesExpected(existing[0]!, {
        course: targetCourse,
        session: courseSession,
        referenceItemId,
        referenceSessionId: hit.session.id,
      });
      entries.push(
        applyEntry(partial, matches ? "ALREADY_PRESENT" : "TARGET_EXISTING_DIVERGED", {
          warnings,
          resolvedReferenceSessionId: hit.session.id,
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
        resolvedReferenceSessionId: hit.session.id,
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
    entries,
  };
}
