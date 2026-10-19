export const YEAR_TRANSITION_PREVIEW_REASONS = [
  "PROJECTABLE",
  "ALREADY_PRESENT",
  "TARGET_EXISTING_DIVERGED",
  "ORPHAN_NO_REFERENCE_ITEM",
  "ORPHAN_DEAD_REFERENCE_ITEM",
  "SNAPSHOT_REFERENCE_CONFLICT",
  "INVALID_REFERENCE_SESSION_POSITION",
  "UNSCHEDULED_REFERENCE_SESSION",
  "TARGET_SESSION_AMBIGUOUS",
  "SOURCE_COURSE_MISSING",
  "CLASS_MAPPING_MISSING",
  "CLASS_CONTINUATION_ABSENT",
  "CLASS_MAPPING_CONFLICT",
  "UNSUPPORTED_CLASS_MAPPING_CARDINALITY",
  "TARGET_COURSE_MISSING",
  "TARGET_COURSE_AMBIGUOUS",
  "TARGET_COURSE_ARCHIVED",
  "DUPLICATE_SOURCE_REFERENCE",
  "TARGET_REFERENCE_CONFLICT",
] as const;

export type YearTransitionPreviewReason = (typeof YEAR_TRANSITION_PREVIEW_REASONS)[number];

export const YEAR_TRANSITION_PREVIEW_WARNINGS = ["REFERENCE_SESSION_CHANGED"] as const;

export type YearTransitionPreviewWarning = (typeof YEAR_TRANSITION_PREVIEW_WARNINGS)[number];

/** Ordre de tri stable des catégories PREVIEW (pas une priorité métier d’écrasement). */
export const YEAR_TRANSITION_PREVIEW_REASON_ORDER: Record<YearTransitionPreviewReason, number> =
  Object.fromEntries(YEAR_TRANSITION_PREVIEW_REASONS.map((reason, index) => [reason, index])) as Record<
    YearTransitionPreviewReason,
    number
  >;

export const YEAR_TRANSITION_PREVIEW_REASON_LABELS: Record<YearTransitionPreviewReason, string> = {
  PROJECTABLE: "Projection automatique possible",
  ALREADY_PRESENT: "Déjà présent en cible et structurellement conforme",
  TARGET_EXISTING_DIVERGED: "Déjà présent en cible mais non conforme à la projection",
  ORPHAN_NO_REFERENCE_ITEM: "Sans référence pédagogique",
  ORPHAN_DEAD_REFERENCE_ITEM: "Référence pédagogique absente du snapshot",
  SNAPSHOT_REFERENCE_CONFLICT: "La même référence apparaît plusieurs fois dans le snapshot",
  INVALID_REFERENCE_SESSION_POSITION: "Position de séance de référence invalide",
  UNSCHEDULED_REFERENCE_SESSION: "Aucune séance réelle N+1 pour cette position",
  TARGET_SESSION_AMBIGUOUS: "Plusieurs séances réelles N+1 pour la même position",
  SOURCE_COURSE_MISSING: "Cours annuel source introuvable",
  CLASS_MAPPING_MISSING: "Aucun mapping de classe explicite",
  CLASS_CONTINUATION_ABSENT: "Classe sans continuation explicite",
  CLASS_MAPPING_CONFLICT: "Mapping de classe contradictoire (0→1 et 1→1 sur la même cible)",
  UNSUPPORTED_CLASS_MAPPING_CARDINALITY: "Fusion ou séparation de classes non supportée",
  TARGET_COURSE_MISSING: "Cours annuel cible introuvable",
  TARGET_COURSE_AMBIGUOUS: "Plusieurs cours annuels cibles possibles",
  TARGET_COURSE_ARCHIVED: "Cours annuel cible archivé",
  DUPLICATE_SOURCE_REFERENCE: "Plusieurs publications source pour la même référence",
  TARGET_REFERENCE_CONFLICT: "Incohérence de référence déjà présente en cible",
};
