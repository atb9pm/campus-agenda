export const YEAR_TRANSITION_PREVIEW_REASONS = [
  "PROJECTABLE",
  "ALREADY_PRESENT",
  "TARGET_EXISTING_DIVERGED",
  "ORPHAN_NO_REFERENCE_ITEM",
  "SOURCE_SESSION_UNRESOLVED",
  "PATH_ABSENT",
  "PATH_POSITION_UNRESOLVED",
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
  ORPHAN_NO_REFERENCE_ITEM: "Sans séance annuelle ni référence pédagogique",
  SOURCE_SESSION_UNRESOLVED: "Séance annuelle source introuvable",
  PATH_ABSENT: "Aucun parcours CTX pour ce cours",
  PATH_POSITION_UNRESOLVED: "Position absente du parcours CTX",
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

export const YEAR_TRANSITION_PREVIEW_REASON_EXPLANATIONS: Record<YearTransitionPreviewReason, string> = {
  PROJECTABLE: "La publication sera copiée sur la séance réelle de l’année cible qui correspond à la même position du parcours CTX.",
  ALREADY_PRESENT: "Une copie conforme existe déjà dans l’année cible.",
  TARGET_EXISTING_DIVERGED: "Une copie existe déjà mais n’est pas à la séance attendue. Le transfert est bloqué.",
  ORPHAN_NO_REFERENCE_ITEM:
    "Cette publication n’a ni élément de parcours CTX, ni clé de séance annuelle exploitable. Elle reste dans l’année source.",
  SOURCE_SESSION_UNRESOLVED:
    "La clé de séance enregistrée ne correspond à aucune séance unique de l’horaire source recalculé. Le contenu reste dans l’année source.",
  PATH_ABSENT:
    "Ce cours n’a aucun parcours CTX. Les publications du Carnet rattachées à une séance annuelle réelle restent transférables ; cet élément exigeait une référence de parcours.",
  PATH_POSITION_UNRESOLVED:
    "Le parcours CTX existe, mais la séance de référence de cet élément n’y figure pas. Les autres éléments déjà rattachés ne sont pas bloqués.",
  ORPHAN_DEAD_REFERENCE_ITEM: "La référence indiquée n’existe plus dans le snapshot du parcours CTX.",
  SNAPSHOT_REFERENCE_CONFLICT: "La même référence apparaît plusieurs fois dans le parcours CTX. Impossible de choisir une position unique.",
  INVALID_REFERENCE_SESSION_POSITION: "La séance de référence n’a pas de position 1-based valide.",
  UNSCHEDULED_REFERENCE_SESSION:
    "La position pédagogique est connue, mais l’horaire cible n’a aucune séance réelle correspondante. Cet élément est omis ; les autres restent transférables.",
  TARGET_SESSION_AMBIGUOUS: "Plusieurs séances réelles de l’année cible correspondent à la même position du parcours CTX.",
  SOURCE_COURSE_MISSING: "La publication n’est rattachée à aucun cours annuel de l’année source.",
  CLASS_MAPPING_MISSING: "Aucune correspondance de classe n’a été fournie pour ce cours.",
  CLASS_CONTINUATION_ABSENT:
    "Cette classe n’est pas cochée pour la reprise. Son contenu reste dans l’année source.",
  CLASS_MAPPING_CONFLICT: "Plusieurs correspondances contradictoires visent la même classe cible.",
  UNSUPPORTED_CLASS_MAPPING_CARDINALITY: "Une fusion ou une séparation de classes n’est pas supportée.",
  TARGET_COURSE_MISSING:
    "Le cours annuel cible (même parcours CTX, classe correspondante) n’existe pas. Il sera créé à la confirmation si l’horaire source peut être repris.",
  TARGET_COURSE_AMBIGUOUS: "Plusieurs cours annuels cibles correspondent au même parcours CTX.",
  TARGET_COURSE_ARCHIVED: "Le cours annuel cible est archivé. Aucune copie n’est faite.",
  DUPLICATE_SOURCE_REFERENCE: "Plusieurs publications source portent la même référence pédagogique.",
  TARGET_REFERENCE_CONFLICT: "Plusieurs publications cibles portent déjà cette référence.",
};
