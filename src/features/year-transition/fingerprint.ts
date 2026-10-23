import { createHash } from "node:crypto";

import { normalizeMappingClassId } from "./class-mapping.ts";
import { canonicalizeTargetMeetingDayPlans } from "./target-meeting-days.ts";
import type { YearTransitionPreviewInput } from "./types.ts";

/** Version des règles métier de projection. Fait partie de l’état matériel et du fingerprint. */
export const YEAR_TRANSITION_PREVIEW_ENGINE_VERSION = 5; // 5 : zéro perte MeetingDays (TO_RECLASSIFY)

/**
 * Empreinte matérielle du PREVIEW.
 *
 * Inclus (tout ce qui change le résultat métier ou un APPLY futur) :
 * version du moteur, années, mappings de classes, identités de cours, snapshot de parcours
 * (ids, positions, type/title/detail des items), CourseSession cibles,
 * plan de jours N+1 (`targetMeetingDayPlans` : cours source, dayOfWeek, weekKind, role),
 * publications source (id, cours, refs, courseSessionKey, type/title/detail),
 * CourseSession source (clé, position, cours),
 * publications cibles (refs, courseSessionKey/Date, semaine/jour/heure cibles).
 *
 * Les IDs de mapping sont trimés comme indexClassMappings.
 *
 * Exclus volontairement — diagnostics / provenance historique de N uniquement,
 * jamais utilisés pour le placement ni pour un APPLY :
 * schoolWeekNumber, day, hour, weekOffset, courseSessionDate
 * des publications SOURCE, ainsi que classroomId, subjectId, authorTeacherId,
 * templateId, studentVisible.
 * Les champs temporels TARGET N+1 sont matériels (conformité ALREADY_PRESENT).
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
    ...(input.includePrivateNotes ? {
      includePrivateNotes: true,
      ...(input.privateNotesOwnerTeacherId?.trim()
        ? { privateNotesOwnerTeacherId: input.privateNotesOwnerTeacherId }
        : {}),
      sourceNotes: [...(input.sourceNotes ?? [])].sort((a, b) => a.id.localeCompare(b.id)),
      targetNotes: [...(input.targetNotes ?? [])].sort((a, b) => a.id.localeCompare(b.id)),
    } : {}),
    engineVersion: YEAR_TRANSITION_PREVIEW_ENGINE_VERSION,
    sourceSchoolYearId: input.sourceSchoolYearId,
    targetSchoolYearId: input.targetSchoolYearId,
    selectedSourceClassIds: [...(input.selectedSourceClassIds ?? [])]
      .map((id) => id.trim())
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right)),
    ...(input.selectedSourceAnnualCourseIds
      ? {
          selectedSourceAnnualCourseIds: [...input.selectedSourceAnnualCourseIds]
            .map((id) => id.trim())
            .filter(Boolean)
            .sort((left, right) => left.localeCompare(right)),
        }
      : {}),
    classMappings: [...input.classMappings]
      .map((mapping) => ({
        sourceClassId: normalizeMappingClassId(mapping.sourceClassId),
        targetClassId: normalizeMappingClassId(mapping.targetClassId),
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
    sourceCourseSessions: [...(input.sourceCourseSessions ?? [])]
      .map((session) => ({
        key: session.key,
        schoolYearId: session.schoolYearId,
        annualCourseId: session.annualCourseId,
        classId: session.classId,
        contextId: session.contextId,
        sequenceNumber: session.sequenceNumber,
      }))
      .sort((left, right) => compareIds(left.key, right.key) || left.sequenceNumber - right.sequenceNumber),
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
        courseSessionKey: item.courseSessionKey ?? null,
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
        referenceSessionId: item.referenceSessionId ?? null,
        courseSessionKey: item.courseSessionKey ?? null,
        courseSessionDate: item.courseSessionDate ?? null,
        schoolWeekNumber: item.schoolWeekNumber,
        day: item.day,
        hour: item.hour,
        type: item.type,
        title: item.title,
        detail: item.detail,
      }))
      .sort((left, right) => left.id - right.id),
    ...(input.targetMeetingDayPlans
      ? { targetMeetingDayPlans: canonicalizeTargetMeetingDayPlans(input.targetMeetingDayPlans) }
      : {}),
    ...(input.reimport
      ? {
          reimport: {
            courses: [...input.reimport.courses]
              .map((entry) => ({
                sourceAnnualCourseId: entry.sourceAnnualCourseId,
                targetAnnualCourseId: entry.targetAnnualCourseId,
              }))
              .sort((left, right) => compareIds(left.sourceAnnualCourseId, right.sourceAnnualCourseId)),
            replacedItems: [...input.reimport.replacedItems]
              .map((item) => ({
                id: item.id,
                annualCourseId: item.annualCourseId ?? null,
                sourceTransitionId: item.sourceTransitionId ?? null,
                sourceAgendaItemId: item.sourceAgendaItemId ?? null,
                referenceItemId: item.referenceItemId ?? null,
                referenceSessionId: item.referenceSessionId ?? null,
                courseSessionKey: item.courseSessionKey ?? null,
                studentVisible: item.studentVisible ?? null,
                type: item.type,
                title: item.title,
                detail: item.detail,
              }))
              .sort((left, right) => left.id - right.id),
            replacedNotes: [...input.reimport.replacedNotes].sort((a, b) => a.id.localeCompare(b.id)),
            targetSlots: [...input.reimport.targetSlots].sort((a, b) => a.id.localeCompare(b.id)),
          },
        }
      : {}),
  };
}

/** Objet matériel canonique (clés triées). Unique source de vérité du fingerprint. */
export function yearTransitionPreviewMaterialSnapshot(input: YearTransitionPreviewInput): unknown {
  return canonical(materialState(input));
}

/** JSON exact haché pour le fingerprint — identique à snapshot_json persisté. */
export function yearTransitionPreviewMaterialSnapshotJson(input: YearTransitionPreviewInput): string {
  return JSON.stringify(yearTransitionPreviewMaterialSnapshot(input));
}

export function yearTransitionPreviewFingerprintFromSnapshotJson(snapshotJson: string): string {
  return createHash("sha256").update(snapshotJson).digest("hex");
}

/** SHA-256 hexadécimal du graphe matériel du PREVIEW. Déterministe, sans horodatage, indépendant de l’ordre d’entrée. */
export function yearTransitionPreviewFingerprint(input: YearTransitionPreviewInput): string {
  return yearTransitionPreviewFingerprintFromSnapshotJson(yearTransitionPreviewMaterialSnapshotJson(input));
}

/**
 * Empreinte hors identités cibles encore virtuelles, pour un APPLY qui crée des classes.
 * Le plan de jours N+1 reste matériel (indexé par cours source) : le changer
 * invalide l’aperçu. Les CourseSession cibles restent dans l’empreinte complète.
 */
export function yearTransitionSourceMaterialFingerprint(input: YearTransitionPreviewInput): string {
  const material = materialState(input) as Record<string, unknown>;
  delete material.targetCourses;
  delete material.targetItems;
  delete material.targetCourseSessions;
  // Le PREVIEW persiste les mappings triés, l’APPLY les relit dans l’ordre du catalogue.
  material.classMappings = (input.classMappings ?? [])
    .map((mapping) => ({
      sourceClassId: normalizeMappingClassId(mapping.sourceClassId),
      selected: Boolean(mapping.targetClassId?.trim()) || Boolean(
        (input.selectedSourceClassIds ?? []).includes(mapping.sourceClassId ?? ""),
      ),
    }))
    .sort(
      (left, right) =>
        compareNullable(left.sourceClassId, right.sourceClassId) ||
        Number(left.selected) - Number(right.selected),
    );
  return yearTransitionPreviewFingerprintFromSnapshotJson(JSON.stringify(canonical(material)));
}
