import { randomUUID } from "node:crypto";

import type { ParsedTimetable, TimetableImportRecord, TimetableSlot } from "../../features/timetable/types.ts";
import { filterSlotsForCourseDay } from "../../features/timetable/slot-logic.ts";
import type { TimetableStore } from "./timetable-types.ts";

let memoryImports: TimetableImportRecord[] = [];
let memorySlots: TimetableSlot[] = [];
let memoryClassMappings = new Map<string, string>();
let memoryTeacherMappings = new Map<string, string | null>();

export function resetMemoryTimetableStore(): void {
  memoryImports = [];
  memorySlots = [];
  memoryClassMappings = new Map();
  memoryTeacherMappings = new Map();
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
    memoryImports = [importRecord, ...memoryImports.map((entry) => ({ ...entry, status: entry.status === "active" ? "archived" as const : entry.status }))];
    memorySlots = parsed.slots.map((slot) => ({ ...slot }));
    return { importRecord, slots: memorySlots.map((slot) => ({ ...slot })) };
  }

  async activateImport(importId: string): Promise<TimetableImportRecord> {
    const target = memoryImports.find((entry) => entry.id === importId);
    if (!target) throw new Error("Import introuvable.");
    memoryImports = memoryImports.map((entry) => ({
      ...entry,
      status: entry.id === importId ? "active" as const : entry.status === "active" ? "archived" as const : entry.status,
    }));
    return (await this.getActiveImport())!;
  }

  async listActiveSlots(classCode?: string): Promise<TimetableSlot[]> {
    const active = await this.getActiveImport();
    if (!active) return [];
    let slots = memorySlots;
    if (classCode) slots = slots.filter((slot) => slot.classCode === classCode.toUpperCase());
    return slots.map((slot) => ({ ...slot }));
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
