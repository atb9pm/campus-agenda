import type {
  PersistedYearTransitionApply,
  PersistedYearTransitionApplyEntry,
  YearTransitionApplyNoteGuard,
  YearTransitionApplyPlan,
  YearTransitionApplyStore,
} from "../../../features/year-transition/apply-types.ts";
import type { SqlDatabase } from "./types.ts";
import { NOTEBOOK_COLUMNS, bindAnnualNoteValues } from "./sql-pedagogical-path-store.ts";
import type { AnnualCourseNote } from "../../../features/pedagogical-path/annual-notes.ts";

export function transitionNoteToken(notes: readonly AnnualCourseNote[]): string {
  return JSON.stringify([...notes].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    .map(n => Object.fromEntries(NOTEBOOK_COLUMNS.map((column, i) => [column,
      column === "body_json" ? n.body ?? null : bindAnnualNoteValues(n)[i]]))));
}

function noteGuardStatement(guard: YearTransitionApplyNoteGuard, transitionId: string) {
  const courseIds = (guard.annualCourseIds ?? []).map((id) => id.trim()).filter(Boolean);
  const ownerTeacherId = guard.ownerTeacherId?.trim() ?? "";
  const notebookJson = NOTEBOOK_COLUMNS.map(
    (c) => `'${c}', ${c === "body_json" ? "json(body_json)" : c}`,
  ).join(", ");
  const where = courseIds.length > 0
    ? `annual_course_id IN (${courseIds.map(() => "?").join(", ")}) AND school_year_id IN (?, ?)`
    : ownerTeacherId
      ? "owner_teacher_id = ? AND school_year_id IN (?, ?)"
      : "0";
  const identityValues = courseIds.length > 0
    ? [...courseIds, guard.sourceSchoolYearId, guard.targetSchoolYearId]
    : ownerTeacherId
      ? [ownerTeacherId, guard.sourceSchoolYearId, guard.targetSchoolYearId]
      : [];
  const token = transitionNoteToken(guard.expected);
  return {
    // Compare in the same transaction as all copies and ledger writes.
    sql: `WITH current(token) AS (
      SELECT COALESCE(json_group_array(json_object(${notebookJson})), '[]')
      FROM (SELECT * FROM annual_course_notes WHERE ${where} ORDER BY id))
      UPDATE year_transition_previews SET fingerprint = CASE WHEN
      NOT EXISTS (SELECT fullkey, type, atom FROM json_tree((SELECT token FROM current))
        EXCEPT SELECT fullkey, type, atom FROM json_tree(?))
      AND NOT EXISTS (SELECT fullkey, type, atom FROM json_tree(?)
        EXCEPT SELECT fullkey, type, atom FROM json_tree((SELECT token FROM current)))
      THEN fingerprint ELSE NULL END WHERE id = ?`,
    values: [...identityValues, token, token, transitionId],
  };
}

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

  async listApplies(): Promise<PersistedYearTransitionApply[]> {
    const { results } = await this.db
      .prepare("SELECT * FROM year_transition_applies ORDER BY applied_at, transition_id")
      .bind()
      .all<ApplyRow>();
    return (results ?? []).map(mapApply);
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
      ...(plan.noteGuard ? [noteGuardStatement(plan.noteGuard, plan.apply.transitionId)] : []),
      ...(plan.notes ?? []).map(note => ({
        sql: `INSERT INTO annual_course_notes (${NOTEBOOK_COLUMNS.join(", ")}) VALUES (${NOTEBOOK_COLUMNS.map(() => "?").join(", ")})`,
        values: bindAnnualNoteValues(note),
      })),
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
