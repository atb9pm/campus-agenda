import {
  normalizeClassNotes,
  parseStoredNotes,
  serializeClassNotes,
} from "../../../features/class-notebook/notes-storage.ts";
import type { ClassNotesDocument } from "../../../features/class-notebook/types.ts";
import type { TeacherNotesBackupEntry, TeacherNotesStore } from "../teacher-notes-types.ts";
import type { SqlDatabase } from "./types.ts";
import { NotebookConflictError, type NotebookState } from "../teacher-notes-types.ts";
import type { AnnualCourseNotesStore } from "../pedagogical-path-types.ts";
import type { AnnualCourseNote } from "../../../features/pedagogical-path/annual-notes.ts";
import {
  NOTEBOOK_COLUMNS,
  mapAnnualNote,
  buildCourseNotebookStatements,
  CARNET_NOTE_SQL,
  type AnnualNoteRow,
} from "./sql-pedagogical-path-store.ts";

function notebookAnnualWhere(
  teacherId: string,
  annualCourseIds: readonly string[],
): { where: string; values: unknown[] } {
  const courseFilter =
    annualCourseIds.length === 0
      ? "0"
      : `(annual_course_id IN (${annualCourseIds.map(() => "?").join(", ")}) AND ${CARNET_NOTE_SQL})`;
  return {
    where: `(${courseFilter}) OR (owner_teacher_id = ? AND annual_course_id IS NULL)`,
    values: annualCourseIds.length === 0 ? [teacherId] : [...annualCourseIds, teacherId],
  };
}

function notebookTokenQuery(teacherId: string, annualCourseIds: readonly string[]): { sql: string; values: unknown[] } {
  const annual = notebookAnnualWhere(teacherId, annualCourseIds);
  const rowExpr = NOTEBOOK_COLUMNS.map((column) => `quote(${column})`).join(" || ',' || ");
  const sql = `SELECT quote((SELECT notes_json FROM teacher_notes WHERE teacher_id = ?)) || '|' || COALESCE((
    SELECT group_concat(row_token)
    FROM (
      SELECT (${rowExpr}) AS row_token
      FROM annual_course_notes
      WHERE ${annual.where}
      ORDER BY id
    )
  ), '') AS token`;
  return {
    sql,
    values: [teacherId, ...annual.values],
  };
}

export class SqlTeacherNotesStore implements TeacherNotesStore {
  private readonly db: SqlDatabase;

  constructor(db: SqlDatabase) {
    this.db = db;
  }

  async readNotebook(
    teacherId: string,
    _courseNotes: AnnualCourseNotesStore,
    annualCourseIds: readonly string[],
  ): Promise<NotebookState> {
    const token = notebookTokenQuery(teacherId, annualCourseIds);
    const annual = notebookAnnualWhere(teacherId, annualCourseIds);
    const [tokenRow, legacyRow, annualRows] = await Promise.all([
      this.db.prepare(token.sql).bind(...token.values).first<{ token: string }>(),
      this.db
        .prepare("SELECT notes_json FROM teacher_notes WHERE teacher_id = ? LIMIT 1")
        .bind(teacherId)
        .first<{ notes_json: string }>(),
      this.db
        .prepare(`SELECT * FROM annual_course_notes WHERE ${annual.where} ORDER BY id`)
        .bind(...annual.values)
        .all<AnnualNoteRow>(),
    ]);
    if (!tokenRow) throw new Error("Notebook snapshot unavailable");
    const parsed = parseStoredNotes(legacyRow?.notes_json ?? null);
    return {
      token: tokenRow.token,
      leftover: parsed ? normalizeClassNotes(parsed) : null,
      owned: (annualRows.results ?? []).map(mapAnnualNote),
    };
  }

  async commitNotebook(
    teacherId: string,
    expected: NotebookState,
    leftover: ClassNotesDocument,
    owned: readonly AnnualCourseNote[],
    _courseNotes: AnnualCourseNotesStore,
    annualCourseIds: readonly string[],
    replaceCourseIds: readonly string[] = annualCourseIds,
  ): Promise<void> {
    const token = notebookTokenQuery(teacherId, annualCourseIds);
    const byCourse = new Map<string, AnnualCourseNote[]>();
    for (const courseId of replaceCourseIds) byCourse.set(courseId, []);
    for (const note of owned) {
      if (!note.annualCourseId) continue;
      const list = byCourse.get(note.annualCourseId);
      if (!list) continue;
      list.push(note);
    }
    const statements = [...replaceCourseIds].sort().flatMap((courseId) =>
      buildCourseNotebookStatements(courseId, byCourse.get(courseId) ?? []),
    );
    // notes_json is NOT NULL: a failed CAS aborts the entire batch before any deletes.
    statements.unshift({
      sql: `INSERT INTO teacher_notes (teacher_id, notes_json, updated_at)
        VALUES (?, CASE WHEN (${token.sql}) = ? THEN ? ELSE NULL END, datetime('now'))
        ON CONFLICT(teacher_id) DO UPDATE SET notes_json = excluded.notes_json, updated_at = excluded.updated_at`,
      values: [teacherId, ...token.values, expected.token, serializeClassNotes(normalizeClassNotes(leftover))],
    });
    try {
      await this.db.batch(statements);
    } catch (error) {
      if (String(error).includes("NOT NULL constraint failed: teacher_notes.notes_json")) throw new NotebookConflictError();
      throw error;
    }
  }

  async getNotes(teacherId: string): Promise<ClassNotesDocument | null> {
    const row = await this.db
      .prepare("SELECT notes_json FROM teacher_notes WHERE teacher_id = ? LIMIT 1")
      .bind(teacherId)
      .first<{ notes_json: string }>();
    if (!row) return null;
    const parsed = parseStoredNotes(row.notes_json);
    return parsed ? normalizeClassNotes(parsed) : null;
  }

  async saveNotes(teacherId: string, document: ClassNotesDocument): Promise<ClassNotesDocument> {
    const normalized = normalizeClassNotes(document);
    await this.db
      .prepare(
        `INSERT INTO teacher_notes (teacher_id, notes_json, updated_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(teacher_id) DO UPDATE SET
           notes_json = excluded.notes_json,
           updated_at = datetime('now')`,
      )
      .bind(teacherId, serializeClassNotes(normalized))
      .run();
    return normalized;
  }

  async exportAllNotes(): Promise<TeacherNotesBackupEntry[]> {
    const { results } = await this.db
      .prepare("SELECT teacher_id, notes_json FROM teacher_notes ORDER BY teacher_id")
      .bind()
      .all<{ teacher_id: string; notes_json: string }>();

    const entries: TeacherNotesBackupEntry[] = [];
    for (const row of results) {
      const parsed = parseStoredNotes(row.notes_json);
      if (!parsed) continue;
      entries.push({
        teacherId: row.teacher_id,
        document: normalizeClassNotes(parsed),
      });
    }
    return entries;
  }

  async replaceAllNotes(entries: TeacherNotesBackupEntry[]): Promise<void> {
    await this.db.exec("DELETE FROM teacher_notes");
    for (const entry of entries) {
      const normalized = normalizeClassNotes(entry.document);
      await this.db
        .prepare(
          `INSERT INTO teacher_notes (teacher_id, notes_json, updated_at)
           VALUES (?, ?, datetime('now'))`,
        )
        .bind(entry.teacherId, serializeClassNotes(normalized))
        .run();
    }
  }
}
