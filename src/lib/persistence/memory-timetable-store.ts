import { randomUUID } from "node:crypto";

import type { ParsedTimetable, TimetableImportRecord, TimetableSlot } from "../../features/timetable/types.ts";
import { filterSlotsForCourseDay } from "../../features/timetable/slot-logic.ts";
import type { TimetableStore } from "./timetable-types.ts";

interface MemoryImportMeta {
  sourceVersion: string | null;
  excludedSpsCount: number;
  warningsJson: string;
}

interface MemorySlotEntry extends TimetableSlot {
  id: string;
}

let memoryImports: TimetableImportRecord[] = [];
let memoryImportMeta = new Map<string, MemoryImportMeta>();
let memorySlotsByImport = new Map<string, MemorySlotEntry[]>();
let memoryClassMappings = new Map<string, string>();
let memoryTeacherMappings = new Map<string, string | null>();

function slotWithoutId(slot: MemorySlotEntry): TimetableSlot {
  return {
    classCode: slot.classCode,
    dayOfWeek: slot.dayOfWeek,
    period: slot.period,
    branchLabel: slot.branchLabel,
    teacherCode: slot.teacherCode,
    weekKind: slot.weekKind,
  };
}

export function resetMemoryTimetableStore(): void {
  memoryImports = [];
  memoryImportMeta = new Map();
  memorySlotsByImport = new Map();
  memoryClassMappings = new Map();
  memoryTeacherMappings = new Map();
}

export function exportMemoryTimetableTables(): {
  timetable_imports: Array<Record<string, unknown>>;
  timetable_slots: Array<Record<string, unknown>>;
  timetable_class_mappings: Array<Record<string, unknown>>;
  timetable_teacher_codes: Array<Record<string, unknown>>;
} {
  const timetable_imports = memoryImports.map((entry) => {
    const meta = memoryImportMeta.get(entry.id);
    return {
      id: entry.id,
      school_year_id: entry.schoolYearId,
      source_filename: entry.sourceFilename,
      school_year_label: entry.schoolYearLabel,
      source_version: meta?.sourceVersion ?? null,
      status: entry.status,
      slot_count: entry.slotCount,
      excluded_sps_count: meta?.excludedSpsCount ?? 0,
      warnings_json: meta?.warningsJson ?? "[]",
      imported_at: entry.importedAt,
    };
  });
  const timetable_slots: Array<Record<string, unknown>> = [];
  for (const [importId, slots] of memorySlotsByImport) {
    for (const slot of slots) {
      timetable_slots.push({
        id: slot.id,
        import_id: importId,
        class_code: slot.classCode,
        day_of_week: slot.dayOfWeek,
        period: slot.period,
        branch_label: slot.branchLabel,
        teacher_code: slot.teacherCode,
        week_kind: slot.weekKind,
      });
    }
  }
  const timetable_class_mappings: Array<Record<string, unknown>> = [];
  for (const [key, classroomId] of memoryClassMappings) {
    const sep = key.indexOf(":");
    timetable_class_mappings.push({
      import_id: key.slice(0, sep),
      class_code: key.slice(sep + 1),
      classroom_id: classroomId,
    });
  }
  const timetable_teacher_codes: Array<Record<string, unknown>> = [];
  for (const [key, teacherId] of memoryTeacherMappings) {
    const sep = key.indexOf(":");
    timetable_teacher_codes.push({
      import_id: key.slice(0, sep),
      teacher_code: key.slice(sep + 1),
      teacher_id: teacherId,
    });
  }
  return { timetable_imports, timetable_slots, timetable_class_mappings, timetable_teacher_codes };
}

export function replaceMemoryTimetableTables(tables: {
  timetable_imports?: Array<Record<string, unknown>>;
  timetable_slots?: Array<Record<string, unknown>>;
  timetable_class_mappings?: Array<Record<string, unknown>>;
  timetable_teacher_codes?: Array<Record<string, unknown>>;
}): void {
  resetMemoryTimetableStore();
  memoryImports = (tables.timetable_imports ?? []).map((row) => {
    const id = String(row.id ?? "");
    memoryImportMeta.set(id, {
      sourceVersion: row.source_version == null || row.source_version === "" ? null : String(row.source_version),
      excludedSpsCount: typeof row.excluded_sps_count === "number" ? row.excluded_sps_count : 0,
      warningsJson: typeof row.warnings_json === "string" ? row.warnings_json : "[]",
    });
    return {
      id,
      schoolYearId: row.school_year_id == null || row.school_year_id === "" ? null : String(row.school_year_id),
      sourceFilename: String(row.source_filename ?? ""),
      schoolYearLabel: String(row.school_year_label ?? ""),
      status: row.status as TimetableImportRecord["status"],
      importedAt: String(row.imported_at ?? ""),
      slotCount: typeof row.slot_count === "number" ? row.slot_count : 0,
    };
  });
  for (const row of tables.timetable_slots ?? []) {
    const importId = String(row.import_id ?? "");
    const list = memorySlotsByImport.get(importId) ?? [];
    list.push({
      id: String(row.id ?? randomUUID()),
      classCode: String(row.class_code ?? ""),
      dayOfWeek: Number(row.day_of_week) as TimetableSlot["dayOfWeek"],
      period: Number(row.period),
      branchLabel: String(row.branch_label ?? ""),
      teacherCode: row.teacher_code == null || row.teacher_code === "" ? null : String(row.teacher_code),
      weekKind: String(row.week_kind ?? "all") as TimetableSlot["weekKind"],
    });
    memorySlotsByImport.set(importId, list);
  }
  for (const row of tables.timetable_class_mappings ?? []) {
    memoryClassMappings.set(
      `${String(row.import_id)}:${String(row.class_code).toUpperCase()}`,
      String(row.classroom_id),
    );
  }
  for (const row of tables.timetable_teacher_codes ?? []) {
    memoryTeacherMappings.set(
      `${String(row.import_id)}:${String(row.teacher_code)}`,
      row.teacher_id == null || row.teacher_id === "" ? null : String(row.teacher_id),
    );
  }
}

export class MemoryTimetableStore implements TimetableStore {
  async getActiveImport(): Promise<TimetableImportRecord | null> {
    return memoryImports.find((entry) => entry.status === "active") ?? null;
  }

  async listImports(): Promise<TimetableImportRecord[]> {
    return memoryImports.map((entry) => ({ ...entry }));
  }

  async importTimetable(parsed: ParsedTimetable, sourceFilename: string, schoolYearId: string | null) {
    const id = randomUUID();
    const importRecord: TimetableImportRecord = {
      id,
      schoolYearId,
      sourceFilename,
      schoolYearLabel: parsed.schoolYearLabel,
      status: "draft",
      importedAt: new Date().toISOString(),
      slotCount: parsed.slots.length,
    };
    memoryImports = [
      importRecord,
      ...memoryImports.map((entry) => ({
        ...entry,
        status: entry.status === "active" ? ("archived" as const) : entry.status,
      })),
    ];
    memoryImportMeta.set(id, {
      sourceVersion: parsed.sourceVersion,
      excludedSpsCount: parsed.excludedSpsCount,
      warningsJson: JSON.stringify(parsed.warnings),
    });
    memorySlotsByImport.set(
      id,
      parsed.slots.map((slot) => ({ ...slot, id: randomUUID() })),
    );
    const slots = memorySlotsByImport.get(id) ?? [];
    return { importRecord, slots: slots.map(slotWithoutId) };
  }

  async activateImport(importId: string): Promise<TimetableImportRecord> {
    const target = memoryImports.find((entry) => entry.id === importId);
    if (!target) throw new Error("Import introuvable.");
    memoryImports = memoryImports.map((entry) => ({
      ...entry,
      status: entry.id === importId ? ("active" as const) : entry.status === "active" ? ("archived" as const) : entry.status,
    }));
    return (await this.getActiveImport())!;
  }

  async listActiveSlots(classCode?: string): Promise<TimetableSlot[]> {
    const active = await this.getActiveImport();
    if (!active) return [];
    const slots = memorySlotsByImport.get(active.id) ?? [];
    const filtered = classCode
      ? slots.filter((slot) => slot.classCode === classCode.toUpperCase())
      : slots;
    return filtered.map(slotWithoutId);
  }

  async listClassSlotsAcrossImports(
    classCode: string,
  ): Promise<Array<{ classCode: string; schoolYearId: string | null }>> {
    const wanted = classCode.toUpperCase();
    const results: Array<{ classCode: string; schoolYearId: string | null }> = [];
    for (const entry of memoryImports) {
      const slots = memorySlotsByImport.get(entry.id) ?? [];
      for (const slot of slots) {
        if (slot.classCode.toUpperCase() !== wanted) continue;
        results.push({ classCode: slot.classCode, schoolYearId: entry.schoolYearId });
      }
    }
    return results;
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
    memoryClassMappings.set(`${importId}:${classCode.toUpperCase()}`, classroomId);
  }

  async mapTeacherCode(importId: string, teacherCode: string, teacherId: string | null): Promise<void> {
    memoryTeacherMappings.set(`${importId}:${teacherCode}`, teacherId);
  }
}

let singleton: MemoryTimetableStore | null = null;

export function getMemoryTimetableStore(): MemoryTimetableStore {
  singleton ??= new MemoryTimetableStore();
  return singleton;
}

export function resolveDemoTeacherCode(teacherId: string): string | null {
  const map: Record<string, string> = {
    "teacher-chf": "ChF",
    "teacher-demo-current": "RoP",
    "teacher-demo-dupont": "DuP",
    "teacher-demo-martin": "MaF",
  };
  return map[teacherId] ?? null;
}
