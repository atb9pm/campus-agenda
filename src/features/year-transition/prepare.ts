import type { AnnualCourseStore } from "../../lib/persistence/annual-course-types.ts";
import type { SchoolCatalogStore } from "../../lib/persistence/school-catalog-types.ts";
import type { SchoolYearStore } from "../../lib/persistence/school-year-types.ts";
import type { AgendaStore } from "../../lib/persistence/types.ts";
import { sortSchoolYearsChronologically } from "../school-year/admin-working-year.ts";
import {
  assembleLiveYearTransitionPreviewInput,
  YEAR_TRANSITION_REIMPORT_NOT_IMPORTED,
  YEAR_TRANSITION_REIMPORT_REQUIRES_PLAN,
} from "./assemble.ts";
import { applyPersistedYearTransition, type ApplyPersistedYearTransitionDeps } from "./apply.ts";
import { createPersistedYearTransitionPreview } from "./persist.ts";
import {
  bindPrivateNotesOwner,
  parseYearTransitionClassMappings,
  presentApplyOutcome,
  presentSchoolYearOption,
  presentTransitionClass,
  presentTransitionCourse,
  presentYearTransitionPreview,
  previewHasBlockingEntries,
  YEAR_TRANSITION_TRANSFER_CAPABILITIES,
  type YearTransitionCatalogLookups,
  type YearTransitionCourseOption,
  type YearTransitionPresentedPreview,
} from "./presentation.ts";
import { loadContinuationResolution, materializeSelectedContinuations } from "./materialize-continuations.ts";
import {
  parseTargetMeetingDayPlans,
  usesExplicitTargetMeetingDayPlans,
  type YearTransitionTargetMeetingDayPlan,
} from "./target-meeting-days.ts";
import type {
  YearTransitionClassMapping,
  YearTransitionPreviewResult,
  YearTransitionReimportScope,
} from "./types.ts";
import type { PersistedYearTransitionPreview } from "./store.ts";
import { privateNoteCopyId } from "./private-notes.ts";
import {
  summarizeYearTransitionReimport,
  type YearTransitionReimportCourseSummary,
} from "./reimport-summary.ts";

import {
  buildYearTransitionCourseImportStates,
  importedSourceCourseIds,
  sameMeetingDayPlan,
  type AppliedTransitionRecord,
  type AppliedTransitionSnapshot,
  type SourceNoteMaterial,
  type YearTransitionCourseImportState,
} from "./course-import-state.ts";

export interface YearTransitionPrepareDeps extends ApplyPersistedYearTransitionDeps {
  catalog: SchoolCatalogStore;
}

export async function loadYearTransitionCatalogLookups(
  deps: {
    years: SchoolYearStore;
    catalog: SchoolCatalogStore;
    courses: AnnualCourseStore;
    agenda: AgendaStore;
  },
): Promise<YearTransitionCatalogLookups> {
  const [years, classes, professions, contexts, branches, courses, items] = await Promise.all([
    deps.years.listSchoolYears(),
    deps.catalog.listClasses(),
    deps.catalog.listProfessions(),
    deps.catalog.listContexts(),
    deps.catalog.listBranches(),
    deps.courses.listCourses(),
    deps.agenda.exportAllItems(),
  ]);
  return { years, classes, professions, contexts, branches, courses, items };
}

export async function loadYearTransitionPrepareState(
  deps: YearTransitionPrepareDeps,
  sessionTeacherId: string,
) {
  const lookups = await loadYearTransitionCatalogLookups(deps);
  const years = sortSchoolYearsChronologically(lookups.years).map(presentSchoolYearOption);
  const classesByYearId: Record<string, ReturnType<typeof presentTransitionClass>[]> = {};
  const coursesByClassId: Record<string, YearTransitionCourseOption[]> = {};
  for (const year of lookups.years) {
    classesByYearId[year.id] = lookups.classes
      .filter((entry) => entry.schoolYearId === year.id && !entry.isArchived)
      .map((entry) => presentTransitionClass(entry, lookups.professions))
      .sort((left, right) => left.displayName.localeCompare(right.displayName, "fr"));
  }
  for (const course of lookups.courses) {
    if (course.isArchived) continue;
    const presented = presentTransitionCourse(course, lookups);
    const list = coursesByClassId[course.classId] ?? [];
    list.push(presented);
    coursesByClassId[course.classId] = list;
  }
  for (const list of Object.values(coursesByClassId)) {
    list.sort((left, right) => left.label.localeCompare(right.label, "fr"));
  }
  const courseImports = await loadYearTransitionCourseImports(deps, lookups);
  return {
    years,
    classesByYearId,
    coursesByClassId,
    courseImports,
    capabilities: YEAR_TRANSITION_TRANSFER_CAPABILITIES,
    sessionTeacherId,
  };
}

type LoadedAppliedTransition = AppliedTransitionRecord & { preview: PersistedYearTransitionPreview };

async function loadAppliedTransitions(
  deps: Pick<YearTransitionPrepareDeps, "applyStore" | "previews">,
  pair?: { sourceSchoolYearId: string; targetSchoolYearId: string },
): Promise<LoadedAppliedTransition[]> {
  const records: LoadedAppliedTransition[] = [];
  for (const apply of await deps.applyStore.listApplies()) {
    const preview = await deps.previews.getById(apply.transitionId);
    if (!preview) continue;
    if (pair && (preview.sourceSchoolYearId !== pair.sourceSchoolYearId || preview.targetSchoolYearId !== pair.targetSchoolYearId)) {
      continue;
    }
    try {
      const snapshot = JSON.parse(preview.snapshotJson) as AppliedTransitionSnapshot;
      records.push({ transitionId: apply.transitionId, appliedAt: apply.appliedAt, snapshot, preview });
    } catch {
      continue;
    }
  }
  return records;
}

/**
 * Éléments hérités qu’un transfert avait laissés « À reclasser » et que l’administration
 * a positionnés depuis. Publications : registre CREATED_UNPLACED. Notes : aperçu appliqué.
 */
export async function loadAdminPlacedInheritedContent(
  deps: Pick<YearTransitionPrepareDeps, "applyStore">,
  scope: YearTransitionReimportScope,
  applied: readonly LoadedAppliedTransition[],
): Promise<{ itemIds: Set<number>; noteIds: Set<string> }> {
  const itemIds = new Set<number>();
  const entriesByTransition = new Map<string, Awaited<ReturnType<typeof deps.applyStore.listEntries>>>();
  for (const item of scope.replacedItems) {
    const transitionId = item.sourceTransitionId?.trim() ?? "";
    if (!transitionId || !item.courseSessionKey?.trim()) continue;
    let entries = entriesByTransition.get(transitionId);
    if (!entries) {
      entries = await deps.applyStore.listEntries(transitionId);
      entriesByTransition.set(transitionId, entries);
    }
    const entry = entries.find((row) => row.sourceAgendaItemId === item.sourceAgendaItemId);
    if (entry?.applyResult === "CREATED_UNPLACED") itemIds.add(item.id);
  }

  const noteIds = new Set<string>();
  const unplacedBySource = new Map<string, Set<string>>();
  for (const record of applied) {
    try {
      const result = JSON.parse(record.preview.previewJson) as YearTransitionPreviewResult;
      unplacedBySource.set(
        record.transitionId,
        new Set((result.privateNotes ?? []).filter((entry) => entry.disposition === "TO_RECLASSIFY").map((entry) => entry.sourceNoteId)),
      );
    } catch {
      continue;
    }
  }
  for (const note of scope.replacedNotes) {
    const sourceNoteId = note.sourceNoteId?.trim() ?? "";
    if (!sourceNoteId || !note.courseSessionKey?.trim()) continue;
    for (const [transitionId, unplaced] of unplacedBySource) {
      if (privateNoteCopyId(transitionId, sourceNoteId) === note.id && unplaced.has(sourceNoteId)) {
        noteIds.add(note.id);
        break;
      }
    }
  }
  return { itemIds, noteIds };
}

/** Cours déjà importés vers une année en préparation, d’après le registre des transferts appliqués. */
export async function loadYearTransitionCourseImports(
  deps: Pick<YearTransitionPrepareDeps, "applyStore" | "previews" | "schedules" | "agenda" | "notes">,
  lookups: Pick<YearTransitionCatalogLookups, "years" | "classes" | "courses">,
): Promise<YearTransitionCourseImportState[]> {
  const draftYearIds = new Set(lookups.years.filter((year) => year.status === "draft").map((year) => year.id));
  const byPair = new Map<string, { sourceSchoolYearId: string; targetSchoolYearId: string; applied: AppliedTransitionRecord[] }>();
  for (const record of await loadAppliedTransitions(deps)) {
    if (!draftYearIds.has(record.preview.targetSchoolYearId)) continue;
    const key = `${record.preview.sourceSchoolYearId}|${record.preview.targetSchoolYearId}`;
    const pair = byPair.get(key) ?? {
      sourceSchoolYearId: record.preview.sourceSchoolYearId,
      targetSchoolYearId: record.preview.targetSchoolYearId,
      applied: [],
    };
    pair.applied.push(record);
    byPair.set(key, pair);
  }
  if (byPair.size === 0) return [];
  const meetingDays = await deps.schedules.listMeetingDays();
  const items = await deps.agenda.exportAllItems();
  const notes: SourceNoteMaterial[] = [];
  if (deps.notes) {
    const importedIds = new Set(
      [...byPair.values()].flatMap((pair) => pair.applied.flatMap((record) => importedSourceCourseIds(record.snapshot))),
    );
    for (const sourceCourseId of [...importedIds].sort()) {
      notes.push(...(await deps.notes.listNotesByAnnualCourse(sourceCourseId)));
    }
  }
  return [...byPair.values()].flatMap((pair) =>
    buildYearTransitionCourseImportStates({
      ...pair,
      classes: lookups.classes,
      courses: lookups.courses,
      meetingDays,
      sourceContent: { items, notes },
    }),
  );
}

export function parseSelectedSourceClassIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    throw new Error("Sélection de classes invalide.");
  }
  const ids: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string" || !entry.trim()) {
      throw new Error("Sélection de classes invalide.");
    }
    ids.push(entry.trim());
  }
  return [...new Set(ids)];
}

export function parseYearTransitionPreviewRequest(
  body: unknown,
  sessionTeacherId: string,
): {
  sourceSchoolYearId: string;
  targetSchoolYearId: string;
  classMappings: YearTransitionClassMapping[];
  selectedSourceClassIds: string[];
  resolveContinuations: boolean;
  includePrivateNotes: boolean;
  privateNotesOwnerTeacherId?: string;
  targetMeetingDayPlans?: YearTransitionTargetMeetingDayPlan[];
  selectedSourceAnnualCourseIds?: string[];
  reimportSourceAnnualCourseIds?: string[];
  refreshSourceAnnualCourseIds?: string[];
} {
  if (!body || typeof body !== "object") throw new Error("Requête invalide.");
  const record = body as Record<string, unknown>;
  const sourceSchoolYearId = typeof record.sourceSchoolYearId === "string" ? record.sourceSchoolYearId.trim() : "";
  const targetSchoolYearId = typeof record.targetSchoolYearId === "string" ? record.targetSchoolYearId.trim() : "";
  if (!sourceSchoolYearId || !targetSchoolYearId) throw new Error("Années source et cible obligatoires.");
  if (sourceSchoolYearId === targetSchoolYearId) throw new Error("Les années doivent être différentes.");
  if (record.includePrivateNotes !== undefined && typeof record.includePrivateNotes !== "boolean") {
    throw new Error("includePrivateNotes doit être un booléen.");
  }
  const targetMeetingDayPlans = parseTargetMeetingDayPlans(record.targetMeetingDayPlans);
  const newFlow = usesExplicitTargetMeetingDayPlans(targetMeetingDayPlans);
  const notes = newFlow
    ? { includePrivateNotes: true as const }
    : bindPrivateNotesOwner({
        sessionTeacherId,
        includePrivateNotes: record.includePrivateNotes === true,
        requestedOwnerTeacherId: record.privateNotesOwnerTeacherId,
      });
  const resolveContinuations = record.selectedSourceClassIds !== undefined;
  const selectedSourceClassIds = resolveContinuations
    ? parseSelectedSourceClassIds(record.selectedSourceClassIds)
    : [];
  const classMappings = resolveContinuations
    ? []
    : parseYearTransitionClassMappings(record.classMappings);
  if (!resolveContinuations) {
    for (const mapping of classMappings) {
      if (mapping.sourceClassId && mapping.targetClassId) selectedSourceClassIds.push(mapping.sourceClassId);
    }
  }
  const selectedSourceAnnualCourseIds = record.selectedSourceAnnualCourseIds === undefined
    ? undefined
    : parseSelectedSourceClassIds(record.selectedSourceAnnualCourseIds);
  const reimportSourceAnnualCourseIds = record.reimportSourceAnnualCourseIds === undefined
    ? undefined
    : parseSelectedSourceClassIds(record.reimportSourceAnnualCourseIds);
  const refreshSourceAnnualCourseIds = record.refreshSourceAnnualCourseIds === undefined
    ? undefined
    : parseSelectedSourceClassIds(record.refreshSourceAnnualCourseIds);
  if ((reimportSourceAnnualCourseIds?.length || refreshSourceAnnualCourseIds?.length) && !newFlow) {
    throw new Error(YEAR_TRANSITION_REIMPORT_REQUIRES_PLAN);
  }
  return {
    sourceSchoolYearId,
    targetSchoolYearId,
    classMappings,
    selectedSourceClassIds: [...new Set(selectedSourceClassIds)],
    resolveContinuations,
    targetMeetingDayPlans,
    ...(selectedSourceAnnualCourseIds !== undefined ? { selectedSourceAnnualCourseIds } : {}),
    ...(reimportSourceAnnualCourseIds?.length ? { reimportSourceAnnualCourseIds } : {}),
    ...(refreshSourceAnnualCourseIds?.length ? { refreshSourceAnnualCourseIds } : {}),
    ...notes,
  };
}

/**
 * Liste de réimportation validée côté serveur : uniquement des cours déjà importés
 * vers cette année. Un plan identique au plan actuel n’est pas une réimportation,
 * sauf si le cours est demandé explicitement dans `refreshSourceAnnualCourseIds`
 * (reprendre le contenu actuel de N sans changer les jours).
 */
export async function resolveRequestedReimport(
  deps: Pick<YearTransitionPrepareDeps, "applyStore" | "previews" | "schedules" | "agenda" | "notes">,
  lookups: Pick<YearTransitionCatalogLookups, "years" | "classes" | "courses">,
  request: {
    sourceSchoolYearId: string;
    targetSchoolYearId: string;
    reimportSourceAnnualCourseIds?: readonly string[];
    refreshSourceAnnualCourseIds?: readonly string[];
    targetMeetingDayPlans?: readonly YearTransitionTargetMeetingDayPlan[];
  },
): Promise<{ reimportSourceAnnualCourseIds: string[]; unchangedSourceAnnualCourseIds: string[] }> {
  const refresh = new Set(request.refreshSourceAnnualCourseIds ?? []);
  const requested = [...new Set([...(request.reimportSourceAnnualCourseIds ?? []), ...refresh])];
  if (requested.length === 0) return { reimportSourceAnnualCourseIds: [], unchangedSourceAnnualCourseIds: [] };
  const states = (await loadYearTransitionCourseImports(deps, lookups)).filter(
    (state) =>
      state.sourceSchoolYearId === request.sourceSchoolYearId && state.targetSchoolYearId === request.targetSchoolYearId,
  );
  const reimport: string[] = [];
  const unchanged: string[] = [];
  for (const sourceAnnualCourseId of requested) {
    const state = states.find((entry) => entry.sourceAnnualCourseId === sourceAnnualCourseId);
    if (!state) throw new Error(YEAR_TRANSITION_REIMPORT_NOT_IMPORTED);
    const plan = request.targetMeetingDayPlans?.find((entry) => entry.sourceAnnualCourseId === sourceAnnualCourseId);
    if (!refresh.has(sourceAnnualCourseId) && plan && sameMeetingDayPlan(plan.days, state.currentPlan)) {
      unchanged.push(sourceAnnualCourseId);
    }
    else reimport.push(sourceAnnualCourseId);
  }
  return { reimportSourceAnnualCourseIds: reimport.sort(), unchangedSourceAnnualCourseIds: unchanged.sort() };
}

export async function createAuthorizedYearTransitionPreview(
  body: unknown,
  sessionTeacherId: string,
  deps: YearTransitionPrepareDeps,
): Promise<{
  transitionId: string;
  preview: YearTransitionPresentedPreview;
  blocking: boolean;
  reimport: { courses: YearTransitionReimportCourseSummary[]; unchangedSourceAnnualCourseIds: string[] };
}> {
  const parsed = parseYearTransitionPreviewRequest(body, sessionTeacherId);
  const target = await deps.years.getSchoolYearById(parsed.targetSchoolYearId);
  if (!target) throw new Error("Année cible introuvable.");
  if (target.status !== "draft") throw new Error("L’année cible doit rester en brouillon.");
  const source = await deps.years.getSchoolYearById(parsed.sourceSchoolYearId);
  if (!source) throw new Error("Année source introuvable.");

  let classMappings = parsed.classMappings;
  let continuationIssues: string[] = [];
  let continuationBlocking = false;
  if (parsed.resolveContinuations) {
    const continuation = await loadContinuationResolution(deps, {
      selectedSourceClassIds: parsed.selectedSourceClassIds,
      sourceSchoolYearId: parsed.sourceSchoolYearId,
      targetSchoolYearId: parsed.targetSchoolYearId,
    });
    classMappings = continuation.mappings;
    continuationIssues = continuation.issues;
    continuationBlocking = continuation.blocking;
  }

  const lookupsBefore = await loadYearTransitionCatalogLookups(deps);
  const requestedReimport = await resolveRequestedReimport(deps, lookupsBefore, parsed);
  const input = await assembleLiveYearTransitionPreviewInput(
    {
      ...parsed,
      classMappings,
      selectedSourceClassIds: parsed.selectedSourceClassIds,
      selectedSourceAnnualCourseIds: parsed.selectedSourceAnnualCourseIds,
      reimportSourceAnnualCourseIds: requestedReimport.reimportSourceAnnualCourseIds,
    },
    deps,
  );
  const persisted = await createPersistedYearTransitionPreview(input, { store: deps.previews });
  const lookups = await loadYearTransitionCatalogLookups(deps);
  const preview = presentYearTransitionPreview(persisted.preview, lookups, classMappings, {
    selectedSourceClassIds: parsed.selectedSourceClassIds,
    extraIssues: continuationIssues,
  });
  let reimportCourses: YearTransitionReimportCourseSummary[] = [];
  if (input.reimport) {
    const applied = await loadAppliedTransitions(deps, parsed);
    const adminPlaced = await loadAdminPlacedInheritedContent(deps, input.reimport, applied);
    reimportCourses = summarizeYearTransitionReimport(input, persisted.preview, {
      adminPlacedItemIds: adminPlaced.itemIds,
      adminPlacedNoteIds: adminPlaced.noteIds,
    });
  }
  return {
    transitionId: persisted.id,
    preview,
    blocking: continuationBlocking || preview.blocking || previewHasBlockingEntries(persisted.preview),
    reimport: {
      courses: reimportCourses,
      unchangedSourceAnnualCourseIds: requestedReimport.unchangedSourceAnnualCourseIds,
    },
  };
}

export const YEAR_TRANSITION_REIMPORT_CONFIRMATION_REQUIRED =
  "Cet aperçu remplace le contenu hérité d’un cours déjà importé : confirmez avec « Réimporter ce cours ».";

export async function applyAuthorizedYearTransition(
  body: unknown,
  sessionTeacherId: string,
  deps: YearTransitionPrepareDeps,
) {
  if (!body || typeof body !== "object") throw new Error("Requête invalide.");
  const record = body as Record<string, unknown>;
  const transitionId = typeof record.transitionId === "string" ? record.transitionId.trim() : "";
  if (!transitionId) throw new Error("Identifiant d’aperçu obligatoire.");
  if (record.confirm !== true) throw new Error("Une confirmation explicite est requise pour appliquer le transfert.");

  const persisted = await deps.previews.getById(transitionId);
  if (!persisted) {
    return presentApplyOutcome({
      ok: false,
      code: "TRANSITION_NOT_FOUND",
      reason: "TRANSITION_NOT_FOUND",
    });
  }

  let snapshotOwner: string | undefined;
  let reimportRequested = false;
  try {
    const snapshot = JSON.parse(persisted.snapshotJson) as {
      includePrivateNotes?: boolean;
      privateNotesOwnerTeacherId?: string;
      targetMeetingDayPlans?: YearTransitionTargetMeetingDayPlan[];
      reimport?: { courses?: unknown[] };
    };
    const legacyOwnerBound =
      snapshot.includePrivateNotes === true
      && !usesExplicitTargetMeetingDayPlans(snapshot.targetMeetingDayPlans);
    snapshotOwner = legacyOwnerBound ? snapshot.privateNotesOwnerTeacherId : undefined;
    reimportRequested = Array.isArray(snapshot.reimport?.courses) && snapshot.reimport.courses.length > 0;
  } catch {
    snapshotOwner = undefined;
  }
  if (reimportRequested && record.confirmReimport !== true) {
    throw new Error(YEAR_TRANSITION_REIMPORT_CONFIRMATION_REQUIRED);
  }
  if (snapshotOwner && snapshotOwner !== sessionTeacherId) {
    throw new Error("Cet aperçu inclut des notes privées d’un autre enseignant.");
  }

  const outcome = await applyPersistedYearTransition(transitionId, deps);
  let presented: YearTransitionPresentedPreview | null = null;
  try {
    const previewJson = JSON.parse(persisted.previewJson) as YearTransitionPreviewResult;
    const snapshot = JSON.parse(persisted.snapshotJson) as {
      classMappings?: YearTransitionClassMapping[];
      selectedSourceClassIds?: string[];
    };
    const lookups = await loadYearTransitionCatalogLookups(deps);
    presented = presentYearTransitionPreview(previewJson, lookups, snapshot.classMappings ?? [], {
      selectedSourceClassIds: snapshot.selectedSourceClassIds ?? [],
    });
  } catch {
    presented = null;
  }
  return presentApplyOutcome(outcome, presented);
}
