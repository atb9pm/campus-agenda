import { formatCourseSessionPeriods, formatSwissDate } from "../course-sessions/format.ts";
import { COURSE_WEEKDAY_LABELS } from "../course-schedule/types.ts";
import { classDisplayProfessionLabel } from "../school-catalog/class-display.ts";
import type { PedagogicalContextRecord, SchoolProfessionRecord } from "../school-catalog/profession-types.ts";
import type { SchoolBranchRecord, SchoolClassRecord } from "../school-catalog/types.ts";
import { formatSchoolYearLabelFr } from "../school-year/official-plan-logic.ts";
import type { AnnualCourse } from "../annual-courses/types.ts";
import type { PrototypeAgendaItem } from "../agenda/demo-items.ts";
import type { SchoolYearRecord } from "../school-year/types.ts";
import { YEAR_TRANSITION_APPLY_BLOCKING_REASONS, type YearTransitionApplyFailureCode, type YearTransitionApplyOutcome } from "./apply-types.ts";
import { YEAR_TRANSITION_PREVIEW_REASON_LABELS, type YearTransitionPreviewReason } from "./reasons.ts";
import { indexClassMappings } from "./class-mapping.ts";
import { resolveClassContinuations } from "./continuation-identity.ts";
import type { PrivateNotePreviewEntry } from "./private-notes.ts";
import type {
  YearTransitionClassMapping,
  YearTransitionPreviewResult,
  YearTransitionProposedPlacement,
  YearTransitionSourceTemporal,
} from "./types.ts";

export const YEAR_TRANSITION_TRANSFER_CAPABILITIES = [
  {
    id: "publications" as const,
    available: true,
    defaultEnabled: true,
    ownerBound: false,
    title: "Publications du Carnet",
    summary: "Devoirs, contrôles et informations déjà rattachés à une séance, avec leur référence pédagogique.",
  },
  {
    id: "privateNotes" as const,
    available: true,
    defaultEnabled: false,
    ownerBound: true,
    title: "Notes privées du Carnet",
    summary:
      "Uniquement vos notes privées. Un administrateur ne peut ni les lire ni les copier pour un autre enseignant. Le contenu n’apparaît pas dans l’aperçu.",
  },
] as const;

export const YEAR_TRANSITION_NOTE_REASON_LABELS: Record<PrivateNotePreviewEntry["reason"], string> = {
  PROJECTABLE: "Transférable",
  ALREADY_PRESENT: "Déjà présente en cible",
  NO_CONTINUATION: "Classe sans continuation",
  NO_REFERENCE: "Sans référence pédagogique",
  MAPPING_UNRESOLVED: "Correspondance de classe incomplète ou contradictoire",
  TARGET_COURSE_UNRESOLVED: "Cours cible introuvable ou ambigu",
  REFERENCE_UNRESOLVED: "Référence pédagogique absente ou ambiguë",
  TARGET_SESSION_UNRESOLVED: "Aucune séance unique en cible pour cette position",
  TARGET_NOTE_DIVERGED: "Une copie existe déjà mais ne correspond pas à la projection",
};

export const YEAR_TRANSITION_NOTE_REASON_EXPLANATIONS: Record<PrivateNotePreviewEntry["reason"], string> = {
  PROJECTABLE: "Une référence pédagogique unique permet de placer cette note sur une séance réelle de l’année cible.",
  ALREADY_PRESENT: "Une copie indépendante existe déjà pour ce propriétaire, cette année et cette note source.",
  NO_CONTINUATION: "La classe source n’a pas de continuation. La note reste dans l’année source.",
  NO_REFERENCE:
    "Une note privée n’est copiée que si une référence pédagogique unique permet de la placer dans le parcours CTX. La semaine ou la date de l’année source ne sont jamais recopiées.",
  MAPPING_UNRESOLVED: "La correspondance de classes ne permet pas de choisir une classe cible unique.",
  TARGET_COURSE_UNRESOLVED: "Le cours annuel cible (même parcours CTX, classe correspondante) n’est pas unique.",
  REFERENCE_UNRESOLVED: "Plusieurs références possibles, ou une référence absente du parcours CTX.",
  TARGET_SESSION_UNRESOLVED: "Le parcours CTX indique une position, mais l’horaire cible n’a pas exactement une séance correspondante.",
  TARGET_NOTE_DIVERGED: "Une copie existe déjà à un autre emplacement. Recalculez l’aperçu après correction, ou le transfert est bloqué.",
};

export const YEAR_TRANSITION_APPLY_FAILURE_LABELS: Record<YearTransitionApplyFailureCode, string> = {
  TRANSITION_NOT_FOUND: "Aperçu introuvable.",
  PREVIEW_CORRUPTED: "Aperçu illisible. Générez-en un nouveau.",
  ENGINE_VERSION_MISMATCH: "Les règles de transfert ont changé. Recalculez l’aperçu.",
  SOURCE_YEAR_NOT_FOUND: "Année source introuvable.",
  TARGET_YEAR_NOT_DRAFT: "L’année cible n’est plus en brouillon.",
  PREVIEW_STALE: "Les données ont changé depuis l’aperçu. Recalculez-le avant d’appliquer.",
  APPLY_BLOCKED: "Des problèmes bloquants empêchent toute copie.",
  TARGET_CLASSROOM_MISSING: "Classe cible sans adaptateur agenda.",
  TARGET_CLASSROOM_AMBIGUOUS: "Plusieurs adaptateurs agenda pour la classe cible.",
  TARGET_SUBJECT_MISSING: "Branche cible sans adaptateur agenda.",
  TARGET_SUBJECT_AMBIGUOUS: "Plusieurs adaptateurs agenda pour le cours cible.",
  TARGET_SUBJECT_CLASSROOM_MISMATCH: "L’adaptateur agenda du cours cible ne correspond pas à la classe.",
  APPLY_LEDGER_DIVERGED: "Le journal de transfert est incohérent.",
  APPLY_CONCURRENT_CONFLICT: "Une autre écriture a eu lieu pendant l’application. Recalculez l’aperçu.",
};

const PUBLICATION_TYPE_LABELS: Record<string, string> = {
  HOMEWORK: "Devoir",
  TEST: "Contrôle",
  INFORMATION: "Information",
};

const BLOCKING_PUBLICATION = new Set<string>(YEAR_TRANSITION_APPLY_BLOCKING_REASONS);
const BLOCKING_NOTES = new Set<PrivateNotePreviewEntry["reason"]>(["TARGET_NOTE_DIVERGED"]);

export interface YearTransitionYearOption {
  id: string;
  label: string;
  displayLabel: string;
  status: SchoolYearRecord["status"];
  statusLabel: string;
  startsOn: string;
  endsOn: string;
}

export interface YearTransitionClassOption {
  id: string;
  schoolYearId: string;
  code: string;
  label: string;
  displayName: string;
  professionLabel: string | null;
  trainingYear: number | null;
  parallelCode: string | null;
}

export interface YearTransitionCatalogLookups {
  years: readonly SchoolYearRecord[];
  classes: readonly SchoolClassRecord[];
  professions: readonly SchoolProfessionRecord[];
  contexts: readonly PedagogicalContextRecord[];
  branches: readonly SchoolBranchRecord[];
  courses: readonly AnnualCourse[];
  items: readonly PrototypeAgendaItem[];
}

export interface YearTransitionPresentedRow {
  id: string;
  kind: "publication" | "privateNote";
  category: "projectable" | "alreadyPresent" | "excluded" | "blocking";
  title: string;
  reason: string;
  reasonLabel: string;
  explanation: string;
  sourceCourseLabel: string | null;
  targetCourseLabel: string | null;
  sourceClassId: string | null;
  sourceClassLabel: string | null;
  targetClassLabel: string | null;
  sessionLabel: string | null;
  sourceSessionLabel: string | null;
  targetDurationLabel: string | null;
  targetAnnualCourseId: string | null;
  targetClassId: string | null;
}

export interface YearTransitionPresentedPreview {
  fingerprint: string;
  sourceYear: YearTransitionYearOption | null;
  targetYear: YearTransitionYearOption | null;
  blocking: boolean;
  mappingIssues: string[];
  publications: {
    projectable: YearTransitionPresentedRow[];
    alreadyPresent: YearTransitionPresentedRow[];
    excluded: YearTransitionPresentedRow[];
    blocking: YearTransitionPresentedRow[];
  };
  notes: {
    projectable: YearTransitionPresentedRow[];
    alreadyPresent: YearTransitionPresentedRow[];
    excluded: YearTransitionPresentedRow[];
    blocking: YearTransitionPresentedRow[];
  } | null;
  targetCourses: Array<{
    annualCourseId: string;
    classId: string;
    schoolYearId: string;
    courseLabel: string;
    classLabel: string;
  }>;
  classSummaries: YearTransitionClassSummary[];
  selectedClassCount: number;
  includePrivateNotes: boolean;
}

export interface YearTransitionClassSummary {
  sourceClassId: string;
  identityLabel: string;
  status: "reuse" | "create" | "skip" | "conflict" | "incomplete";
  statusLabel: string;
  message: string | null;
  publicationCount: number;
  privateNoteCount: number;
  rows: YearTransitionPresentedRow[];
}

export function yearStatusLabel(status: SchoolYearRecord["status"]): string {
  if (status === "active") return "Active";
  if (status === "draft") return "Brouillon";
  return "Archivée";
}

export function presentSchoolYearOption(year: Pick<SchoolYearRecord, "id" | "label" | "status" | "startsOn" | "endsOn">): YearTransitionYearOption {
  return {
    id: year.id,
    label: year.label,
    displayLabel: formatSchoolYearLabelFr(year.label),
    status: year.status,
    statusLabel: yearStatusLabel(year.status),
    startsOn: year.startsOn,
    endsOn: year.endsOn,
  };
}

export function presentTransitionClass(
  schoolClass: SchoolClassRecord,
  professions: readonly SchoolProfessionRecord[],
): YearTransitionClassOption {
  const profession = schoolClass.professionId
    ? professions.find((entry) => entry.id === schoolClass.professionId) ?? null
    : null;
  const professionLabel = classDisplayProfessionLabel(schoolClass, profession);
  const parts = [schoolClass.code.trim(), schoolClass.label.trim() === schoolClass.code.trim() ? "" : schoolClass.label.trim()]
    .filter(Boolean);
  if (professionLabel && !parts.includes(professionLabel)) parts.push(professionLabel);
  if (schoolClass.trainingYear != null) parts.push(`année ${schoolClass.trainingYear}`);
  if (schoolClass.parallelCode) parts.push(`groupe ${schoolClass.parallelCode}`);
  return {
    id: schoolClass.id,
    schoolYearId: schoolClass.schoolYearId ?? "",
    code: schoolClass.code,
    label: schoolClass.label,
    displayName: parts.join(" · ") || schoolClass.id,
    professionLabel,
    trainingYear: schoolClass.trainingYear,
    parallelCode: schoolClass.parallelCode,
  };
}

export function parseYearTransitionClassMappings(raw: unknown): YearTransitionClassMapping[] {
  if (!Array.isArray(raw)) {
    throw new Error("Correspondances de classes invalides.");
  }
  return raw.map((entry) => {
    if (!entry || typeof entry !== "object") {
      throw new Error("Correspondances de classes invalides.");
    }
    const record = entry as Record<string, unknown>;
    const source = record.sourceClassId;
    const target = record.targetClassId;
    if (source !== null && typeof source !== "string") {
      throw new Error("Correspondances de classes invalides.");
    }
    if (target !== null && typeof target !== "string") {
      throw new Error("Correspondances de classes invalides.");
    }
    return {
      sourceClassId: source && source.trim() ? source.trim() : null,
      targetClassId: target && target.trim() ? target.trim() : null,
    };
  });
}

export function bindPrivateNotesOwner(options: {
  sessionTeacherId: string;
  includePrivateNotes: boolean;
  requestedOwnerTeacherId?: unknown;
}): { includePrivateNotes: boolean; privateNotesOwnerTeacherId?: string } {
  if (options.requestedOwnerTeacherId !== undefined && options.requestedOwnerTeacherId !== null) {
    throw new Error("Le propriétaire des notes privées est fixé par la session connectée.");
  }
  if (!options.includePrivateNotes) return { includePrivateNotes: false };
  const owner = options.sessionTeacherId.trim();
  if (!owner) throw new Error("Session enseignant requise pour copier des notes privées.");
  return { includePrivateNotes: true, privateNotesOwnerTeacherId: owner };
}

export function mappingIssueMessages(
  mappings: readonly YearTransitionClassMapping[],
  sourceClassIds: readonly string[],
  className: (id: string) => string,
  options?: { requireAllSources?: boolean },
): string[] {
  const index = indexClassMappings(mappings);
  const issues: string[] = [];
  if (options?.requireAllSources !== false) {
    for (const sourceId of sourceClassIds) {
      if (!index.sourcesToTargets.has(sourceId)) {
        issues.push(`Correspondance manquante pour ${className(sourceId)}.`);
      }
    }
  }
  for (const conflict of index.summary.conflicts) {
    issues.push(
      `Correspondance contradictoire vers ${className(conflict.targetClassId)} (classes ${conflict.sourceClassIds.map(className).join(", ")}).`,
    );
  }
  for (const unsupported of index.summary.unsupported) {
    issues.push(
      `Fusion ou séparation non prise en charge : ${unsupported.sourceClassIds.map(className).join(", ")} → ${unsupported.targetClassIds.map(className).join(", ")}.`,
    );
  }
  return issues;
}

function publicationCategory(reason: YearTransitionPreviewReason): YearTransitionPresentedRow["category"] {
  if (reason === "PROJECTABLE") return "projectable";
  if (reason === "ALREADY_PRESENT") return "alreadyPresent";
  if (BLOCKING_PUBLICATION.has(reason)) return "blocking";
  return "excluded";
}

function noteCategory(reason: PrivateNotePreviewEntry["reason"]): YearTransitionPresentedRow["category"] {
  if (reason === "PROJECTABLE") return "projectable";
  if (reason === "ALREADY_PRESENT") return "alreadyPresent";
  if (BLOCKING_NOTES.has(reason)) return "blocking";
  return "excluded";
}

function classLabel(lookups: YearTransitionCatalogLookups, classId: string | null): string | null {
  if (!classId) return null;
  const found = lookups.classes.find((entry) => entry.id === classId);
  return found ? presentTransitionClass(found, lookups.professions).displayName : classId;
}

function courseLabel(lookups: YearTransitionCatalogLookups, courseId: string | null): string | null {
  if (!courseId) return null;
  const course = lookups.courses.find((entry) => entry.id === courseId);
  if (!course) return courseId;
  const context = lookups.contexts.find((entry) => entry.id === course.contextId);
  const branch = context ? lookups.branches.find((entry) => entry.id === context.branchId) : null;
  const classroom = classLabel(lookups, course.classId);
  const branchLabel = branch?.label.trim() || "Cours";
  return classroom ? `${branchLabel} · ${classroom}` : branchLabel;
}

function formatNoteSessionLabel(courseSessionKey: string | null): string | null {
  if (!courseSessionKey) return null;
  const parts = courseSessionKey.split("|");
  const date = parts[2] ?? "";
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? `Séance du ${formatSwissDate(date)}` : null;
}

function sessionLabel(placement: YearTransitionProposedPlacement | null, fallbackDate: string | null): string | null {
  if (placement) {
    const weekday = COURSE_WEEKDAY_LABELS[placement.day as keyof typeof COURSE_WEEKDAY_LABELS]
      ?? `jour ${placement.day}`;
    return `Séance cible n° ${placement.sequenceNumber} · ${weekday.toLocaleLowerCase("fr-CH")} ${formatSwissDate(placement.courseSessionDate)}`;
  }
  if (fallbackDate) return `Séance cible · ${formatSwissDate(fallbackDate)}`;
  return null;
}

function sourceSessionLabel(temporal: YearTransitionSourceTemporal | null | undefined): string | null {
  if (!temporal) return null;
  if (temporal.courseSessionDate) return `Séance source · ${formatSwissDate(temporal.courseSessionDate)}`;
  if (temporal.schoolWeekNumber) {
    return `Séance source · semaine ${String(temporal.schoolWeekNumber).padStart(2, "0")}`;
  }
  return null;
}

function targetDurationLabel(
  session: { segments?: ReadonlyArray<{ periodStart: number; periodEnd: number }> } | null,
): string | null {
  const periods = formatCourseSessionPeriods(session?.segments ?? []);
  return periods ? `Durée cible : ${periods}` : null;
}

function emptyGroups(): YearTransitionPresentedPreview["publications"] {
  return { projectable: [], alreadyPresent: [], excluded: [], blocking: [] };
}

const CLASS_STATUS_LABELS: Record<YearTransitionClassSummary["status"], string> = {
  reuse: "Classe cible réutilisée",
  create: "Classe à créer à la confirmation",
  skip: "Non reprise",
  conflict: "Ambiguïté — aucune fusion automatique",
  incomplete: "Identité incomplète",
};

export function presentYearTransitionPreview(
  preview: YearTransitionPreviewResult,
  lookups: YearTransitionCatalogLookups,
  classMappings: readonly YearTransitionClassMapping[] = [],
  options?: { selectedSourceClassIds?: readonly string[]; extraIssues?: readonly string[] },
): YearTransitionPresentedPreview {
  const sourceYear = lookups.years.find((year) => year.id === preview.sourceSchoolYearId);
  const targetYear = lookups.years.find((year) => year.id === preview.targetSchoolYearId);
  const selectedSourceClassIds = options?.selectedSourceClassIds ?? [];
  const requireAllSources = selectedSourceClassIds.length === 0;
  const sourceClassIds = requireAllSources
    ? lookups.classes
        .filter((entry) => entry.schoolYearId === preview.sourceSchoolYearId && !entry.isArchived)
        .map((entry) => entry.id)
    : [...selectedSourceClassIds];
  const mappingIssues = [
    ...mappingIssueMessages(
      classMappings,
      sourceClassIds,
      (id) => classLabel(lookups, id) ?? id,
      { requireAllSources },
    ),
    ...(options?.extraIssues ?? []),
  ];

  const publications = emptyGroups();
  for (const entry of preview.entries) {
    const item = lookups.items.find((candidate) => candidate.id === entry.sourceAgendaItemId);
    const category = publicationCategory(entry.reason);
    const row: YearTransitionPresentedRow = {
      id: `pub-${entry.sourceAgendaItemId}`,
      kind: "publication",
      category,
      title: item
        ? `${PUBLICATION_TYPE_LABELS[item.type] ?? item.type} — ${item.title.trim() || "Sans titre"}`
        : `Publication n° ${entry.sourceAgendaItemId}`,
      reason: entry.reason,
      reasonLabel: YEAR_TRANSITION_PREVIEW_REASON_LABELS[entry.reason] ?? entry.reason,
      explanation: YEAR_TRANSITION_PREVIEW_REASON_LABELS[entry.reason] ?? entry.reason,
      sourceCourseLabel: courseLabel(lookups, entry.sourceAnnualCourseId),
      targetCourseLabel: courseLabel(lookups, entry.targetAnnualCourseId),
      sourceClassId: entry.sourceClassId,
      sourceClassLabel: classLabel(lookups, entry.sourceClassId),
      targetClassLabel: classLabel(lookups, entry.targetClassId),
      sessionLabel: sessionLabel(entry.proposedPlacement, entry.targetCourseSession?.date ?? null),
      sourceSessionLabel: sourceSessionLabel(entry.sourceTemporal),
      targetDurationLabel: targetDurationLabel(entry.targetCourseSession),
      targetAnnualCourseId: entry.targetAnnualCourseId,
      targetClassId: entry.targetClassId,
    };
    publications[category].push(row);
  }

  let notes: YearTransitionPresentedPreview["notes"] = null;
  if (preview.privateNotes) {
    notes = emptyGroups();
    for (const entry of preview.privateNotes) {
      const category = noteCategory(entry.reason);
      const row: YearTransitionPresentedRow = {
        id: `note-${entry.sourceNoteId}`,
        kind: "privateNote",
        category,
        title: "Note privée",
        reason: entry.reason,
        reasonLabel: YEAR_TRANSITION_NOTE_REASON_LABELS[entry.reason],
        explanation: YEAR_TRANSITION_NOTE_REASON_EXPLANATIONS[entry.reason],
        sourceCourseLabel: null,
        targetCourseLabel: courseLabel(lookups, entry.targetAnnualCourseId),
        sourceClassId: null,
        sourceClassLabel: null,
        targetClassLabel: classLabel(lookups, entry.targetClassId),
        sessionLabel: formatNoteSessionLabel(entry.courseSessionKey),
        sourceSessionLabel: null,
        targetDurationLabel: null,
        targetAnnualCourseId: entry.targetAnnualCourseId,
        targetClassId: entry.targetClassId,
      };
      notes[category].push(row);
    }
  }

  const targetCourseIds = new Set<string>();
  const targetCourses: YearTransitionPresentedPreview["targetCourses"] = [];
  const consider = [...publications.projectable, ...publications.alreadyPresent, ...(notes?.projectable ?? []), ...(notes?.alreadyPresent ?? [])];
  for (const row of consider) {
    if (!row.targetAnnualCourseId || !row.targetClassId || targetCourseIds.has(row.targetAnnualCourseId)) continue;
    targetCourseIds.add(row.targetAnnualCourseId);
    targetCourses.push({
      annualCourseId: row.targetAnnualCourseId,
      classId: row.targetClassId,
      schoolYearId: preview.targetSchoolYearId,
      courseLabel: row.targetCourseLabel ?? row.targetAnnualCourseId,
      classLabel: row.targetClassLabel ?? row.targetClassId,
    });
  }

  const continuation = resolveClassContinuations({
    selectedSourceClassIds,
    sourceClasses: lookups.classes,
    targetClasses: lookups.classes,
    sourceSchoolYearId: preview.sourceSchoolYearId,
    targetSchoolYearId: preview.targetSchoolYearId,
  });
  const allRows = [
    ...publications.projectable,
    ...publications.alreadyPresent,
    ...publications.excluded,
    ...publications.blocking,
    ...(notes?.projectable ?? []),
    ...(notes?.alreadyPresent ?? []),
    ...(notes?.excluded ?? []),
    ...(notes?.blocking ?? []),
  ];
  const classSummaries: YearTransitionClassSummary[] = continuation.planned
    .filter((row) => row.action !== "skip")
    .map((row) => {
      const source = lookups.classes.find((entry) => entry.id === row.sourceClassId);
      const presentedClass = source ? presentTransitionClass(source, lookups.professions) : null;
      const identityLabel = presentedClass
        ? [presentedClass.professionLabel, presentedClass.trainingYear != null ? `année ${presentedClass.trainingYear}` : null, presentedClass.parallelCode]
            .filter(Boolean)
            .join(" — ") || presentedClass.displayName
        : row.sourceClassId;
      const rows = allRows.filter((entry) => entry.sourceClassId === row.sourceClassId || entry.targetClassId === row.targetClassId);
      return {
        sourceClassId: row.sourceClassId,
        identityLabel,
        status: row.action,
        statusLabel: CLASS_STATUS_LABELS[row.action],
        message: row.message,
        publicationCount: rows.filter((entry) => entry.kind === "publication").length,
        privateNoteCount: rows.filter((entry) => entry.kind === "privateNote").length,
        rows,
      };
    });

  const blocking =
    publications.blocking.length > 0 ||
    Boolean(notes?.blocking.length) ||
    continuation.blocking ||
    mappingIssues.length > 0;
  return {
    fingerprint: preview.fingerprint,
    sourceYear: sourceYear ? presentSchoolYearOption(sourceYear) : null,
    targetYear: targetYear ? presentSchoolYearOption(targetYear) : null,
    blocking,
    mappingIssues,
    publications,
    notes,
    targetCourses,
    classSummaries,
    selectedClassCount: selectedSourceClassIds.length,
    includePrivateNotes: Boolean(preview.privateNotes),
  };
}

export function presentApplyOutcome(
  outcome: YearTransitionApplyOutcome,
  presented?: YearTransitionPresentedPreview | null,
): {
  ok: boolean;
  code: string;
  codeLabel: string;
  reason?: string;
  createdCount?: number;
  alreadyPresentCount?: number;
  skippedCount?: number;
  notes?: { createdCount: number; alreadyPresentCount: number; skippedCount: number };
  targetCourses: YearTransitionPresentedPreview["targetCourses"];
  classSummaries: YearTransitionClassSummary[];
  blocking?: boolean;
} {
  if (!outcome.ok) {
    return {
      ok: false,
      code: outcome.code,
      codeLabel: YEAR_TRANSITION_APPLY_FAILURE_LABELS[outcome.code] ?? outcome.code,
      reason: outcome.reason,
      targetCourses: presented?.targetCourses ?? [],
      classSummaries: presented?.classSummaries ?? [],
      blocking: outcome.code === "APPLY_BLOCKED" || outcome.code === "PREVIEW_STALE",
    };
  }
  const codeLabel = outcome.code === "ALREADY_APPLIED"
    ? "Déjà appliqué — aucune copie supplémentaire."
    : "Transfert appliqué.";
  return {
    ok: true,
    code: outcome.code,
    codeLabel,
    createdCount: outcome.createdCount,
    alreadyPresentCount: outcome.alreadyPresentCount,
    skippedCount: outcome.skippedCount,
    notes: outcome.privateNotes
      ? {
          createdCount: outcome.privateNotes.createdCount,
          alreadyPresentCount: outcome.privateNotes.alreadyPresentCount,
          skippedCount: outcome.privateNotes.skippedCount,
        }
      : undefined,
    targetCourses: presented?.targetCourses ?? [],
    classSummaries: presented?.classSummaries ?? [],
  };
}

export function previewHasBlockingEntries(preview: YearTransitionPreviewResult): boolean {
  if (preview.entries.some((entry) => BLOCKING_PUBLICATION.has(entry.reason))) return true;
  return Boolean(preview.privateNotes?.some((entry) => BLOCKING_NOTES.has(entry.reason)));
}
