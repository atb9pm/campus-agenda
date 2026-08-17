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
  getStoreKind,
  resetStoreFactory,
  resolveAgendaStore,
} from "./store-factory.ts";
export { SqlAgendaStore } from "./sql/sql-agenda-store.ts";
export { createNodeSqliteDatabase } from "./sql/adapters.ts";
export { applyMigrations } from "./sql/migrate.ts";
export { seedDemoDatabase } from "./sql/seed.ts";
