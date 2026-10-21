import type { AnnualCourseStore } from "../../lib/persistence/annual-course-types.ts";
import type { SchoolCatalogStore } from "../../lib/persistence/school-catalog-types.ts";
import type { SchoolYearStore } from "../../lib/persistence/school-year-types.ts";
import type { AgendaStore } from "../../lib/persistence/types.ts";
import { sortSchoolYearsChronologically } from "../school-year/admin-working-year.ts";
import { assembleLiveYearTransitionPreviewInput } from "./assemble.ts";
import { applyPersistedYearTransition, type ApplyPersistedYearTransitionDeps } from "./apply.ts";
import { createPersistedYearTransitionPreview } from "./persist.ts";
import {
  bindPrivateNotesOwner,
  parseYearTransitionClassMappings,
  presentApplyOutcome,
  presentSchoolYearOption,
  presentTransitionClass,
  presentYearTransitionPreview,
  previewHasBlockingEntries,
  YEAR_TRANSITION_TRANSFER_CAPABILITIES,
  type YearTransitionCatalogLookups,
  type YearTransitionPresentedPreview,
} from "./presentation.ts";
import { loadContinuationResolution, materializeSelectedContinuations } from "./materialize-continuations.ts";
import type { YearTransitionClassMapping, YearTransitionPreviewResult } from "./types.ts";

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
  for (const year of lookups.years) {
    classesByYearId[year.id] = lookups.classes
      .filter((entry) => entry.schoolYearId === year.id && !entry.isArchived)
      .map((entry) => presentTransitionClass(entry, lookups.professions))
      .sort((left, right) => left.displayName.localeCompare(right.displayName, "fr"));
  }
  return {
    years,
    classesByYearId,
    capabilities: YEAR_TRANSITION_TRANSFER_CAPABILITIES,
    sessionTeacherId,
  };
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
  const notes = bindPrivateNotesOwner({
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
  return {
    sourceSchoolYearId,
    targetSchoolYearId,
    classMappings,
    selectedSourceClassIds: [...new Set(selectedSourceClassIds)],
    resolveContinuations,
    ...notes,
  };
}

export async function createAuthorizedYearTransitionPreview(
  body: unknown,
  sessionTeacherId: string,
  deps: YearTransitionPrepareDeps,
): Promise<{ transitionId: string; preview: YearTransitionPresentedPreview; blocking: boolean }> {
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

  const input = await assembleLiveYearTransitionPreviewInput(
    {
      ...parsed,
      classMappings,
      selectedSourceClassIds: parsed.selectedSourceClassIds,
    },
    deps,
  );
  const persisted = await createPersistedYearTransitionPreview(input, { store: deps.previews });
  const lookups = await loadYearTransitionCatalogLookups(deps);
  const preview = presentYearTransitionPreview(persisted.preview, lookups, classMappings, {
    selectedSourceClassIds: parsed.selectedSourceClassIds,
    extraIssues: continuationIssues,
  });
  return {
    transitionId: persisted.id,
    preview,
    blocking: continuationBlocking || preview.blocking || previewHasBlockingEntries(persisted.preview),
  };
}

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
  try {
    const snapshot = JSON.parse(persisted.snapshotJson) as { includePrivateNotes?: boolean; privateNotesOwnerTeacherId?: string };
    snapshotOwner = snapshot.includePrivateNotes ? snapshot.privateNotesOwnerTeacherId : undefined;
  } catch {
    snapshotOwner = undefined;
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
