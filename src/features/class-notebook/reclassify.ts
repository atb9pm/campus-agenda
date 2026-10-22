import type { PrototypeAgendaItem } from "../agenda/demo-items.ts";
import type { AnnualCourseNote } from "../pedagogical-path/annual-notes.ts";
import type { CourseSession } from "../course-sessions/types.ts";

export const RECLASSIFY_PLACEMENT_KINDS = ["UNPLACED", "ORPHANED"] as const;
export type ReclassifyPlacementKind = (typeof RECLASSIFY_PLACEMENT_KINDS)[number];

/**
 * Publication à reclasser : cours annuel connu, mais aucune séance vivante.
 * `courseSessionKey == null` → UNPLACED. Une clé orpheline (séance disparue
 * après un changement de MeetingDay) → ORPHANED. Jamais reprojetée
 * automatiquement par sequenceNumber.
 */
export function publicationReclassifyKind(
  item: Pick<PrototypeAgendaItem, "annualCourseId" | "courseSessionKey">,
  liveSessionKeys: ReadonlySet<string>,
): ReclassifyPlacementKind | null {
  if (!item.annualCourseId?.trim()) return null;
  const key = item.courseSessionKey?.trim() ?? "";
  if (!key) return "UNPLACED";
  return liveSessionKeys.has(key) ? null : "ORPHANED";
}

export function noteReclassifyKind(
  note: Pick<AnnualCourseNote, "courseSessionKey">,
  liveSessionKeys: ReadonlySet<string>,
): ReclassifyPlacementKind | null {
  const key = note.courseSessionKey?.trim() ?? "";
  if (!key) return "UNPLACED";
  return liveSessionKeys.has(key) ? null : "ORPHANED";
}

export function publicationNeedsReclassification(
  item: Pick<PrototypeAgendaItem, "annualCourseId" | "courseSessionKey">,
  liveSessionKeys?: ReadonlySet<string>,
): boolean {
  if (!item.annualCourseId?.trim()) return false;
  const key = item.courseSessionKey?.trim() ?? "";
  if (!key) return true;
  return Boolean(liveSessionKeys && !liveSessionKeys.has(key));
}

export function noteNeedsReclassification(
  note: Pick<AnnualCourseNote, "courseSessionKey">,
  liveSessionKeys?: ReadonlySet<string>,
): boolean {
  const key = note.courseSessionKey?.trim() ?? "";
  if (!key) return true;
  return Boolean(liveSessionKeys && !liveSessionKeys.has(key));
}

export function countPublicationsToReclassify(
  items: readonly Pick<PrototypeAgendaItem, "annualCourseId" | "courseSessionKey">[],
  liveSessionKeys?: ReadonlySet<string>,
): number {
  return items.filter((item) => publicationNeedsReclassification(item, liveSessionKeys)).length;
}

export function countNotesToReclassify(
  notes: readonly Pick<AnnualCourseNote, "courseSessionKey">[],
  liveSessionKeys?: ReadonlySet<string>,
): number {
  return notes.filter((note) => noteNeedsReclassification(note, liveSessionKeys)).length;
}

/**
 * Reclassement manuel ultérieur : pose la vraie séance, sans publier.
 * `studentVisible` n’est pas modifié.
 */
export function bindPublicationToCourseSession(
  item: PrototypeAgendaItem,
  session: CourseSession,
): PrototypeAgendaItem {
  return {
    ...item,
    schoolYearId: session.schoolYearId,
    annualCourseId: session.annualCourseId,
    courseSessionKey: session.key,
    courseSessionDate: session.date,
    schoolWeekNumber: session.schoolWeekNumber,
    day: session.dayOfWeek - 1,
  };
}

export function bindNoteToCourseSession(note: AnnualCourseNote, session: CourseSession): AnnualCourseNote {
  return {
    ...note,
    schoolYearId: session.schoolYearId,
    annualCourseId: session.annualCourseId,
    courseSessionKey: session.key,
  };
}
