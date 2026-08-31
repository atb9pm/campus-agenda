import type { CourseScheduleSlot } from "../../../features/course-schedule/types.ts";
import type { CourseWeekKind, CourseWeekday } from "../../../features/course-schedule/types.ts";
import type { CourseScheduleStore } from "../course-schedule-types.ts";
import type { SqlDatabase } from "./types.ts";

interface SlotRow {
  id: string;
  annual_course_id: string;
  day_of_week: number;
  period_start: number;
  period_end: number;
  week_kind: string;
  valid_from: string | null;
  valid_to: string | null;
  created_at: string;
  updated_at: string;
}

function mapSlot(row: SlotRow): CourseScheduleSlot {
  return {
    id: row.id,
    annualCourseId: row.annual_course_id,
    dayOfWeek: row.day_of_week as CourseWeekday,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    weekKind: row.week_kind as CourseWeekKind,
    validFrom: row.valid_from,
    validTo: row.valid_to,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqlCourseScheduleStore implements CourseScheduleStore {
  private readonly db: SqlDatabase;

  constructor(db: SqlDatabase) {
    this.db = db;
  }

  async listSlots(): Promise<CourseScheduleSlot[]> {
    const result = await this.db
      .prepare("SELECT * FROM course_schedule_slots ORDER BY created_at")
      .bind()
      .all<SlotRow>();
    return (result.results ?? []).map(mapSlot);
  }

  async listSlotsByAnnualCourse(annualCourseId: string): Promise<CourseScheduleSlot[]> {
    const result = await this.db
      .prepare("SELECT * FROM course_schedule_slots WHERE annual_course_id = ? ORDER BY created_at")
      .bind(annualCourseId)
      .all<SlotRow>();
    return (result.results ?? []).map(mapSlot);
  }

  async getSlot(id: string): Promise<CourseScheduleSlot | null> {
    const row = await this.db
      .prepare("SELECT * FROM course_schedule_slots WHERE id = ? LIMIT 1")
      .bind(id)
      .first<SlotRow>();
    return row ? mapSlot(row) : null;
  }

  async createSlot(slot: CourseScheduleSlot): Promise<CourseScheduleSlot> {
    await this.db
      .prepare(
        `INSERT INTO course_schedule_slots (
          id, annual_course_id, day_of_week, period_start, period_end, week_kind,
          valid_from, valid_to, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        slot.id,
        slot.annualCourseId,
        slot.dayOfWeek,
        slot.periodStart,
        slot.periodEnd,
        slot.weekKind,
        slot.validFrom,
        slot.validTo,
        slot.createdAt,
        slot.updatedAt,
      )
      .run();
    return slot;
  }

  async updateSlot(slot: CourseScheduleSlot): Promise<CourseScheduleSlot> {
    await this.db
      .prepare(
        `UPDATE course_schedule_slots SET
          day_of_week = ?, period_start = ?, period_end = ?, week_kind = ?,
          valid_from = ?, valid_to = ?, updated_at = ?
        WHERE id = ?`,
      )
      .bind(
        slot.dayOfWeek,
        slot.periodStart,
        slot.periodEnd,
        slot.weekKind,
        slot.validFrom,
        slot.validTo,
        slot.updatedAt,
        slot.id,
      )
      .run();
    return slot;
  }

  async deleteSlot(id: string): Promise<boolean> {
    const result = await this.db.prepare("DELETE FROM course_schedule_slots WHERE id = ?").bind(id).run();
    return Boolean(result.meta?.changes);
  }
}
