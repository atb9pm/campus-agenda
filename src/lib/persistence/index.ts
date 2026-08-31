export type {
  AgendaMutationResult,
  AgendaStore,
  AppSession,
  AuthResult,
  CreateAgendaInput,
  SessionKind,
  StoreKind,
  StudentSession,
  TeacherSession,
} from "./types.ts";
export {
  MemoryAgendaStore,
  getMemoryAgendaStore,
  resetMemoryAgendaStore,
  classroomExists,
} from "./memory-store.ts";
export {
  BACKUP_FORMAT_VERSION,
  BACKUP_FORMAT_VERSION_V2,
  LEGACY_BACKUP_FORMAT_VERSION,
  exportAgendaSnapshot,
  restoreAgendaSnapshot,
  type AgendaBackupSnapshot,
  type BackupRestoreResult,
  type BackupStoreDeps,
} from "./backup.ts";
export type { TeacherSetupBackupEntry } from "./teacher-setup-types.ts";
export type { TeacherNotesBackupEntry } from "./teacher-notes-types.ts";
export type { TeacherAccountBackupEntry } from "./teacher-account-types.ts";
export {
  APP_VERSION,
  checkClassroomExists,
  getAgendaStore,
  getSchoolCatalogStore,
  getSchoolYearStore,
  getStoreKind,
  getTeacherAccountStore,
  getTeacherNotesStore,
  getTeacherSetupStore,
  getAnnualCourseStore,
  getCourseScheduleStore,
  resetStoreFactory,
  resolveAgendaStore,
} from "./store-factory.ts";
export type { CourseScheduleStore } from "./course-schedule-types.ts";
export {
  MemoryCourseScheduleStore,
  getMemoryCourseScheduleStore,
  resetMemoryCourseScheduleStore,
} from "./memory-course-schedule-store.ts";
export { SqlCourseScheduleStore } from "./sql/sql-course-schedule-store.ts";
export type { SchoolYearStore } from "./school-year-types.ts";
export type { SchoolCatalogStore } from "./school-catalog-types.ts";
export type { TeacherAccountStore } from "./teacher-account-types.ts";
export type { TeacherSetupStore } from "./teacher-setup-types.ts";
export type { TeacherNotesStore } from "./teacher-notes-types.ts";
export {
  MemoryTeacherAccountStore,
  getMemoryTeacherAccountStore,
  resetMemoryTeacherAccountStore,
} from "./memory-teacher-account-store.ts";
export { SqlTeacherAccountStore } from "./sql/sql-teacher-account-store.ts";
export {
  MemoryTeacherSetupStore,
  getMemoryTeacherSetupStore,
  resetMemoryTeacherSetupStore,
} from "./memory-teacher-setup-store.ts";
export { SqlTeacherSetupStore } from "./sql/sql-teacher-setup-store.ts";
export {
  MemoryTeacherNotesStore,
  getMemoryTeacherNotesStore,
  resetMemoryTeacherNotesStore,
} from "./memory-teacher-notes-store.ts";
export { SqlTeacherNotesStore } from "./sql/sql-teacher-notes-store.ts";
export {
  describeBootstrapOutcome,
  ensureTeacherAccountBootstrap,
  type BootstrapOutcome,
} from "./teacher-account-bootstrap.ts";
export { MemorySchoolYearStore, resetMemorySchoolYearStore } from "./memory-school-year-store.ts";
export { SqlSchoolYearStore } from "./sql/sql-school-year-store.ts";
export { createNodeSqliteDatabase } from "./sql/adapters.ts";
export { applyMigrations } from "./sql/migrate.ts";
export { seedDemoDatabase } from "./sql/seed.ts";
