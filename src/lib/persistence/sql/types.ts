export interface SqlStatement {
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<{ success: boolean; meta?: { last_row_id?: number; changes?: number } }>;
}

export interface SqlDatabase {
  prepare(query: string): {
    bind(...values: unknown[]): SqlStatement;
  };
  exec(query: string): Promise<void>;
}

export interface AgendaItemRow {
  id: number;
  classroom_id: string;
  subject_id: string;
  author_teacher_id: string;
  day: number;
  hour: number;
  week_offset: number;
  school_week_number: number | null;
  type: string;
  title: string;
  detail: string;
  template_id: string | null;
  school_year_id: string | null;
}

export interface StudentAccessRow {
  id: string;
  classroom_id: string;
  label: string;
}
