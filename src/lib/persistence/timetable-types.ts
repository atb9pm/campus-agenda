import type { ParsedTimetable, TimetableImportRecord, TimetableSlot } from "./types.ts";

export interface TimetableStore {
  getActiveImport(): Promise<TimetableImportRecord | null>;
  listImports(): Promise<TimetableImportRecord[]>;
  importTimetable(
    parsed: ParsedTimetable,
    sourceFilename: string,
    schoolYearId: string | null,
  ): Promise<{ importRecord: TimetableImportRecord; slots: TimetableSlot[] }>;
  activateImport(importId: string): Promise<TimetableImportRecord>;
  listActiveSlots(classCode?: string): Promise<TimetableSlot[]>;
  /** Slots de tous les imports (draft / active / archived) pour une classe, avec l'année de l'import. */
  listClassSlotsAcrossImports(
    classCode: string,
  ): Promise<Array<{ classCode: string; schoolYearId: string | null }>>;
  listSlotsForTeacherCode(teacherCode: string, classCode: string, dayOfWeek: number, weekKind: "A" | "B"): Promise<TimetableSlot[]>;
  mapClassToClassroom(importId: string, classCode: string, classroomId: string): Promise<void>;
  mapTeacherCode(importId: string, teacherCode: string, teacherId: string | null): Promise<void>;
}

export function buildImportRecord(
  id: string,
  parsed: ParsedTimetable,
  sourceFilename: string,
  schoolYearId: string | null,
  status: TimetableImportRecord["status"] = "draft",
): TimetableImportRecord {
  return {
    id,
    schoolYearId,
    sourceFilename,
    schoolYearLabel: parsed.schoolYearLabel,
    status,
    importedAt: new Date().toISOString(),
    slotCount: parsed.slots.length,
  };
}
