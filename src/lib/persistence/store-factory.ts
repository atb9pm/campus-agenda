import type { AgendaBackupSnapshot, BackupRestoreResult } from "./backup.ts";
import { exportAgendaSnapshot, restoreAgendaSnapshot } from "./backup.ts";
import type { AgendaStore, StoreKind, TemplateStore } from "./types.ts";
import { createNodeSqliteDatabase, wrapD1Database } from "./sql/adapters.ts";
import { applyMigrations, isDatabaseSeeded } from "./sql/migrate.ts";
import { seedDemoDatabase } from "./sql/seed.ts";
import { SqlAgendaStore, classroomExistsInDatabase } from "./sql/sql-agenda-store.ts";
import { SqlTemplateStore } from "./sql/sql-template-store.ts";
import { SqlSchoolYearStore, hydrateActiveSchoolCalendar } from "./sql/sql-school-year-store.ts";
import { getMemoryAgendaStore } from "./memory-store.ts";
import { getMemoryTemplateStore } from "./memory-template-store.ts";
import { classroomExists as memoryClassroomExists } from "./memory-store.ts";
import { MemorySchoolYearStore, hydrateMemorySchoolCalendar } from "./memory-school-year-store.ts";
import type { SchoolYearStore } from "./school-year-types.ts";
import { setActiveSchoolWeekEntries } from "../../features/calendar/active-calendar.ts";

export const APP_VERSION = "1.2.0";

interface ResolvedStore {
  store: AgendaStore;
  templateStore: TemplateStore;
  schoolYearStore: SchoolYearStore;
  kind: StoreKind;
  classroomExists: (classroomId: string) => Promise<boolean>;
}

let resolvedStorePromise: Promise<ResolvedStore> | null = null;

export function resetStoreFactory(): void {
  resolvedStorePromise = null;
}

async function prepareSqlDatabase(
  db: Awaited<ReturnType<typeof createNodeSqliteDatabase>> | ReturnType<typeof wrapD1Database>,
): Promise<SqlSchoolYearStore> {
  await applyMigrations(db);
  if (!(await isDatabaseSeeded(db))) {
    await seedDemoDatabase(db);
  }
  const weeks = await hydrateActiveSchoolCalendar(db);
  setActiveSchoolWeekEntries(weeks);
  return new SqlSchoolYearStore(db);
}

async function prepareMemoryStores(): Promise<{ schoolYearStore: MemorySchoolYearStore }> {
  const weeks = await hydrateMemorySchoolCalendar();
  setActiveSchoolWeekEntries(weeks);
  return { schoolYearStore: new MemorySchoolYearStore() };
}

async function createStore(): Promise<ResolvedStore> {
  if (process.env.CAMPUS_STORE === "memory") {
    const { schoolYearStore } = await prepareMemoryStores();
    return {
      store: getMemoryAgendaStore(),
      templateStore: getMemoryTemplateStore(),
      schoolYearStore,
      kind: "memory",
      classroomExists: memoryClassroomExists,
    };
  }

  if (process.env.CAMPUS_STORE === "sqlite" || process.env.CAMPUS_SQLITE_PATH) {
    const sqlite = createNodeSqliteDatabase(process.env.CAMPUS_SQLITE_PATH ?? ":memory:");
    const schoolYearStore = await prepareSqlDatabase(sqlite);
    const store = new SqlAgendaStore(sqlite);
    return {
      store,
      templateStore: new SqlTemplateStore(sqlite, store),
      schoolYearStore,
      kind: "sqlite",
      classroomExists: (classroomId) => classroomExistsInDatabase(sqlite, classroomId),
    };
  }

  try {
    const { env } = await import("cloudflare:workers") as { env: { CAMPUS_DB?: D1Database } };
    if (env.CAMPUS_DB) {
      const db = wrapD1Database(env.CAMPUS_DB);
      const schoolYearStore = await prepareSqlDatabase(db);
      const store = new SqlAgendaStore(db);
      return {
        store,
        templateStore: new SqlTemplateStore(db, store),
        schoolYearStore,
        kind: "d1",
        classroomExists: (classroomId) => classroomExistsInDatabase(db, classroomId),
      };
    }
  } catch {
    // Hors worker Cloudflare : repli mémoire.
  }

  const { schoolYearStore } = await prepareMemoryStores();
  return {
    store: getMemoryAgendaStore(),
    templateStore: getMemoryTemplateStore(),
    schoolYearStore,
    kind: "memory",
    classroomExists: memoryClassroomExists,
  };
}

interface D1Database {
  prepare(query: string): {
    bind(...values: unknown[]): {
      all<T>(): Promise<{ results: T[] }>;
      first<T>(): Promise<T | null>;
      run(): Promise<{ success: boolean; meta?: { last_row_id?: number; changes?: number } }>;
    };
  };
  exec(query: string): Promise<unknown>;
}

export async function resolveAgendaStore(): Promise<ResolvedStore> {
  resolvedStorePromise ??= createStore();
  return resolvedStorePromise;
}

export async function getAgendaStore(): Promise<AgendaStore> {
  return (await resolveAgendaStore()).store;
}

export async function getTemplateStore(): Promise<TemplateStore> {
  return (await resolveAgendaStore()).templateStore;
}

export async function getSchoolYearStore(): Promise<SchoolYearStore> {
  return (await resolveAgendaStore()).schoolYearStore;
}

export async function getStoreKind(): Promise<StoreKind> {
  return (await resolveAgendaStore()).kind;
}

export async function checkClassroomExists(classroomId: string): Promise<boolean> {
  const resolved = await resolveAgendaStore();
  return resolved.classroomExists(classroomId);
}

export async function exportStoreSnapshot(store: AgendaStore): Promise<AgendaBackupSnapshot> {
  return exportAgendaSnapshot(store);
}

export async function restoreStoreSnapshot(store: AgendaStore, payload: unknown): Promise<BackupRestoreResult> {
  return restoreAgendaSnapshot(store, payload);
}
