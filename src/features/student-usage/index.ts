export {
  decideStudentVisit,
  parseStudentVisitRecord,
  readStudentVisitRecord,
  sameVisitContext,
  STUDENT_VISIT_PENDING_MS,
  STUDENT_VISIT_STORAGE_KEY,
  writeStudentVisitRecord,
  type StudentVisitContext,
  type StudentVisitRecord,
} from "./browser-visit.ts";
export {
  maybePurgeStudentUsage,
  resetStudentUsagePurgeClock,
  STUDENT_USAGE_PURGE_INTERVAL_MS,
} from "./retention.ts";
export {
  buildStudentUsageDashboard,
  isStudentUsagePeriod,
  STUDENT_USAGE_DISCLAIMER,
  STUDENT_USAGE_LOOKBACK_DAYS,
  STUDENT_USAGE_PERIODS,
  STUDENT_USAGE_RETENTION_MONTHS,
  studentUsageClassLabel,
  studentUsageRetentionCutoff,
  usageWindow,
  type StudentUsageClassInfo,
  type StudentUsageClassRow,
  type StudentUsageDashboard,
  type StudentUsageDayCount,
  type StudentUsagePeriod,
  type StudentUsageSeriesPoint,
} from "./stats.ts";
export { addIsoDays, isoDatesFrom, schoolCalendarDateIso, STUDENT_USAGE_TIME_ZONE } from "./time.ts";
export type { StudentUsageIncrement, StudentUsageStore } from "./types.ts";
