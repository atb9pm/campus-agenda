export type TimetableDayOfWeek = 0 | 1 | 2 | 3 | 4;

export const TIMETABLE_DAY_LABELS = ["Lu", "Ma", "Me", "Je", "Ve"] as const;

/** Semaine scolaire où le créneau est actif (`all` = chaque semaine). */
export type TimetableWeekKind = "all" | "A" | "B";

export interface TimetableSlot {
  classCode: string;
  dayOfWeek: TimetableDayOfWeek;
  period: number;
  branchLabel: string;
  teacherCode: string | null;
  weekKind: TimetableWeekKind;
}

export interface TimetableClassSummary {
  classCode: string;
  slotCount: number;
  branches: string[];
  teacherCodes: string[];
}

export interface ParsedTimetable {
  schoolYearLabel: string;
  sourceVersion: string | null;
  slots: TimetableSlot[];
  classes: TimetableClassSummary[];
  warnings: string[];
  excludedSpsCount: number;
}

export interface TimetablePreview extends ParsedTimetable {
  receivable: boolean;
}

export interface TimetableImportRecord {
  id: string;
  schoolYearId: string | null;
  sourceFilename: string;
  schoolYearLabel: string;
  status: "draft" | "active" | "archived";
  importedAt: string;
  slotCount: number;
}
