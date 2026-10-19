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
import { NOTEBOOK_COLUMNS, mapAnnualNote, buildNotebookStatements, type AnnualNoteRow } from "./sql-pedagogical-path-store.ts";

// A single SELECT observes both halves at the same SQLite snapshot. The same expression
// is checked inside the write transaction (also works with the D1 batch adapter).
const NOTEBOOK_TOKEN_SQL = `SELECT json_object(
  'legacy', (SELECT notes_json FROM teacher_notes WHERE teacher_id = ?),
  'annual', (SELECT json_group_array(json_object(${NOTEBOOK_COLUMNS.map(c => `'${c}', ${c}`).join(", ")}))
    FROM (SELECT * FROM annual_course_notes WHERE owner_teacher_id = ? ORDER BY id))) AS token`;

export class SqlTeacherNotesStore implements TeacherNotesStore {
  private readonly db: SqlDatabase;

  constructor(db: SqlDatabase) {
    this.db = db;
  }

  async readNotebook(teacherId: string, _courseNotes: AnnualCourseNotesStore): Promise<NotebookState> {
    const row = await this.db.prepare(NOTEBOOK_TOKEN_SQL).bind(teacherId, teacherId).first<{ token: string }>();
    if (!row) throw new Error("Notebook snapshot unavailable");
    const raw = JSON.parse(row.token) as { legacy: string | null; annual: AnnualNoteRow[] };
    const parsed = parseStoredNotes(raw.legacy);
    return { token: row.token, leftover: parsed ? normalizeClassNotes(parsed) : null, owned: raw.annual.map(mapAnnualNote) };
  }

  async commitNotebook(teacherId: string, expected: NotebookState, leftover: ClassNotesDocument,
    owned: readonly AnnualCourseNote[], _courseNotes: AnnualCourseNotesStore): Promise<void> {
    const statements = buildNotebookStatements(teacherId, owned);
    // notes_json is NOT NULL: a failed CAS aborts the entire batch before any deletes.
    statements.unshift({
      sql: `INSERT INTO teacher_notes (teacher_id, notes_json, updated_at)
        VALUES (?, CASE WHEN (${NOTEBOOK_TOKEN_SQL}) = ? THEN ? ELSE NULL END, datetime('now'))
        ON CONFLICT(teacher_id) DO UPDATE SET notes_json = excluded.notes_json, updated_at = excluded.updated_at`,
      values: [teacherId, teacherId, teacherId, expected.token, serializeClassNotes(normalizeClassNotes(leftover))],
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
