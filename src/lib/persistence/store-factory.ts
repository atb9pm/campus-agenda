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
import { getMemoryTimetableStore } from "./memory-timetable-store.ts";
import { SqlTimetableStore } from "./sql/sql-timetable-store.ts";
import type { TimetableStore } from "./timetable-types.ts";
import { classroomExists as memoryClassroomExists } from "./memory-store.ts";
import { MemorySchoolYearStore, hydrateMemorySchoolCalendar } from "./memory-school-year-store.ts";
import { MemoryMembershipStore } from "./memory-membership-store.ts";
import { SqlMembershipStore } from "./sql/sql-membership-store.ts";
import type { SchoolYearStore } from "./school-year-types.ts";
import type { MembershipStore } from "./membership-types.ts";
import type { SchoolCatalogStore } from "./school-catalog-types.ts";
import { getMemorySchoolCatalogStore, MemorySchoolCatalogStore } from "./memory-school-catalog-store.ts";
import { SqlSchoolCatalogStore } from "./sql/sql-school-catalog-store.ts";
import { getMemoryTeacherAccountStore, MemoryTeacherAccountStore } from "./memory-teacher-account-store.ts";
import { SqlTeacherAccountStore } from "./sql/sql-teacher-account-store.ts";
import type { TeacherAccountStore } from "./teacher-account-types.ts";
import { describeBootstrapOutcome, ensureTeacherAccountBootstrap } from "./teacher-account-bootstrap.ts";
import { getMemoryTeacherSetupStore, MemoryTeacherSetupStore } from "./memory-teacher-setup-store.ts";
import { SqlTeacherSetupStore } from "./sql/sql-teacher-setup-store.ts";
import type { TeacherSetupStore } from "./teacher-setup-types.ts";
import { getMemoryTeacherNotesStore, MemoryTeacherNotesStore } from "./memory-teacher-notes-store.ts";
import { SqlTeacherNotesStore } from "./sql/sql-teacher-notes-store.ts";
import type { TeacherNotesStore } from "./teacher-notes-types.ts";
import { setActiveSchoolWeekEntries } from "../../features/calendar/active-calendar.ts";

export { APP_VERSION } from "../app-version.ts";

interface ResolvedStore {
  store: AgendaStore;
  templateStore: TemplateStore;
  timetableStore: TimetableStore;
  schoolYearStore: SchoolYearStore;
  membershipStore: MembershipStore;
  schoolCatalogStore: SchoolCatalogStore;
  teacherAccountStore: TeacherAccountStore;
  teacherSetupStore: TeacherSetupStore;
  teacherNotesStore: TeacherNotesStore;
  kind: StoreKind;
  classroomExists: (classroomId: string) => Promise<boolean>;
}

let resolvedStorePromise: Promise<ResolvedStore> | null = null;

export function resetStoreFactory(): void {
  resolvedStorePromise = null;
}

/** Amorçage de l'accès administrateur, journalisé une seule fois au démarrage. */
async function bootstrapTeacherAccounts(teacherAccountStore: TeacherAccountStore): Promise<void> {
  const outcome = await ensureTeacherAccountBootstrap(teacherAccountStore);
  const message = describeBootstrapOutcome(outcome);
  if (message) console.warn(message);
}

async function prepareSqlDatabase(
  db: Awaited<ReturnType<typeof createNodeSqliteDatabase>> | ReturnType<typeof wrapD1Database>,
): Promise<{
  schoolYearStore: SqlSchoolYearStore;
  schoolCatalogStore: SqlSchoolCatalogStore;
  teacherAccountStore: SqlTeacherAccountStore;
  teacherSetupStore: SqlTeacherSetupStore;
  teacherNotesStore: SqlTeacherNotesStore;
}> {
  await applyMigrations(db);
  if (!(await isDatabaseSeeded(db))) {
    await seedDemoDatabase(db);
  }
  const weeks = await hydrateActiveSchoolCalendar(db);
  setActiveSchoolWeekEntries(weeks);
  const schoolCatalogStore = new SqlSchoolCatalogStore(db);
  await schoolCatalogStore.ensureSeeded();
  const teacherAccountStore = new SqlTeacherAccountStore(db);
  await bootstrapTeacherAccounts(teacherAccountStore);
  return {
    schoolYearStore: new SqlSchoolYearStore(db),
    schoolCatalogStore,
    teacherAccountStore,
    teacherSetupStore: new SqlTeacherSetupStore(db),
    teacherNotesStore: new SqlTeacherNotesStore(db),
  };
}

async function prepareMemoryStores(): Promise<{
  schoolYearStore: MemorySchoolYearStore;
  schoolCatalogStore: MemorySchoolCatalogStore;
  teacherAccountStore: MemoryTeacherAccountStore;
  teacherSetupStore: MemoryTeacherSetupStore;
  teacherNotesStore: MemoryTeacherNotesStore;
}> {
  const weeks = await hydrateMemorySchoolCalendar();
  setActiveSchoolWeekEntries(weeks);
  const schoolCatalogStore = getMemorySchoolCatalogStore();
  await schoolCatalogStore.ensureSeeded();
  const teacherAccountStore = getMemoryTeacherAccountStore();
  await bootstrapTeacherAccounts(teacherAccountStore);
  return {
    schoolYearStore: new MemorySchoolYearStore(),
    schoolCatalogStore,
    teacherAccountStore,
    teacherSetupStore: getMemoryTeacherSetupStore(),
    teacherNotesStore: getMemoryTeacherNotesStore(),
  };
}

async function createStore(): Promise<ResolvedStore> {
  if (process.env.CAMPUS_STORE === "memory") {
    const {
      schoolYearStore,
      schoolCatalogStore,
      teacherAccountStore,
      teacherSetupStore,
      teacherNotesStore,
    } = await prepareMemoryStores();
    return {
      store: getMemoryAgendaStore(),
      templateStore: getMemoryTemplateStore(),
      timetableStore: getMemoryTimetableStore(),
      schoolYearStore,
      membershipStore: new MemoryMembershipStore(),
      schoolCatalogStore,
      teacherAccountStore,
      teacherSetupStore,
      teacherNotesStore,
      kind: "memory",
      classroomExists: memoryClassroomExists,
    };
  }

  if (process.env.CAMPUS_STORE === "sqlite" || process.env.CAMPUS_SQLITE_PATH) {
    const sqlite = createNodeSqliteDatabase(process.env.CAMPUS_SQLITE_PATH ?? ":memory:");
    const {
      schoolYearStore,
      schoolCatalogStore,
      teacherAccountStore,
      teacherSetupStore,
      teacherNotesStore,
    } = await prepareSqlDatabase(sqlite);
    const store = new SqlAgendaStore(sqlite);
    return {
      store,
      templateStore: new SqlTemplateStore(sqlite, store),
      timetableStore: new SqlTimetableStore(sqlite),
      schoolYearStore,
      membershipStore: new SqlMembershipStore(sqlite),
      schoolCatalogStore,
      teacherAccountStore,
      teacherSetupStore,
      teacherNotesStore,
      kind: "sqlite",
      classroomExists: (classroomId) => classroomExistsInDatabase(sqlite, classroomId),
    };
  }

  try {
    const { env } = await import("cloudflare:workers") as { env: { CAMPUS_DB?: D1Database } };
    if (env.CAMPUS_DB) {
      const db = wrapD1Database(env.CAMPUS_DB);
      const {
        schoolYearStore,
        schoolCatalogStore,
        teacherAccountStore,
        teacherSetupStore,
        teacherNotesStore,
      } = await prepareSqlDatabase(db);
      const store = new SqlAgendaStore(db);
      return {
        store,
        templateStore: new SqlTemplateStore(db, store),
        timetableStore: new SqlTimetableStore(db),
        schoolYearStore,
        membershipStore: new SqlMembershipStore(db),
        schoolCatalogStore,
        teacherAccountStore,
        teacherSetupStore,
        teacherNotesStore,
        kind: "d1",
        classroomExists: (classroomId) => classroomExistsInDatabase(db, classroomId),
      };
    }
  } catch {
    // Hors worker Cloudflare : repli mémoire.
  }

  const {
    schoolYearStore,
    schoolCatalogStore,
    teacherAccountStore,
    teacherSetupStore,
    teacherNotesStore,
  } = await prepareMemoryStores();
  return {
    store: getMemoryAgendaStore(),
    templateStore: getMemoryTemplateStore(),
    timetableStore: getMemoryTimetableStore(),
    schoolYearStore,
    membershipStore: new MemoryMembershipStore(),
    schoolCatalogStore,
    teacherAccountStore,
    teacherSetupStore,
    teacherNotesStore,
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

export async function getTimetableStore(): Promise<TimetableStore> {
  return (await resolveAgendaStore()).timetableStore;
}

export async function getMembershipStore(): Promise<MembershipStore> {
  return (await resolveAgendaStore()).membershipStore;
}

export async function getSchoolYearStore(): Promise<SchoolYearStore> {
  return (await resolveAgendaStore()).schoolYearStore;
}

export async function getSchoolCatalogStore(): Promise<SchoolCatalogStore> {
  return (await resolveAgendaStore()).schoolCatalogStore;
}

export async function getTeacherAccountStore(): Promise<TeacherAccountStore> {
  return (await resolveAgendaStore()).teacherAccountStore;
}

export async function getTeacherSetupStore(): Promise<TeacherSetupStore> {
  return (await resolveAgendaStore()).teacherSetupStore;
}

export async function getTeacherNotesStore(): Promise<TeacherNotesStore> {
  return (await resolveAgendaStore()).teacherNotesStore;
}

export async function getStoreKind(): Promise<StoreKind> {
  return (await resolveAgendaStore()).kind;
}

export async function checkClassroomExists(classroomId: string): Promise<boolean> {
  const resolved = await resolveAgendaStore();
  return resolved.classroomExists(classroomId);
}

export async function exportStoreSnapshot(): Promise<AgendaBackupSnapshot> {
  const resolved = await resolveAgendaStore();
  return exportAgendaSnapshot({
    agenda: resolved.store,
    teacherSetups: resolved.teacherSetupStore,
    teacherNotes: resolved.teacherNotesStore,
  });
}

export async function restoreStoreSnapshot(payload: unknown): Promise<BackupRestoreResult> {
  const resolved = await resolveAgendaStore();
  return restoreAgendaSnapshot(
    {
      agenda: resolved.store,
      teacherSetups: resolved.teacherSetupStore,
      teacherNotes: resolved.teacherNotesStore,
    },
    payload,
  );
}
