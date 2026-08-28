import type { SchoolDayException } from "../../features/school-days/types.ts";
import type {
  ParsedWeekPlan,
  SchoolWeekEntry,
  SchoolYearRecord,
  SchoolYearWithWeeks,
} from "../../features/school-year/types.ts";

export interface SchoolYearStore {
  listSchoolYears(): Promise<SchoolYearRecord[]>;
  getActiveSchoolYear(): Promise<SchoolYearWithWeeks | null>;
  getSchoolYearById(id: string): Promise<SchoolYearWithWeeks | null>;
  importDraftFromPlan(plan: ParsedWeekPlan, sourceFilename?: string): Promise<SchoolYearWithWeeks>;
  activateSchoolYear(id: string): Promise<SchoolYearWithWeeks>;
  seedDefaultActiveYearIfEmpty(): Promise<SchoolYearWithWeeks | null>;
  /** Correction manuelle du plan : remplace les semaines de l'année ciblée. */
  replaceSchoolYearWeeks(id: string, weeks: SchoolWeekEntry[]): Promise<SchoolYearWithWeeks>;
  listDayExceptions(schoolYearId: string): Promise<SchoolDayException[]>;
  /** `state` à `null` efface la correction et rend le jour à son calcul automatique. */
  setDayException(
    schoolYearId: string,
    date: string,
    exception: { state: SchoolDayException["state"]; label: string | null } | null,
  ): Promise<SchoolDayException[]>;
}
