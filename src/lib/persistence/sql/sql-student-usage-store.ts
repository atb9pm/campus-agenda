import type { StudentUsageDayCount, StudentUsageIncrement, StudentUsageStore } from "../../../features/student-usage/index.ts";
import type { SqlDatabase } from "./types.ts";

/** `INSERT … ON CONFLICT DO UPDATE` : un seul incrément atomique, même sous requêtes simultanées. */
export class SqlStudentUsageStore implements StudentUsageStore {
  private readonly db: SqlDatabase;

  constructor(db: SqlDatabase) {
    this.db = db;
  }

  async increment(input: StudentUsageIncrement): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO student_daily_visits (visit_date, school_year_id, school_class_id, visit_count)
         VALUES (?, ?, ?, 1)
         ON CONFLICT (visit_date, school_year_id, school_class_id)
         DO UPDATE SET visit_count = visit_count + 1`,
      )
      .bind(input.date, input.schoolYearId, input.schoolClassId)
      .run();
  }

  async listBetween(startDate: string, endDate: string): Promise<StudentUsageDayCount[]> {
    const { results } = await this.db
      .prepare(
        `SELECT visit_date, school_year_id, school_class_id, visit_count
         FROM student_daily_visits
         WHERE visit_date >= ? AND visit_date <= ?`,
      )
      .bind(startDate, endDate)
      .all<{ visit_date: string; school_year_id: string; school_class_id: string; visit_count: number }>();
    return (results ?? []).map((row) => ({
      date: row.visit_date,
      schoolYearId: row.school_year_id,
      schoolClassId: row.school_class_id,
      count: row.visit_count,
    }));
  }

  async purgeBefore(cutoffDate: string): Promise<number> {
    const result = await this.db
      .prepare("DELETE FROM student_daily_visits WHERE visit_date < ?")
      .bind(cutoffDate)
      .run();
    return result.meta?.changes ?? 0;
  }
}
