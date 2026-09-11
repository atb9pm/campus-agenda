export type {
  ParsedWeekPlan,
  SchoolWeekEntry,
  SchoolYearRecord,
  SchoolYearStatus,
  SchoolYearWithWeeks,
} from "./types.ts";
export type {
  ExistingSchoolYearRef,
  OfficialCalendarEvent,
  OfficialCalendarEventKind,
  OfficialDayMarker,
  OfficialPlanImportOptions,
  OfficialPlanImportResult,
  OfficialPlanParseResult,
  OfficialPlanWarning,
  OfficialSchoolPlanPreview,
} from "./official-plan-types.ts";
export { parseWeekPlanPdf, isReceivableWeekPlan } from "./parse-week-plan-pdf.ts";
export { parseOfficialPlanPdf, extractOfficialPlanLines } from "./parse-official-plan-pdf.ts";
export { detectAndParseSchoolYearPdf } from "./detect-school-year-pdf.ts";
export type { DetectedSchoolYearPdf } from "./detect-school-year-pdf.ts";
export {
  ADMIN_WORKING_YEAR_STORAGE_KEY,
  ADMIN_WORKING_YEAR_BADGE_LABELS,
  formatAdminWorkingYearOption,
  formatAdminWorkingSectionTitle,
  filterBySchoolYearId,
  readAdminWorkingYearId,
  resolveAdminWorkingYearId,
  schoolYearStatusesAfterAdminWorkingYearChange,
  writeAdminWorkingYearId,
} from "./admin-working-year.ts";
export type { AdminWorkingYearRef } from "./admin-working-year.ts";
export {
  SCHOOL_WEEKS_EXPECTED,
  buildWeekPlanFromGrid,
  extractWeekNumberFromCell,
  mondayReferenceFromDate,
  parseSchoolYearLabel,
  schoolYearBoundsFromLabel,
  weekKindForNumber,
} from "./week-plan-logic.ts";
export {
  INCOHERENT_BOUNDS_REASON,
  MISSING_END_REASON,
  MISSING_START_REASON,
  MISSING_YEAR_REASON,
  classifyOfficialEvent,
  closedDaysFromOfficialEvent,
  eachIsoDateInclusive,
  expandOfficialEventsToExceptions,
  extractOfficialYearLabel,
  formatOfficialDateFr,
  formatSchoolYearLabelFr,
  groupOfficialEventsByMonth,
  looksLikeOfficialPlanText,
  normalizeSchoolYearLabel,
  officialEventsFromExceptions,
  parseOfficialPlanFromLines,
  schoolYearAlreadyExistsMessage,
  validateOfficialPlanPreview,
} from "./official-plan-logic.ts";
export {
  assertGeneratedWeeksMatchOfficialTotal,
  formatPedagogicalWeekLabel,
  generateOfficialCourseWeeks,
  mondayOfContainingWeek,
  officialCourseWeekCountMismatchMessage,
} from "./official-course-weeks.ts";
export type {
  GenerateOfficialCourseWeeksInput,
  GenerateOfficialCourseWeeksResult,
} from "./official-course-weeks.ts";
export {
  applyDefaultPedagogicalWeekKinds,
  pedagogicalWeekKind,
  preserveExistingPedagogicalWeekKinds,
  schoolWeeksHaveLocalChanges,
  weeksNeedKindInitialization,
} from "./pedagogical-week-kinds.ts";
export {
  ARCHIVED_YEAR_MUTATION_REASON as ARCHIVED_YEAR_CALENDAR_MUTATION_REASON,
  assertCalendarYearWritable,
  buildSchoolYearCalendarPlan,
  ensurePedagogicalWeekKinds,
  resolveSchoolYearForPlan,
} from "./working-year-plan.ts";
export type {
  SchoolYearCalendarPlanPayload,
  SchoolYearPlanStore,
} from "./working-year-plan.ts";
