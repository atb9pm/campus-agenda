import { randomUUID } from "node:crypto";

import { filterSlotsForCourseDay } from "../../../features/timetable/slot-logic.ts";
import type { ParsedTimetable, TimetableImportRecord, TimetableSlot } from "../../../features/timetable/types.ts";
import type { TimetableStore } from "../timetable-types.ts";
import type { SqlDatabase } from "./types.ts";

interface ImportRow {
  id: string;
  school_year_id: string | null;
  source_filename: string;
  school_year_label: string;
  source_version: string | null;
  status: string;
  slot_count: number;
  excluded_sps_count: number;
  imported_at: string;
}

interface SlotRow {
  class_code: string;
  day_of_week: number;
  period: number;
  branch_label: string;
  teacher_code: string | null;
  week_kind: string;
}

function rowToImport(row: ImportRow): TimetableImportRecord {
  return {
    id: row.id,
    schoolYearId: row.school_year_id,
    sourceFilename: row.source_filename,
    schoolYearLabel: row.school_year_label,
    status: row.status as TimetableImportRecord["status"],
    importedAt: row.imported_at,
    slotCount: row.slot_count,
  };
}

export class SqlTimetableStore implements TimetableStore {
  private readonly db: SqlDatabase;

  constructor(db: SqlDatabase) {
    this.db = db;
  }

  async getActiveImport(): Promise<TimetableImportRecord | null> {
    const row = await this.db
      .prepare(
        "SELECT id, school_year_id, source_filename, school_year_label, source_version, status, slot_count, excluded_sps_count, imported_at FROM timetable_imports WHERE status = 'active' LIMIT 1",
      )
      .bind()
      .first<ImportRow>();
    return row ? rowToImport(row) : null;
  }

  async listImports(): Promise<TimetableImportRecord[]> {
    const { results } = await this.db
      .prepare(
        "SELECT id, school_year_id, source_filename, school_year_label, source_version, status, slot_count, excluded_sps_count, imported_at FROM timetable_imports ORDER BY imported_at DESC",
      )
      .bind()
      .all<ImportRow>();
    return results.map(rowToImport);
  }

  async importTimetable(parsed: ParsedTimetable, sourceFilename: string, schoolYearId: string | null) {
    const id = randomUUID();
    const now = new Date().toISOString();
    await this.db
      .prepare(
        `INSERT INTO timetable_imports
          (id, school_year_id, source_filename, school_year_label, source_version, status, slot_count, excluded_sps_count, warnings_json, imported_at)
         VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
      )
      .bind(
        id,
        schoolYearId,
        sourceFilename,
        parsed.schoolYearLabel,
        parsed.sourceVersion,
        parsed.slots.length,
        parsed.excludedSpsCount,
        JSON.stringify(parsed.warnings),
        now,
      )
      .run();

    for (const slot of parsed.slots) {
      await this.db
        .prepare(
          `INSERT INTO timetable_slots
            (id, import_id, class_code, day_of_week, period, branch_label, teacher_code, week_kind)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          randomUUID(),
          id,
          slot.classCode,
          slot.dayOfWeek,
          slot.period,
          slot.branchLabel,
          slot.teacherCode,
          slot.weekKind,
        )
        .run();
    }

    const importRecord: TimetableImportRecord = {
      id,
      schoolYearId,
      sourceFilename,
      schoolYearLabel: parsed.schoolYearLabel,
      status: "draft",
      importedAt: now,
      slotCount: parsed.slots.length,
    };
    return { importRecord, slots: parsed.slots.map((slot) => ({ ...slot })) };
  }

  async activateImport(importId: string): Promise<TimetableImportRecord> {
    await this.db.prepare("UPDATE timetable_imports SET status = 'archived' WHERE status = 'active'").bind().run();
    await this.db.prepare("UPDATE timetable_imports SET status = 'active' WHERE id = ?").bind(importId).run();
    const active = await this.getActiveImport();
    if (!active) throw new Error("Activation échouée.");
    return active;
  }

  private async loadSlots(importId: string, classCode?: string): Promise<TimetableSlot[]> {
    const query = classCode
      ? "SELECT class_code, day_of_week, period, branch_label, teacher_code, week_kind FROM timetable_slots WHERE import_id = ? AND class_code = ? ORDER BY day_of_week, period"
      : "SELECT class_code, day_of_week, period, branch_label, teacher_code, week_kind FROM timetable_slots WHERE import_id = ? ORDER BY class_code, day_of_week, period";
    const statement = this.db.prepare(query).bind(...(classCode ? [importId, classCode.toUpperCase()] : [importId]));
    const { results } = await statement.all<SlotRow>();
    return results.map((row) => ({
      classCode: row.class_code,
      dayOfWeek: row.day_of_week as TimetableSlot["dayOfWeek"],
      period: row.period,
      branchLabel: row.branch_label,
      teacherCode: row.teacher_code,
      weekKind: row.week_kind as TimetableSlot["weekKind"],
    }));
  }

  async listActiveSlots(classCode?: string): Promise<TimetableSlot[]> {
    const active = await this.getActiveImport();
    if (!active) return [];
    return this.loadSlots(active.id, classCode);
  }

  async listClassSlotsAcrossImports(
    classCode: string,
  ): Promise<Array<{ classCode: string; schoolYearId: string | null }>> {
    const { results } = await this.db
      .prepare(
        `SELECT s.class_code AS class_code, i.school_year_id AS school_year_id
         FROM timetable_slots s
         INNER JOIN timetable_imports i ON i.id = s.import_id
         WHERE UPPER(s.class_code) = UPPER(?)`,
      )
      .bind(classCode)
      .all<{ class_code: string; school_year_id: string | null }>();
    return (results ?? []).map((row) => ({
      classCode: row.class_code,
      schoolYearId: row.school_year_id,
    }));
  }

  async listSlotsForTeacherCode(
    teacherCode: string,
    classCode: string,
    dayOfWeek: number,
    weekKind: "A" | "B",
  ): Promise<TimetableSlot[]> {
    const slots = await this.listActiveSlots(classCode);
    return filterSlotsForCourseDay(slots, classCode.toUpperCase(), dayOfWeek, weekKind)
      .filter((slot) => slot.teacherCode?.toLowerCase() === teacherCode.toLowerCase());
  }

  async mapClassToClassroom(importId: string, classCode: string, classroomId: string): Promise<void> {
    await this.db
      .prepare(
        "INSERT OR REPLACE INTO timetable_class_mappings (import_id, class_code, classroom_id) VALUES (?, ?, ?)",
      )
      .bind(importId, classCode.toUpperCase(), classroomId)
      .run();
  }

  async mapTeacherCode(importId: string, teacherCode: string, teacherId: string | null): Promise<void> {
    await this.db
      .prepare(
        "INSERT OR REPLACE INTO timetable_teacher_codes (import_id, teacher_code, teacher_id) VALUES (?, ?, ?)",
      )
      .bind(importId, teacherCode, teacherId)
      .run();
  }
}
