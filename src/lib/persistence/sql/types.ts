export interface SqlStatement {
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<{ success: boolean; meta?: { last_row_id?: number; changes?: number } }>;
}

export interface SqlBatchStatement {
  sql: string;
  values: unknown[];
}

export interface SqlDatabase {
  prepare(query: string): {
    bind(...values: unknown[]): SqlStatement;
  };
  exec(query: string): Promise<void>;
  /**
   * Transaction unique SQLite (tout ou rien) :
   * BEGIN → instructions → COMMIT ; erreur → ROLLBACK.
   * Aucune modification partielle ne doit rester dans la base.
   */
  batch(statements: SqlBatchStatement[]): Promise<void>;
}

export interface AgendaItemRow {
  id: number;
  classroom_id: string;
  subject_id: string;
  author_teacher_id: string | null;
  day: number;
  hour: number;
  week_offset: number;
  school_week_number: number | null;
  type: string;
  title: string;
  detail: string;
  template_id: string | null;
  school_year_id: string | null;
  annual_course_id: string | null;
  course_session_key: string | null;
  course_session_date: string | null;
  reference_session_id: string | null;
  reference_item_id: string | null;
}

export interface StudentAccessRow {
  id: string;
  classroom_id: string;
  school_class_id?: string | null;
  label: string;
  access_code_hash?: string | null;
  access_version?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  revoked_at?: string | null;
}
