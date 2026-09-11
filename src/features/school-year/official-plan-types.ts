import type { SchoolYearRecord, SchoolYearWithWeeks } from "./types.ts";

export type OfficialCalendarEventKind = "VACATION" | "PUBLIC_HOLIDAY" | "SCHOOL_CLOSED" | "OTHER";

export interface OfficialCalendarEvent {
  label: string;
  startsOn: string;
  endsOn: string;
  kind: OfficialCalendarEventKind;
  sourceText: string;
}

export interface OfficialPlanWarning {
  sourceText: string;
  message: string;
}

export interface OfficialSchoolPlanPreview {
  sourceKind: "official-plan";
  label: string;
  startsOn: string;
  endsOn: string;
  events: OfficialCalendarEvent[];
  warnings: OfficialPlanWarning[];
  totalCourseDays: number | null;
  totalCourseWeeks: number | null;
  pageCount: number;
}

export type OfficialPlanParseResult =
  | { ok: true; looksLikeOfficialPlan: true; preview: OfficialSchoolPlanPreview }
  | {
      ok: false;
      looksLikeOfficialPlan: boolean;
      errors: string[];
      warnings: OfficialPlanWarning[];
      preview?: Partial<OfficialSchoolPlanPreview>;
    };

export interface OfficialPlanImportResult {
  year: SchoolYearWithWeeks;
  eventCount: number;
  exceptionDayCount: number;
  replaced: boolean;
}

export interface OfficialPlanImportOptions {
  replaceDraft?: boolean;
}

export type ExistingSchoolYearRef = Pick<SchoolYearRecord, "id" | "label" | "status">;
