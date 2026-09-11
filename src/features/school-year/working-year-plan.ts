import {
  buildSchoolDayPlan,
  checkWeekPlanConsistency,
  countClassDays,
  listHolidayDays,
  valaisHolidaysForSchoolYear,
} from "../school-days/index.ts";
import type { SchoolDayException } from "../school-days/types.ts";
import { ARCHIVED_YEAR_MUTATION_REASON, assertSchoolYearWritable } from "../school-catalog/school-year-attachment.ts";
import type { SchoolWeekEntry, SchoolYearWithWeeks } from "./types.ts";
import {
  applyDefaultPedagogicalWeekKinds,
  weeksNeedKindInitialization,
} from "./pedagogical-week-kinds.ts";

export { ARCHIVED_YEAR_MUTATION_REASON };

export interface SchoolYearPlanStore {
  getSchoolYearById(id: string): Promise<SchoolYearWithWeeks | null>;
  getActiveSchoolYear(): Promise<SchoolYearWithWeeks | null>;
  replaceSchoolYearWeeks(id: string, weeks: SchoolWeekEntry[]): Promise<SchoolYearWithWeeks>;
  listDayExceptions(schoolYearId: string): Promise<SchoolDayException[]>;
}

export interface SchoolYearCalendarPlanPayload {
  year: { id: string; label: string; status: SchoolYearWithWeeks["status"] };
  weeks: SchoolWeekEntry[];
  rows: ReturnType<typeof buildSchoolDayPlan>;
  warnings: string[];
  classDayCount: number;
  holidays: ReturnType<typeof listHolidayDays>;
}

export async function resolveSchoolYearForPlan(
  store: Pick<SchoolYearPlanStore, "getSchoolYearById" | "getActiveSchoolYear">,
  schoolYearId: string | null | undefined,
): Promise<SchoolYearWithWeeks | null> {
  const requested = schoolYearId?.trim() || null;
  if (requested) {
    return store.getSchoolYearById(requested);
  }
  return store.getActiveSchoolYear();
}

export function assertCalendarYearWritable(year: SchoolYearWithWeeks | null | undefined) {
  return assertSchoolYearWritable(year);
}

/**
 * Initialise les `kind` nuls (impair = A, pair = B) sans écraser les A/B existants.
 * Persiste uniquement si l’année n’est pas archivée.
 */
export async function ensurePedagogicalWeekKinds(
  store: Pick<SchoolYearPlanStore, "replaceSchoolYearWeeks">,
  year: SchoolYearWithWeeks,
): Promise<SchoolYearWithWeeks> {
  if (!weeksNeedKindInitialization(year.weeks)) {
    return year;
  }
  const filled = applyDefaultPedagogicalWeekKinds(year.weeks);
  if (year.status === "archived") {
    return { ...year, weeks: filled };
  }
  return store.replaceSchoolYearWeeks(year.id, filled);
}

export async function buildSchoolYearCalendarPlan(
  store: SchoolYearPlanStore,
  year: SchoolYearWithWeeks,
): Promise<SchoolYearCalendarPlanPayload> {
  const resolved = await ensurePedagogicalWeekKinds(store, year);
  const exceptions = await store.listDayExceptions(resolved.id);
  const holidays = valaisHolidaysForSchoolYear(resolved.label);
  const rows = buildSchoolDayPlan(resolved.weeks, holidays, exceptions);
  return {
    year: { id: resolved.id, label: resolved.label, status: resolved.status },
    weeks: resolved.weeks,
    rows,
    warnings: checkWeekPlanConsistency(resolved.weeks),
    classDayCount: countClassDays(rows),
    holidays: listHolidayDays(rows),
  };
}
