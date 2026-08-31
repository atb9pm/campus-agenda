import {
  createAnnualCourseNote,
  type AnnualCourseNote,
  type AnnualCourseNoteFilter,
  type AnnualCourseNoteInput,
  type ReferencePedagogicalPath,
} from "../../../features/pedagogical-path/index.ts";
import type {
  AnnualCourseNotesStore,
  PedagogicalPathStore,
} from "../pedagogical-path-types.ts";
import type { SqlDatabase } from "./types.ts";

function parsePath(raw: string): ReferencePedagogicalPath | null {
  try {
    const parsed = JSON.parse(raw) as ReferencePedagogicalPath;
    if (!parsed?.id || !parsed?.contextId || !Array.isArray(parsed.sessions)) return null;
    return parsed;
  } catch {
    return null;
  }
}

type AnnualNoteRow = {
  id: string;
  school_year_id: string;
  class_id: string;
  context_id: string;
  reference_session_id: string | null;
  author_teacher_id: string;
  text: string;
  source_note_id: string | null;
  source_school_year_id: string | null;
  inherited_at: string | null;
  annual_course_id: string | null;
  created_at: string;
  updated_at: string;
};

function mapAnnualNote(row: AnnualNoteRow): AnnualCourseNote {
  return {
    id: row.id,
    schoolYearId: row.school_year_id,
    classId: row.class_id,
    contextId: row.context_id,
    referenceSessionId: row.reference_session_id,
    authorTeacherId: row.author_teacher_id,
    text: row.text,
    sourceNoteId: row.source_note_id,
    sourceSchoolYearId: row.source_school_year_id,
    inheritedAt: row.inherited_at,
    annualCourseId: row.annual_course_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqlPedagogicalPathStore implements PedagogicalPathStore {
  private readonly db: SqlDatabase;

  constructor(db: SqlDatabase) {
    this.db = db;
  }

  async getPathByContextId(contextId: string): Promise<ReferencePedagogicalPath | null> {
    const row = await this.db
      .prepare("SELECT path_json FROM pedagogical_paths WHERE context_id = ? LIMIT 1")
      .bind(contextId)
      .first<{ path_json: string }>();
    if (!row) return null;
    return parsePath(row.path_json);
  }

  async listPaths(): Promise<ReferencePedagogicalPath[]> {
    const { results } = await this.db
      .prepare("SELECT path_json FROM pedagogical_paths ORDER BY context_id")
      .bind()
      .all<{ path_json: string }>();
    const paths: ReferencePedagogicalPath[] = [];
    for (const row of results) {
      const parsed = parsePath(row.path_json);
      if (parsed) paths.push(parsed);
    }
    return paths;
  }

  async savePath(path: ReferencePedagogicalPath): Promise<ReferencePedagogicalPath> {
    await this.db
      .prepare(
        `INSERT INTO pedagogical_paths (context_id, path_json, updated_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(context_id) DO UPDATE SET
           path_json = excluded.path_json,
           updated_at = datetime('now')`,
      )
      .bind(path.contextId, JSON.stringify(path))
      .run();
    return path;
  }

  async deletePathByContextId(contextId: string): Promise<boolean> {
    const result = await this.db
      .prepare("DELETE FROM pedagogical_paths WHERE context_id = ?")
      .bind(contextId)
      .run();
    return (result.meta?.changes ?? 0) > 0;
  }
}

export class SqlAnnualCourseNotesStore implements AnnualCourseNotesStore {
  private readonly db: SqlDatabase;

  constructor(db: SqlDatabase) {
    this.db = db;
  }

  async listNotes(filter: AnnualCourseNoteFilter): Promise<AnnualCourseNote[]> {
    if (filter.referenceSessionId !== undefined) {
      const { results } = await this.db
        .prepare(
          `SELECT * FROM annual_course_notes
           WHERE school_year_id = ? AND class_id = ? AND context_id = ?
             AND reference_session_id IS ?
           ORDER BY created_at`,
        )
        .bind(
          filter.schoolYearId,
          filter.classId,
          filter.contextId,
          filter.referenceSessionId,
        )
        .all<AnnualNoteRow>();
      return results.map(mapAnnualNote);
    }

    const { results } = await this.db
      .prepare(
        `SELECT * FROM annual_course_notes
         WHERE school_year_id = ? AND class_id = ? AND context_id = ?
         ORDER BY created_at`,
      )
      .bind(filter.schoolYearId, filter.classId, filter.contextId)
      .all<AnnualNoteRow>();
    return results.map(mapAnnualNote);
  }

  async getNote(id: string): Promise<AnnualCourseNote | null> {
    const row = await this.db
      .prepare("SELECT * FROM annual_course_notes WHERE id = ? LIMIT 1")
      .bind(id)
      .first<AnnualNoteRow>();
    return row ? mapAnnualNote(row) : null;
  }

  async createNote(id: string, input: AnnualCourseNoteInput): Promise<AnnualCourseNote> {
    const created = createAnnualCourseNote(id, input);
    if (!created.ok) throw new Error(created.reason);
    const note = created.value;
    await this.db
      .prepare(
        `INSERT INTO annual_course_notes (
           id, school_year_id, class_id, context_id, reference_session_id,
           author_teacher_id, text, source_note_id, source_school_year_id,
           inherited_at, annual_course_id, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        note.id,
        note.schoolYearId,
        note.classId,
        note.contextId,
        note.referenceSessionId,
        note.authorTeacherId,
        note.text,
        note.sourceNoteId,
        note.sourceSchoolYearId,
        note.inheritedAt,
        note.annualCourseId,
        note.createdAt,
        note.updatedAt,
      )
      .run();
    return note;
  }

  async deleteNote(id: string): Promise<boolean> {
    const result = await this.db
      .prepare("DELETE FROM annual_course_notes WHERE id = ?")
      .bind(id)
      .run();
    return (result.meta?.changes ?? 0) > 0;
  }

  async deleteInheritedNotes(filter: AnnualCourseNoteFilter): Promise<number> {
    const result = await this.db
      .prepare(
        `DELETE FROM annual_course_notes
         WHERE school_year_id = ? AND class_id = ? AND context_id = ?
           AND (source_note_id IS NOT NULL OR inherited_at IS NOT NULL)`,
      )
      .bind(filter.schoolYearId, filter.classId, filter.contextId)
      .run();
    return result.meta?.changes ?? 0;
  }

  async countByContextId(contextId: string): Promise<number> {
    const row = await this.db
      .prepare("SELECT COUNT(*) AS count FROM annual_course_notes WHERE context_id = ?")
      .bind(contextId)
      .first<{ count: number }>();
    return Number(row?.count ?? 0);
  }

  async countByClassId(classId: string): Promise<number> {
    const row = await this.db
      .prepare("SELECT COUNT(*) AS count FROM annual_course_notes WHERE class_id = ?")
      .bind(classId)
      .first<{ count: number }>();
    return Number(row?.count ?? 0);
  }

  async attachAnnualCourseId(filter: AnnualCourseNoteFilter, annualCourseId: string): Promise<number> {
    const result = await this.db
      .prepare(
        `UPDATE annual_course_notes
         SET annual_course_id = ?
         WHERE school_year_id = ? AND class_id = ? AND context_id = ?
           AND annual_course_id IS NULL`,
      )
      .bind(annualCourseId, filter.schoolYearId, filter.classId, filter.contextId)
      .run();
    return result.meta?.changes ?? 0;
  }
}
