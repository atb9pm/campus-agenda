import { createHash } from "node:crypto";

import type { YearTransitionPreviewInput } from "./types.ts";

/**
 * Empreinte matérielle du PREVIEW.
 *
 * Inclus (tout ce qui change le résultat métier ou un APPLY futur) :
 * années, mappings de classes, identités de cours, snapshot de parcours
 * (ids, positions, type/title/detail des items), CourseSession cibles,
 * publications source (id, cours, refs, type/title/detail), publications cibles.
 *
 * Exclus volontairement — diagnostics / provenance historique de N uniquement,
 * jamais utilisés pour le placement ni pour un APPLY :
 * schoolWeekNumber, day, hour, weekOffset, courseSessionDate, courseSessionKey
 * des publications source, ainsi que classroomId, subjectId, authorTeacherId,
 * templateId, studentVisible.
 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.keys(record)
      .sort((left, right) => left.localeCompare(right))
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = canonical(record[key]);
        return acc;
      }, {});
  }
  return value;
}

function compareIds(left: string, right: string): number {
  return left.localeCompare(right);
}

function compareNullable(left: string | null | undefined, right: string | null | undefined): number {
  return (left ?? "").localeCompare(right ?? "");
}

function materialState(input: YearTransitionPreviewInput) {
  return {
    sourceSchoolYearId: input.sourceSchoolYearId,
    targetSchoolYearId: input.targetSchoolYearId,
    classMappings: [...input.classMappings]
      .map((mapping) => ({
        sourceClassId: mapping.sourceClassId,
        targetClassId: mapping.targetClassId,
      }))
      .sort(
        (left, right) =>
          compareNullable(left.sourceClassId, right.sourceClassId) ||
          compareNullable(left.targetClassId, right.targetClassId),
      ),
    sourceCourses: [...input.sourceCourses]
      .map((course) => ({
        id: course.id,
        schoolYearId: course.schoolYearId,
        classId: course.classId,
        contextId: course.contextId,
        isArchived: course.isArchived,
      }))
      .sort(
        (left, right) =>
          compareIds(left.id, right.id) ||
          compareIds(left.classId, right.classId) ||
          compareIds(left.contextId, right.contextId),
      ),
    targetCourses: [...input.targetCourses]
      .map((course) => ({
        id: course.id,
        schoolYearId: course.schoolYearId,
        classId: course.classId,
        contextId: course.contextId,
        isArchived: course.isArchived,
      }))
      .sort(
        (left, right) =>
          compareIds(left.id, right.id) ||
          compareIds(left.classId, right.classId) ||
          compareIds(left.contextId, right.contextId),
      ),
    pathSnapshots: [...input.pathSnapshots]
      .map((path) => ({
        id: path.id,
        contextId: path.contextId,
        updatedAt: path.updatedAt,
        sessions: [...path.sessions]
          .map((session) => ({
            id: session.id,
            position: session.position,
            items: [...session.items]
              .map((item) => ({
                id: item.id,
                type: item.type,
                title: item.title,
                detail: item.detail,
                position: item.position,
              }))
              .sort((left, right) => compareIds(left.id, right.id) || left.position - right.position),
          }))
          .sort((left, right) => compareIds(left.id, right.id) || left.position - right.position),
      }))
      .sort((left, right) => compareIds(left.contextId, right.contextId) || compareIds(left.id, right.id)),
    targetCourseSessions: [...input.targetCourseSessions]
      .map((session) => ({
        key: session.key,
        schoolYearId: session.schoolYearId,
        annualCourseId: session.annualCourseId,
        classId: session.classId,
        contextId: session.contextId,
        sequenceNumber: session.sequenceNumber,
        date: session.date,
        schoolWeekNumber: session.schoolWeekNumber,
        weekKind: session.weekKind,
        dayOfWeek: session.dayOfWeek,
        segments: [...session.segments]
          .map((segment) => ({
            scheduleSlotId: segment.scheduleSlotId,
            periodStart: segment.periodStart,
            periodEnd: segment.periodEnd,
          }))
          .sort(
            (left, right) =>
              compareIds(left.scheduleSlotId, right.scheduleSlotId) ||
              left.periodStart - right.periodStart ||
              left.periodEnd - right.periodEnd,
          ),
      }))
      .sort((left, right) => compareIds(left.key, right.key) || left.sequenceNumber - right.sequenceNumber),
    sourceItems: [...input.sourceItems]
      .map((item) => ({
        id: item.id,
        schoolYearId: item.schoolYearId ?? null,
        annualCourseId: item.annualCourseId ?? null,
        referenceItemId: item.referenceItemId ?? null,
        referenceSessionId: item.referenceSessionId ?? null,
        type: item.type,
        title: item.title,
        detail: item.detail,
      }))
      .sort((left, right) => left.id - right.id),
    targetItems: [...input.targetItems]
      .map((item) => ({
        id: item.id,
        schoolYearId: item.schoolYearId ?? null,
        annualCourseId: item.annualCourseId ?? null,
        referenceItemId: item.referenceItemId ?? null,
        type: item.type,
        title: item.title,
        detail: item.detail,
      }))
      .sort((left, right) => left.id - right.id),
  };
}

/** SHA-256 hexadécimal du graphe matériel du PREVIEW. Déterministe, sans horodatage, indépendant de l’ordre d’entrée. */
export function yearTransitionPreviewFingerprint(input: YearTransitionPreviewInput): string {
  const payload = JSON.stringify(canonical(materialState(input)));
  return createHash("sha256").update(payload).digest("hex");
}
