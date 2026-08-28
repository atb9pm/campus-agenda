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
  exportAgendaSnapshot,
  restoreAgendaSnapshot,
  type AgendaBackupSnapshot,
  type BackupRestoreResult,
} from "./backup.ts";
export {
  APP_VERSION,
  checkClassroomExists,
  getAgendaStore,
  getSchoolCatalogStore,
  getSchoolYearStore,
  getStoreKind,
  resetStoreFactory,
  resolveAgendaStore,
} from "./store-factory.ts";
export type { SchoolYearStore } from "./school-year-types.ts";
export type { SchoolCatalogStore } from "./school-catalog-types.ts";
export { MemorySchoolYearStore, resetMemorySchoolYearStore } from "./memory-school-year-store.ts";
export { SqlSchoolYearStore } from "./sql/sql-school-year-store.ts";
export { createNodeSqliteDatabase } from "./sql/adapters.ts";
export { applyMigrations } from "./sql/migrate.ts";
export { seedDemoDatabase } from "./sql/seed.ts";
