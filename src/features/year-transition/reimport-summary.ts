import { COURSE_WEEKDAY_LABELS, type CourseWeekKind, type CourseWeekday } from "../course-schedule/types.ts";
import type { YearTransitionContentDisposition } from "./disposition.ts";
import type { YearTransitionPreviewInput, YearTransitionPreviewResult } from "./types.ts";

export interface YearTransitionReimportCounts {
  publications: number;
  notes: number;
}

export interface YearTransitionReimportUnusedSlot {
  slotId: string;
  dayOfWeek: CourseWeekday;
  weekKind: CourseWeekKind;
  periodStart: number;
  periodEnd: number;
}

export interface YearTransitionReimportCourseSummary {
  sourceAnnualCourseId: string;
  targetAnnualCourseId: string;
  /** Contenu hérité actuel retiré puis remplacé par la reprojection depuis N. */
  replaced: YearTransitionReimportCounts;
  positioned: YearTransitionReimportCounts;
  toReclassify: YearTransitionReimportCounts;
  lost: YearTransitionReimportCounts;
  blocking: YearTransitionReimportCounts;
  /** Éléments hérités placés à la main par l’administration : leur placement sera recalculé. */
  adminPlacementsRecalculated: number;
  /** Contenu N+1 sans provenance : conservé tel quel. */
  manualContent: { kept: number; onVanishedSession: number };
  /** Créneaux du cours N+1 sans séance correspondante dans le nouveau plan. Jamais modifiés. */
  unusedSlots: YearTransitionReimportUnusedSlot[];
}

function emptyCounts(): YearTransitionReimportCounts {
  return { publications: 0, notes: 0 };
}

function bucketFor(
  summary: YearTransitionReimportCourseSummary,
  disposition: YearTransitionContentDisposition | undefined,
): YearTransitionReimportCounts | null {
  switch (disposition) {
    case "PROJECTABLE":
    case "ALREADY_PRESENT":
      return summary.positioned;
    case "TO_RECLASSIFY":
      return summary.toReclassify;
    case "SKIPPED":
      return summary.lost;
    case "BLOCKING":
      return summary.blocking;
    default:
      return null;
  }
}

/**
 * Résumé par cours réimporté : ce qui est remplacé, positionné, à reclasser, perdu,
 * et les points d’attention. Fonction pure, sans écriture.
 */
export function summarizeYearTransitionReimport(
  input: YearTransitionPreviewInput,
  result: YearTransitionPreviewResult,
  options: {
    adminPlacedItemIds?: ReadonlySet<number>;
    adminPlacedNoteIds?: ReadonlySet<string>;
  } = {},
): YearTransitionReimportCourseSummary[] {
  const scope = input.reimport;
  if (!scope) return [];
  const sourceNoteCourse = new Map((input.sourceNotes ?? []).map((note) => [note.id, note.annualCourseId ?? null]));

  return scope.courses.map(({ sourceAnnualCourseId, targetAnnualCourseId }) => {
    const summary: YearTransitionReimportCourseSummary = {
      sourceAnnualCourseId,
      targetAnnualCourseId,
      replaced: emptyCounts(),
      positioned: emptyCounts(),
      toReclassify: emptyCounts(),
      lost: emptyCounts(),
      blocking: emptyCounts(),
      adminPlacementsRecalculated: 0,
      manualContent: { kept: 0, onVanishedSession: 0 },
      unusedSlots: [],
    };

    const replacedItems = scope.replacedItems.filter((item) => item.annualCourseId === targetAnnualCourseId);
    const replacedNotes = scope.replacedNotes.filter((note) => note.annualCourseId === targetAnnualCourseId);
    summary.replaced.publications = replacedItems.length;
    summary.replaced.notes = replacedNotes.length;
    summary.adminPlacementsRecalculated =
      replacedItems.filter((item) => options.adminPlacedItemIds?.has(item.id)).length +
      replacedNotes.filter((note) => options.adminPlacedNoteIds?.has(note.id)).length;

    for (const entry of result.entries) {
      if (entry.sourceAnnualCourseId !== sourceAnnualCourseId) continue;
      const bucket = bucketFor(summary, entry.disposition);
      if (bucket) bucket.publications += 1;
    }
    for (const entry of result.privateNotes ?? []) {
      if (sourceNoteCourse.get(entry.sourceNoteId) !== sourceAnnualCourseId) continue;
      const bucket = bucketFor(summary, entry.disposition);
      if (bucket) bucket.notes += 1;
    }

    const sessions = input.targetCourseSessions.filter((session) => session.annualCourseId === targetAnnualCourseId);
    const sessionKeys = new Set(sessions.map((session) => session.key));
    const manual = [
      ...input.targetItems.filter((item) => item.annualCourseId === targetAnnualCourseId && !item.sourceTransitionId?.trim()),
      ...(input.targetNotes ?? []).filter(
        (note) => note.annualCourseId === targetAnnualCourseId && !note.sourceNoteId?.trim() && !note.inheritedAt?.trim(),
      ),
    ];
    summary.manualContent.kept = manual.length;
    summary.manualContent.onVanishedSession = manual.filter((entry) => {
      const key = entry.courseSessionKey?.trim() ?? "";
      return key !== "" && !sessionKeys.has(key);
    }).length;

    const usedSlotIds = new Set(sessions.flatMap((session) => session.segments.map((segment) => segment.scheduleSlotId)));
    summary.unusedSlots = scope.targetSlots
      .filter((slot) => slot.annualCourseId === targetAnnualCourseId && !usedSlotIds.has(slot.id))
      .map((slot) => ({
        slotId: slot.id,
        dayOfWeek: slot.dayOfWeek,
        weekKind: slot.weekKind,
        periodStart: slot.periodStart,
        periodEnd: slot.periodEnd,
      }))
      .sort((left, right) => left.dayOfWeek - right.dayOfWeek || left.periodStart - right.periodStart);
    return summary;
  });
}

function countLabel(counts: YearTransitionReimportCounts): string {
  const publications = `${counts.publications} publication${counts.publications > 1 ? "s" : ""}`;
  const notes = `${counts.notes} note${counts.notes > 1 ? "s" : ""}`;
  return `${publications} · ${notes}`;
}

function slotLabel(slot: YearTransitionReimportUnusedSlot): string {
  const rhythm = slot.weekKind === "all" ? "chaque semaine" : `semaine ${slot.weekKind}`;
  const periods = slot.periodStart === slot.periodEnd ? `P${slot.periodStart}` : `P${slot.periodStart}-P${slot.periodEnd}`;
  return `${COURSE_WEEKDAY_LABELS[slot.dayOfWeek]} ${periods}, ${rhythm}`;
}

/** Lignes affichées avant « Réimporter ce cours ». Aucun code technique. */
export function yearTransitionReimportSummaryLines(summary: YearTransitionReimportCourseSummary): {
  counts: Array<{ label: string; value: string; tone: "ok" | "warn" | "lost" | "neutral" }>;
  warnings: string[];
} {
  const total = (counts: YearTransitionReimportCounts) => counts.publications + counts.notes;
  const counts: Array<{ label: string; value: string; tone: "ok" | "warn" | "lost" | "neutral" }> = [
    { label: "Contenu hérité remplacé", value: countLabel(summary.replaced), tone: "neutral" },
    { label: "Positionné automatiquement", value: countLabel(summary.positioned), tone: "ok" },
    {
      label: "À reclasser",
      value: countLabel(summary.toReclassify),
      tone: total(summary.toReclassify) > 0 ? "warn" : "ok",
    },
    { label: "Perdu", value: countLabel(summary.lost), tone: total(summary.lost) > 0 ? "lost" : "ok" },
  ];
  if (total(summary.blocking) > 0) {
    counts.push({ label: "Bloquant", value: countLabel(summary.blocking), tone: "lost" });
  }
  const warnings: string[] = [];
  if (summary.adminPlacementsRecalculated > 0) {
    const plural = summary.adminPlacementsRecalculated > 1;
    warnings.push(
      `${summary.adminPlacementsRecalculated} élément${plural ? "s" : ""} placé${plural ? "s" : ""} à la main par l’administration ${plural ? "seront recalculés" : "sera recalculé"}.`,
    );
  }
  if (summary.manualContent.kept > 0) {
    const plural = summary.manualContent.kept > 1;
    warnings.push(
      `${summary.manualContent.kept} élément${plural ? "s" : ""} ajouté${plural ? "s" : ""} à la main ${plural ? "sont conservés" : "est conservé"} tel${plural ? "s" : ""} quel${plural ? "s" : ""}.`,
    );
  }
  if (summary.manualContent.onVanishedSession > 0) {
    const plural = summary.manualContent.onVanishedSession > 1;
    warnings.push(
      `${summary.manualContent.onVanishedSession} élément${plural ? "s" : ""} ajouté${plural ? "s" : ""} à la main ${plural ? "restent" : "reste"} sur une séance qui n’existe plus dans le nouveau plan.`,
    );
  }
  for (const slot of summary.unusedSlots) {
    warnings.push(`Créneau ${slotLabel(slot)} sans séance dans le nouveau plan : il n’est pas déplacé.`);
  }
  return { counts, warnings };
}
