import { parsePersistedObjectJson } from "../../features/year-transition/persist-json.ts";
import type {
  PersistedYearTransitionPreview,
  PersistedYearTransitionPreviewEntry,
  YearTransitionPreviewListFilter,
  YearTransitionPreviewStore,
} from "../../features/year-transition/store.ts";

function clonePreview(preview: PersistedYearTransitionPreview): PersistedYearTransitionPreview {
  return { ...preview };
}

function cloneEntry(entry: PersistedYearTransitionPreviewEntry): PersistedYearTransitionPreviewEntry {
  return { ...entry };
}

function assertPreviewJson(preview: PersistedYearTransitionPreview): void {
  parsePersistedObjectJson(preview.snapshotJson, "snapshot_json");
  parsePersistedObjectJson(preview.previewJson, "preview_json");
}

function assertEntryJson(entry: PersistedYearTransitionPreviewEntry): void {
  parsePersistedObjectJson(entry.entryJson, "entry_json");
}

export class MemoryYearTransitionPreviewStore implements YearTransitionPreviewStore {
  private readonly previews = new Map<string, PersistedYearTransitionPreview>();
  private readonly entries = new Map<string, PersistedYearTransitionPreviewEntry[]>();

  async create(
    preview: PersistedYearTransitionPreview,
    entries: readonly PersistedYearTransitionPreviewEntry[],
  ): Promise<void> {
    if (this.previews.has(preview.id)) {
      throw new Error(`PREVIEW ${preview.id} déjà persisté.`);
    }
    const seen = new Set<number>();
    for (const entry of entries) {
      if (entry.transitionId !== preview.id) {
        throw new Error("transition_id d’entrée incohérent.");
      }
      if (seen.has(entry.sourceAgendaItemId)) {
        throw new Error("source_agenda_item_id en double pour ce PREVIEW.");
      }
      seen.add(entry.sourceAgendaItemId);
    }
    this.previews.set(preview.id, clonePreview(preview));
    this.entries.set(
      preview.id,
      [...entries]
        .map(cloneEntry)
        .sort((left, right) => left.sourceAgendaItemId - right.sourceAgendaItemId),
    );
  }

  async getById(id: string): Promise<PersistedYearTransitionPreview | null> {
    const preview = this.previews.get(id);
    if (!preview) return null;
    assertPreviewJson(preview);
    return clonePreview(preview);
  }

  async list(filter?: YearTransitionPreviewListFilter): Promise<PersistedYearTransitionPreview[]> {
    return [...this.previews.values()]
      .filter((preview) => {
        if (filter?.sourceSchoolYearId && preview.sourceSchoolYearId !== filter.sourceSchoolYearId) return false;
        if (filter?.targetSchoolYearId && preview.targetSchoolYearId !== filter.targetSchoolYearId) return false;
        return true;
      })
      .sort(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
      )
      .map(clonePreview);
  }

  async listEntries(transitionId: string): Promise<PersistedYearTransitionPreviewEntry[]> {
    const list = this.entries.get(transitionId) ?? [];
    for (const entry of list) assertEntryJson(entry);
    return list.map(cloneEntry);
  }

  exportBackupTables(): {
    year_transition_previews: Array<Record<string, unknown>>;
    year_transition_preview_entries: Array<Record<string, unknown>>;
  } {
    const previews = [...this.previews.values()]
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
      .map((preview) => ({
        id: preview.id,
        source_school_year_id: preview.sourceSchoolYearId,
        target_school_year_id: preview.targetSchoolYearId,
        fingerprint: preview.fingerprint,
        engine_version: preview.engineVersion,
        app_version: preview.appVersion,
        snapshot_json: preview.snapshotJson,
        preview_json: preview.previewJson,
        created_at: preview.createdAt,
      }));
    const entries = [...this.previews.keys()]
      .sort((left, right) => left.localeCompare(right))
      .flatMap((id) =>
        (this.entries.get(id) ?? []).map((entry) => ({
          transition_id: entry.transitionId,
          source_agenda_item_id: entry.sourceAgendaItemId,
          reason: entry.reason,
          reference_item_id: entry.referenceItemId,
          target_annual_course_id: entry.targetAnnualCourseId,
          entry_json: entry.entryJson,
        })),
      );
    return {
      year_transition_previews: previews,
      year_transition_preview_entries: entries,
    };
  }

  importBackupTables(tables: {
    year_transition_previews?: Array<Record<string, unknown>>;
    year_transition_preview_entries?: Array<Record<string, unknown>>;
  }): void {
    this.previews.clear();
    this.entries.clear();
    for (const row of tables.year_transition_previews ?? []) {
      const preview: PersistedYearTransitionPreview = {
        id: String(row.id ?? ""),
        sourceSchoolYearId: String(row.source_school_year_id ?? ""),
        targetSchoolYearId: String(row.target_school_year_id ?? ""),
        fingerprint: String(row.fingerprint ?? ""),
        engineVersion: Number(row.engine_version),
        appVersion: String(row.app_version ?? ""),
        snapshotJson: String(row.snapshot_json ?? ""),
        previewJson: String(row.preview_json ?? ""),
        createdAt: String(row.created_at ?? ""),
      };
      this.previews.set(preview.id, preview);
      this.entries.set(preview.id, []);
    }
    for (const row of tables.year_transition_preview_entries ?? []) {
      const transitionId = String(row.transition_id ?? "");
      const list = this.entries.get(transitionId) ?? [];
      list.push({
        transitionId,
        sourceAgendaItemId: Number(row.source_agenda_item_id),
        reason: String(row.reason ?? ""),
        referenceItemId:
          row.reference_item_id === undefined || row.reference_item_id === null
            ? null
            : String(row.reference_item_id),
        targetAnnualCourseId:
          row.target_annual_course_id === undefined || row.target_annual_course_id === null
            ? null
            : String(row.target_annual_course_id),
        entryJson: String(row.entry_json ?? ""),
      });
      this.entries.set(transitionId, list);
    }
    for (const [id, list] of this.entries) {
      list.sort((left, right) => left.sourceAgendaItemId - right.sourceAgendaItemId);
      this.entries.set(id, list);
    }
  }
}

let memoryYearTransitionPreviewStore: MemoryYearTransitionPreviewStore | null = null;

export function getMemoryYearTransitionPreviewStore(): MemoryYearTransitionPreviewStore {
  memoryYearTransitionPreviewStore ??= new MemoryYearTransitionPreviewStore();
  return memoryYearTransitionPreviewStore;
}

export function resetMemoryYearTransitionPreviewStore(): void {
  memoryYearTransitionPreviewStore = null;
}

export function exportMemoryYearTransitionPreviewTables(): ReturnType<
  MemoryYearTransitionPreviewStore["exportBackupTables"]
> {
  return getMemoryYearTransitionPreviewStore().exportBackupTables();
}

export function replaceMemoryYearTransitionPreviewTables(tables: {
  year_transition_previews?: Array<Record<string, unknown>>;
  year_transition_preview_entries?: Array<Record<string, unknown>>;
}): void {
  getMemoryYearTransitionPreviewStore().importBackupTables(tables);
}
