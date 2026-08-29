import {
  normalizeClassNotes,
  parseStoredNotes,
  serializeClassNotes,
} from "../../../features/class-notebook/notes-storage.ts";
import type { ClassNotesDocument } from "../../../features/class-notebook/types.ts";
import type { TeacherNotesBackupEntry, TeacherNotesStore } from "../teacher-notes-types.ts";
import type { SqlDatabase } from "./types.ts";

export class SqlTeacherNotesStore implements TeacherNotesStore {
  private readonly db: SqlDatabase;

  constructor(db: SqlDatabase) {
    this.db = db;
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
