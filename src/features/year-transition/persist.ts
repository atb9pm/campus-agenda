import { randomUUID } from "node:crypto";

import { APP_VERSION } from "../../lib/app-version.ts";
import {
  YEAR_TRANSITION_PREVIEW_ENGINE_VERSION,
  yearTransitionPreviewFingerprintFromSnapshotJson,
  yearTransitionPreviewMaterialSnapshotJson,
} from "./fingerprint.ts";
import { buildYearTransitionPreview } from "./preview.ts";
import type {
  PersistedYearTransitionPreview,
  PersistedYearTransitionPreviewEntry,
  YearTransitionPreviewStore,
} from "./store.ts";
import type { YearTransitionPreviewInput, YearTransitionPreviewResult } from "./types.ts";

export interface CreatePersistedYearTransitionPreviewOptions {
  store: YearTransitionPreviewStore;
  idGenerator?: () => string;
  now?: () => string;
}

export interface PersistedYearTransitionPreviewRecord extends PersistedYearTransitionPreview {
  preview: YearTransitionPreviewResult;
  entries: PersistedYearTransitionPreviewEntry[];
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Persiste un PREVIEW calculé par le moteur pur. Génère transitionId et createdAt ici.
 * Aucune écriture d’AgendaItem. Aucun APPLY.
 */
export async function createPersistedYearTransitionPreview(
  input: YearTransitionPreviewInput,
  options: CreatePersistedYearTransitionPreviewOptions,
): Promise<PersistedYearTransitionPreviewRecord> {
  const preview = buildYearTransitionPreview(input);
  const snapshotJson = yearTransitionPreviewMaterialSnapshotJson(input);
  const fingerprint = yearTransitionPreviewFingerprintFromSnapshotJson(snapshotJson);
  if (preview.fingerprint !== fingerprint) {
    throw new Error("Fingerprint PREVIEW incohérent avec le snapshot matériel.");
  }

  const transitionId = options.idGenerator?.() ?? randomUUID();
  const createdAt = options.now?.() ?? new Date().toISOString();
  const previewJson = JSON.stringify(preview);
  const record: PersistedYearTransitionPreview = {
    id: transitionId,
    sourceSchoolYearId: input.sourceSchoolYearId,
    targetSchoolYearId: input.targetSchoolYearId,
    fingerprint,
    engineVersion: YEAR_TRANSITION_PREVIEW_ENGINE_VERSION,
    appVersion: APP_VERSION,
    snapshotJson,
    previewJson,
    createdAt,
  };
  const entries: PersistedYearTransitionPreviewEntry[] = preview.entries.map((entry) => ({
    transitionId,
    sourceAgendaItemId: entry.sourceAgendaItemId,
    reason: entry.reason,
    referenceItemId: entry.referenceItemId,
    targetAnnualCourseId: entry.targetAnnualCourseId,
    entryJson: JSON.stringify(entry),
  }));

  await options.store.create(record, entries);

  return {
    ...record,
    preview: cloneJson(preview),
    entries,
  };
}
