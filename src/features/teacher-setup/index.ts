export {
  buildDefaultTeacherSetup,
  createEmptyClassSetup,
  emptyTeacherSetup,
} from "./defaults.ts";
export {
  buildSchoolWeekPlanRows,
  clampNotebookWeekCount,
  countConfiguredClasses,
  formatBranchInput,
  formatWeekdayLabel,
  groupClassesByWeekday,
  normalizeTeacherSetup,
  notebookWeekCountPreference,
  parseBranchInput,
  sortClassesByWeekday,
  withNotebookWeekCount,
  type SchoolWeekPlanRow,
} from "./queries.ts";
export {
  clearTeacherSetupFromBrowser,
  isTeacherSetupPayload,
  loadTeacherSetupFromBrowser,
  parseStoredTeacherSetup,
  saveTeacherSetupToBrowser,
  serializeTeacherSetup,
  teacherSetupStorageKey,
  TEACHER_SETUP_STORAGE_PREFIX,
} from "./storage.ts";
export {
  DEFAULT_NOTEBOOK_WEEK_COUNT,
  NOTEBOOK_WEEK_COUNT_OPTIONS,
  WEEKDAY_LABELS,
  WEEKDAY_SHORT_LABELS,
  type NotebookWeekCountPreference,
  type TeacherClassSetup,
  type TeacherDisplayPreferences,
  type TeacherSetupConfig,
  type WeekdayIndex,
} from "./types.ts";
