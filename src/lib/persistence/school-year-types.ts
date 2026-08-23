import type { ParsedWeekPlan, SchoolYearRecord, SchoolYearWithWeeks } from "../../features/school-year/types.ts";

export interface SchoolYearStore {
  listSchoolYears(): Promise<SchoolYearRecord[]>;
  getActiveSchoolYear(): Promise<SchoolYearWithWeeks | null>;
  getSchoolYearById(id: string): Promise<SchoolYearWithWeeks | null>;
  importDraftFromPlan(plan: ParsedWeekPlan, sourceFilename?: string): Promise<SchoolYearWithWeeks>;
  activateSchoolYear(id: string): Promise<SchoolYearWithWeeks>;
  seedDefaultActiveYearIfEmpty(): Promise<SchoolYearWithWeeks | null>;
}
