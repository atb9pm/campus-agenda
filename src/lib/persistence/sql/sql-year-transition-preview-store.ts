import { parsePersistedObjectJson } from "../../../features/year-transition/persist-json.ts";
import type {
  PersistedYearTransitionPreview,
  PersistedYearTransitionPreviewEntry,
  YearTransitionPreviewListFilter,
  YearTransitionPreviewStore,
} from "../../../features/year-transition/store.ts";
import type { SqlDatabase } from "./types.ts";

interface PreviewRow {
  id: string;
  source_school_year_id: string;
  target_school_year_id: string;
  fingerprint: string;
  engine_version: number;
  app_version: string;
  snapshot_json: string;
  preview_json: string;
  created_at: string;
}

interface EntryRow {
  transition_id: string;
  source_agenda_item_id: number;
  reason: string;
  reference_item_id: string | null;
  target_annual_course_id: string | null;
  entry_json: string;
}

function mapPreview(row: PreviewRow): PersistedYearTransitionPreview {
  return {
    id: row.id,
    sourceSchoolYearId: row.source_school_year_id,
    targetSchoolYearId: row.target_school_year_id,
    fingerprint: row.fingerprint,
    engineVersion: Number(row.engine_version),
    appVersion: row.app_version,
    snapshotJson: row.snapshot_json,
    previewJson: row.preview_json,
    createdAt: row.created_at,
  };
}

function mapEntry(row: EntryRow): PersistedYearTransitionPreviewEntry {
  return {
    transitionId: row.transition_id,
    sourceAgendaItemId: Number(row.source_agenda_item_id),
    reason: row.reason,
    referenceItemId: row.reference_item_id,
    targetAnnualCourseId: row.target_annual_course_id,
    entryJson: row.entry_json,
  };
}

function assertPreviewJson(preview: PersistedYearTransitionPreview): void {
  parsePersistedObjectJson(preview.snapshotJson, "snapshot_json");
  parsePersistedObjectJson(preview.previewJson, "preview_json");
}

function assertEntryJson(entry: PersistedYearTransitionPreviewEntry): void {
  parsePersistedObjectJson(entry.entryJson, "entry_json");
}

export class SqlYearTransitionPreviewStore implements YearTransitionPreviewStore {
  private readonly db: SqlDatabase;

  constructor(db: SqlDatabase) {
    this.db = db;
  }

  async create(
    preview: PersistedYearTransitionPreview,
    entries: readonly PersistedYearTransitionPreviewEntry[],
  ): Promise<void> {
    const statements = [
      {
        sql: `INSERT INTO year_transition_previews (
          id, source_school_year_id, target_school_year_id, fingerprint, engine_version,
          app_version, snapshot_json, preview_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        values: [
          preview.id,
          preview.sourceSchoolYearId,
          preview.targetSchoolYearId,
          preview.fingerprint,
          preview.engineVersion,
          preview.appVersion,
          preview.snapshotJson,
          preview.previewJson,
          preview.createdAt,
        ],
      },
      ...entries.map((entry) => ({
        sql: `INSERT INTO year_transition_preview_entries (
          transition_id, source_agenda_item_id, reason, reference_item_id,
          target_annual_course_id, entry_json
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        values: [
          entry.transitionId,
          entry.sourceAgendaItemId,
          entry.reason,
          entry.referenceItemId,
          entry.targetAnnualCourseId,
          entry.entryJson,
        ],
      })),
    ];
    await this.db.batch(statements);
  }

  async getById(id: string): Promise<PersistedYearTransitionPreview | null> {
    const row = await this.db
      .prepare("SELECT * FROM year_transition_previews WHERE id = ? LIMIT 1")
      .bind(id)
      .first<PreviewRow>();
    if (!row) return null;
    const preview = mapPreview(row);
    assertPreviewJson(preview);
    return preview;
  }

  async list(filter?: YearTransitionPreviewListFilter): Promise<PersistedYearTransitionPreview[]> {
    let sql =
      "SELECT * FROM year_transition_previews WHERE 1 = 1";
    const values: unknown[] = [];
    if (filter?.sourceSchoolYearId) {
      sql += " AND source_school_year_id = ?";
      values.push(filter.sourceSchoolYearId);
    }
    if (filter?.targetSchoolYearId) {
      sql += " AND target_school_year_id = ?";
      values.push(filter.targetSchoolYearId);
    }
    sql += " ORDER BY created_at, id";
    const { results } = await this.db.prepare(sql).bind(...values).all<PreviewRow>();
    return (results ?? []).map(mapPreview);
  }

  async listEntries(transitionId: string): Promise<PersistedYearTransitionPreviewEntry[]> {
    const { results } = await this.db
      .prepare(
        `SELECT * FROM year_transition_preview_entries
         WHERE transition_id = ?
         ORDER BY source_agenda_item_id`,
      )
      .bind(transitionId)
      .all<EntryRow>();
    const entries = (results ?? []).map(mapEntry);
    for (const entry of entries) assertEntryJson(entry);
    return entries;
  }
}
