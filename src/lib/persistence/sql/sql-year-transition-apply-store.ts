import type {
  PersistedYearTransitionApply,
  PersistedYearTransitionApplyEntry,
  YearTransitionApplyPlan,
  YearTransitionApplyStore,
} from "../../../features/year-transition/apply-types.ts";
import type { SqlDatabase } from "./types.ts";

interface ApplyRow {
  transition_id: string;
  fingerprint: string;
  engine_version: number;
  app_version: string;
  applied_at: string;
}

interface EntryRow {
  transition_id: string;
  source_agenda_item_id: number;
  preview_reason: string;
  apply_result: string;
  target_annual_course_id: string | null;
  reference_item_id: string | null;
  created_at: string;
}

function mapApply(row: ApplyRow): PersistedYearTransitionApply {
  return {
    transitionId: row.transition_id,
    fingerprint: row.fingerprint,
    engineVersion: Number(row.engine_version),
    appVersion: row.app_version,
    appliedAt: row.applied_at,
  };
}

function mapEntry(row: EntryRow): PersistedYearTransitionApplyEntry {
  return {
    transitionId: row.transition_id,
    sourceAgendaItemId: Number(row.source_agenda_item_id),
    previewReason: row.preview_reason,
    applyResult: row.apply_result,
    targetAnnualCourseId: row.target_annual_course_id,
    referenceItemId: row.reference_item_id,
    createdAt: row.created_at,
  };
}

export class SqlYearTransitionApplyStore implements YearTransitionApplyStore {
  private readonly db: SqlDatabase;

  constructor(db: SqlDatabase) {
    this.db = db;
  }

  async getByTransitionId(transitionId: string): Promise<PersistedYearTransitionApply | null> {
    const row = await this.db
      .prepare("SELECT * FROM year_transition_applies WHERE transition_id = ? LIMIT 1")
      .bind(transitionId)
      .first<ApplyRow>();
    return row ? mapApply(row) : null;
  }

  async listEntries(transitionId: string): Promise<PersistedYearTransitionApplyEntry[]> {
    const { results } = await this.db
      .prepare(
        `SELECT * FROM year_transition_apply_entries
         WHERE transition_id = ?
         ORDER BY source_agenda_item_id`,
      )
      .bind(transitionId)
      .all<EntryRow>();
    return (results ?? []).map(mapEntry);
  }

  async applyAtomically(plan: YearTransitionApplyPlan): Promise<void> {
    const statements = [
      ...plan.items.map((item) => ({
        sql: `INSERT INTO agenda_items (
          classroom_id, subject_id, author_teacher_id, day, hour, week_offset, school_week_number,
          type, title, detail, template_id, school_year_id, annual_course_id, course_session_key,
          course_session_date, reference_session_id, reference_item_id, student_visible,
          source_transition_id, source_agenda_item_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        values: [
          item.classroomId,
          item.subjectId,
          item.authorTeacherId,
          item.day,
          item.hour,
          item.weekOffset,
          item.schoolWeekNumber,
          item.type,
          item.title,
          item.detail,
          item.templateId,
          item.schoolYearId,
          item.annualCourseId,
          item.courseSessionKey,
          item.courseSessionDate,
          item.referenceSessionId,
          item.referenceItemId,
          0,
          item.sourceTransitionId,
          item.sourceAgendaItemId,
        ],
      })),
      {
        sql: `INSERT INTO year_transition_applies (
          transition_id, fingerprint, engine_version, app_version, applied_at
        ) VALUES (?, ?, ?, ?, ?)`,
        values: [
          plan.apply.transitionId,
          plan.apply.fingerprint,
          plan.apply.engineVersion,
          plan.apply.appVersion,
          plan.apply.appliedAt,
        ],
      },
      ...plan.entries.map((entry) => ({
        sql: `INSERT INTO year_transition_apply_entries (
          transition_id, source_agenda_item_id, preview_reason, apply_result,
          target_annual_course_id, reference_item_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        values: [
          entry.transitionId,
          entry.sourceAgendaItemId,
          entry.previewReason,
          entry.applyResult,
          entry.targetAnnualCourseId,
          entry.referenceItemId,
          entry.createdAt,
        ],
      })),
    ];
    await this.db.batch(statements);
  }
}
