import type { YearTransitionPreviewReason } from "./reasons.ts";

export interface PersistedYearTransitionPreview {
  id: string;
  sourceSchoolYearId: string;
  targetSchoolYearId: string;
  fingerprint: string;
  engineVersion: number;
  appVersion: string;
  snapshotJson: string;
  previewJson: string;
  createdAt: string;
}

export interface PersistedYearTransitionPreviewEntry {
  transitionId: string;
  sourceAgendaItemId: number;
  reason: YearTransitionPreviewReason | string;
  referenceItemId: string | null;
  targetAnnualCourseId: string | null;
  entryJson: string;
}

export interface YearTransitionPreviewListFilter {
  sourceSchoolYearId?: string;
  targetSchoolYearId?: string;
}

/**
 * Store immuable : create + lecture uniquement.
 * Aucune opération update / replace / mutate / delete.
 */
export interface YearTransitionPreviewStore {
  create(
    preview: PersistedYearTransitionPreview,
    entries: readonly PersistedYearTransitionPreviewEntry[],
  ): Promise<void>;
  getById(id: string): Promise<PersistedYearTransitionPreview | null>;
  list(filter?: YearTransitionPreviewListFilter): Promise<PersistedYearTransitionPreview[]>;
  listEntries(transitionId: string): Promise<PersistedYearTransitionPreviewEntry[]>;
}
