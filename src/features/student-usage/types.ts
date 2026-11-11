import type { StudentUsageDayCount } from "./stats.ts";

export interface StudentUsageIncrement {
  date: string;
  schoolYearId: string;
  schoolClassId: string;
}

/** Compteurs agrégés uniquement. Aucune ligne par élève ni par requête. */
export interface StudentUsageStore {
  increment(input: StudentUsageIncrement): Promise<void>;
  listBetween(startDate: string, endDate: string): Promise<StudentUsageDayCount[]>;
  purgeBefore(cutoffDate: string): Promise<number>;
}
