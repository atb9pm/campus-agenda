import type { YearTransitionPreviewReason } from "./reasons.ts";

/**
 * Catégorie fonctionnelle N → N+1, distincte du motif diagnostique.
 * Exemple : TO_RECLASSIFY / SOURCE_SESSION_UNRESOLVED.
 */
export const YEAR_TRANSITION_CONTENT_DISPOSITIONS = [
  "PROJECTABLE",
  "ALREADY_PRESENT",
  "TO_RECLASSIFY",
  "SKIPPED",
  "BLOCKING",
] as const;

export type YearTransitionContentDisposition = (typeof YEAR_TRANSITION_CONTENT_DISPOSITIONS)[number];

/** Motifs aujourd’hui « skip » qui deviennent « À reclasser » dans le flux MeetingDays. */
export const YEAR_TRANSITION_PUBLICATION_RECLASSIFY_REASONS = [
  "ORPHAN_NO_REFERENCE_ITEM",
  "SOURCE_SESSION_UNRESOLVED",
  "PATH_ABSENT",
  "PATH_POSITION_UNRESOLVED",
  "ORPHAN_DEAD_REFERENCE_ITEM",
  "UNSCHEDULED_REFERENCE_SESSION",
] as const;

export type YearTransitionPublicationReclassifyReason =
  (typeof YEAR_TRANSITION_PUBLICATION_RECLASSIFY_REASONS)[number];

export const YEAR_TRANSITION_NOTE_RECLASSIFY_REASONS = [
  "NO_REFERENCE",
  "SOURCE_SESSION_UNRESOLVED",
  "PATH_ABSENT",
  "PATH_POSITION_UNRESOLVED",
  "TARGET_SESSION_UNRESOLVED",
] as const;

export type YearTransitionNoteReclassifyReason = (typeof YEAR_TRANSITION_NOTE_RECLASSIFY_REASONS)[number];

const PUBLICATION_RECLASSIFY = new Set<string>(YEAR_TRANSITION_PUBLICATION_RECLASSIFY_REASONS);
const NOTE_RECLASSIFY = new Set<string>(YEAR_TRANSITION_NOTE_RECLASSIFY_REASONS);

export function isPublicationReclassifyReason(
  reason: YearTransitionPreviewReason | string,
): reason is YearTransitionPublicationReclassifyReason {
  return PUBLICATION_RECLASSIFY.has(reason);
}

export function isNoteReclassifyReason(reason: string): reason is YearTransitionNoteReclassifyReason {
  return NOTE_RECLASSIFY.has(reason);
}

export function publicationContentDisposition(
  reason: YearTransitionPreviewReason | string,
  options: { zeroLoss: boolean; targetAnnualCourseId: string | null | undefined },
): YearTransitionContentDisposition {
  if (reason === "PROJECTABLE") return "PROJECTABLE";
  if (reason === "ALREADY_PRESENT") return "ALREADY_PRESENT";
  if (reason === "CLASS_CONTINUATION_ABSENT") return "SKIPPED";
  if (options.zeroLoss && options.targetAnnualCourseId?.trim() && isPublicationReclassifyReason(reason)) {
    return "TO_RECLASSIFY";
  }
  if (isPublicationReclassifyReason(reason)) return "SKIPPED";
  return "BLOCKING";
}

export function noteContentDisposition(
  reason: string,
  options: { zeroLoss: boolean; targetAnnualCourseId: string | null | undefined },
): YearTransitionContentDisposition {
  if (reason === "PROJECTABLE") return "PROJECTABLE";
  if (reason === "ALREADY_PRESENT") return "ALREADY_PRESENT";
  if (reason === "TARGET_NOTE_DIVERGED" || reason === "MAPPING_UNRESOLVED" || reason === "TARGET_COURSE_UNRESOLVED" || reason === "REFERENCE_UNRESOLVED") {
    return "BLOCKING";
  }
  if (options.zeroLoss && options.targetAnnualCourseId?.trim() && isNoteReclassifyReason(reason)) {
    return "TO_RECLASSIFY";
  }
  return "SKIPPED";
}
