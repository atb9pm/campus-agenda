import type { AgendaBackupSnapshot, BackupRestoreResult } from "./backup.ts";
import { exportAgendaSnapshot, restoreAgendaSnapshot } from "./backup.ts";
import type { AgendaStore, StoreKind } from "./types.ts";
import { createNodeSqliteDatabase, wrapD1Database } from "./sql/adapters.ts";
import { applyMigrations, isDatabaseSeeded } from "./sql/migrate.ts";
import { seedDemoDatabase } from "./sql/seed.ts";
import { SqlAgendaStore, classroomExistsInDatabase } from "./sql/sql-agenda-store.ts";
import { getMemoryAgendaStore } from "./memory-store.ts";
import { classroomExists as memoryClassroomExists } from "./memory-store.ts";

export const APP_VERSION = "1.1.0";

interface ResolvedStore {
  store: AgendaStore;
  kind: StoreKind;
  classroomExists: (classroomId: string) => Promise<boolean>;
}

let resolvedStorePromise: Promise<ResolvedStore> | null = null;

export function resetStoreFactory(): void {
  resolvedStorePromise = null;
}

async function prepareSqlDatabase(db: Awaited<ReturnType<typeof createNodeSqliteDatabase>> | ReturnType<typeof wrapD1Database>) {
  await applyMigrations(db);
  if (!(await isDatabaseSeeded(db))) {
    await seedDemoDatabase(db);
  }
}

async function createStore(): Promise<ResolvedStore> {
  if (process.env.CAMPUS_STORE === "memory") {
    return {
      store: getMemoryAgendaStore(),
      kind: "memory",
      classroomExists: memoryClassroomExists,
    };
  }

  if (process.env.CAMPUS_STORE === "sqlite" || process.env.CAMPUS_SQLITE_PATH) {
    const sqlite = createNodeSqliteDatabase(process.env.CAMPUS_SQLITE_PATH ?? ":memory:");
    await prepareSqlDatabase(sqlite);
    const store = new SqlAgendaStore(sqlite);
    return {
      store,
      kind: "sqlite",
      classroomExists: (classroomId) => classroomExistsInDatabase(sqlite, classroomId),
    };
  }

  try {
    const { env } = await import("cloudflare:workers") as { env: { CAMPUS_DB?: D1Database } };
    if (env.CAMPUS_DB) {
      const db = wrapD1Database(env.CAMPUS_DB);
      await prepareSqlDatabase(db);
      const store = new SqlAgendaStore(db);
      return {
        store,
        kind: "d1",
        classroomExists: (classroomId) => classroomExistsInDatabase(db, classroomId),
      };
    }
  } catch {
    // Hors worker Cloudflare : repli mémoire.
  }

  return {
    store: getMemoryAgendaStore(),
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
