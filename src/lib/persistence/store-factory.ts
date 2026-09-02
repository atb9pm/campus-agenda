import type { CampusBackupRestoreResult, CampusBackupSnapshot } from "./campus-backup.ts";
import { exportCampusSnapshot, restoreCampusSnapshot } from "./campus-backup.ts";
import type { AgendaStore, StoreKind, TemplateStore } from "./types.ts";
import { createNodeSqliteDatabase, wrapD1Database } from "./sql/adapters.ts";
import { applyMigrations, isDatabaseSeeded } from "./sql/migrate.ts";
import { seedDemoDatabase } from "./sql/seed.ts";
import { SqlAgendaStore, classroomExistsInDatabase, listClassroomsInDatabase, listStudentAccessesInDatabase, resolveClassroomSubjectNamesInDatabase } from "./sql/sql-agenda-store.ts";
import type { RuntimeAgendaAdapterStore, RuntimeClassroomListItem } from "./runtime-agenda-types.ts";
import { getMemoryRuntimeAgendaAdapterStore } from "./memory-runtime-adapter-store.ts";
import { SqlRuntimeAgendaAdapterStore } from "./sql/sql-runtime-adapter-store.ts";
import { SqlTemplateStore } from "./sql/sql-template-store.ts";
import { SqlSchoolYearStore, hydrateActiveSchoolCalendar } from "./sql/sql-school-year-store.ts";
import { getMemoryAgendaStore } from "./memory-store.ts";
import { getMemoryTemplateStore } from "./memory-template-store.ts";
import { getMemoryTimetableStore } from "./memory-timetable-store.ts";
import { SqlTimetableStore } from "./sql/sql-timetable-store.ts";
import type { TimetableStore } from "./timetable-types.ts";
import { classroomExists as memoryClassroomExists, listRuntimeClassrooms as memoryListRuntimeClassrooms, listStudentAccesses as memoryListStudentAccesses, resolveClassroomSubjectNames as memoryResolveClassroomSubjectNames } from "./memory-store.ts";
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
import {
  getMemoryAnnualCourseNotesStore,
  getMemoryPedagogicalPathStore,
  MemoryAnnualCourseNotesStore,
  MemoryPedagogicalPathStore,
  resetMemoryPedagogicalPathStore,
} from "./memory-pedagogical-path-store.ts";
import { SqlAnnualCourseNotesStore, SqlPedagogicalPathStore } from "./sql/sql-pedagogical-path-store.ts";
import type { AnnualCourseNotesStore, PedagogicalPathStore } from "./pedagogical-path-types.ts";
import type { AnnualCourseStore } from "./annual-course-types.ts";
import { getMemoryAnnualCourseStore, MemoryAnnualCourseStore } from "./memory-annual-course-store.ts";
import { SqlAnnualCourseStore } from "./sql/sql-annual-course-store.ts";
import type { CourseScheduleStore } from "./course-schedule-types.ts";
import { getMemoryCourseScheduleStore, MemoryCourseScheduleStore } from "./memory-course-schedule-store.ts";
import { SqlCourseScheduleStore } from "./sql/sql-course-schedule-store.ts";

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
  pedagogicalPathStore: PedagogicalPathStore;
  annualCourseNotesStore: AnnualCourseNotesStore;
  annualCourseStore: AnnualCourseStore;
  courseScheduleStore: CourseScheduleStore;
  kind: StoreKind;
  sqlDb: import("./sql/types.ts").SqlDatabase | null;
  classroomExists: (classroomId: string) => Promise<boolean>;
  adapters: RuntimeAgendaAdapterStore;
  listRuntimeClassrooms: () => Promise<RuntimeClassroomListItem[]>;
  listStudentAccesses: () => Promise<Array<{ classroomId: string }>>;
  resolveClassroomSubjectNames: (
    classroomId: string,
    subjectId: string,
  ) => Promise<{ classroomName: string | null; subjectName: string | null }>;
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
  pedagogicalPathStore: SqlPedagogicalPathStore;
  annualCourseNotesStore: SqlAnnualCourseNotesStore;
  annualCourseStore: SqlAnnualCourseStore;
  courseScheduleStore: SqlCourseScheduleStore;
}> {
  await applyMigrations(db);
  if (!(await isDatabaseSeeded(db))) {
    await seedDemoDatabase(db);
  }
  const weeks = await hydrateActiveSchoolCalendar(db);
  setActiveSchoolWeekEntries(weeks);
  const schoolYearStore = new SqlSchoolYearStore(db);
  const schoolCatalogStore = new SqlSchoolCatalogStore(db);
  await schoolCatalogStore.ensureSeeded();
  await schoolCatalogStore.applySchoolYearBackfill(await schoolYearStore.listSchoolYears());
  const teacherAccountStore = new SqlTeacherAccountStore(db);
  await bootstrapTeacherAccounts(teacherAccountStore);
  return {
    schoolYearStore,
    schoolCatalogStore,
    teacherAccountStore,
    teacherSetupStore: new SqlTeacherSetupStore(db),
    teacherNotesStore: new SqlTeacherNotesStore(db),
    pedagogicalPathStore: new SqlPedagogicalPathStore(db),
    annualCourseNotesStore: new SqlAnnualCourseNotesStore(db),
    annualCourseStore: new SqlAnnualCourseStore(db),
    courseScheduleStore: new SqlCourseScheduleStore(db),
  };
}

async function prepareMemoryStores(): Promise<{
  schoolYearStore: MemorySchoolYearStore;
  schoolCatalogStore: MemorySchoolCatalogStore;
  teacherAccountStore: MemoryTeacherAccountStore;
  teacherSetupStore: MemoryTeacherSetupStore;
  teacherNotesStore: MemoryTeacherNotesStore;
  pedagogicalPathStore: MemoryPedagogicalPathStore;
  annualCourseNotesStore: MemoryAnnualCourseNotesStore;
  annualCourseStore: MemoryAnnualCourseStore;
  courseScheduleStore: MemoryCourseScheduleStore;
}> {
  const weeks = await hydrateMemorySchoolCalendar();
  setActiveSchoolWeekEntries(weeks);
  const schoolYearStore = new MemorySchoolYearStore();
  await schoolYearStore.seedDefaultActiveYearIfEmpty();
  const schoolCatalogStore = getMemorySchoolCatalogStore();
  await schoolCatalogStore.ensureSeeded();
  await schoolCatalogStore.applySchoolYearBackfill(await schoolYearStore.listSchoolYears());
  const teacherAccountStore = getMemoryTeacherAccountStore();
  await bootstrapTeacherAccounts(teacherAccountStore);
  return {
    schoolYearStore,
    schoolCatalogStore,
    teacherAccountStore,
    teacherSetupStore: getMemoryTeacherSetupStore(),
    teacherNotesStore: getMemoryTeacherNotesStore(),
    pedagogicalPathStore: getMemoryPedagogicalPathStore(),
    annualCourseNotesStore: getMemoryAnnualCourseNotesStore(),
    annualCourseStore: getMemoryAnnualCourseStore(),
    courseScheduleStore: getMemoryCourseScheduleStore(),
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
      pedagogicalPathStore,
      annualCourseNotesStore,
      annualCourseStore,
      courseScheduleStore,
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
      pedagogicalPathStore,
      annualCourseNotesStore,
      annualCourseStore,
      courseScheduleStore,
      kind: "memory",
      sqlDb: null,
      adapters: getMemoryRuntimeAgendaAdapterStore(),
      classroomExists: memoryClassroomExists,
      listRuntimeClassrooms: memoryListRuntimeClassrooms,
      listStudentAccesses: memoryListStudentAccesses,
      resolveClassroomSubjectNames: memoryResolveClassroomSubjectNames,
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
      pedagogicalPathStore,
      annualCourseNotesStore,
      annualCourseStore,
      courseScheduleStore,
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
      pedagogicalPathStore,
      annualCourseNotesStore,
      annualCourseStore,
      courseScheduleStore,
      kind: "sqlite",
      sqlDb: sqlite,
      adapters: new SqlRuntimeAgendaAdapterStore(sqlite),
      classroomExists: (classroomId) => classroomExistsInDatabase(sqlite, classroomId),
      listRuntimeClassrooms: () => listClassroomsInDatabase(sqlite),
      listStudentAccesses: () => listStudentAccessesInDatabase(sqlite),
      resolveClassroomSubjectNames: (classroomId, subjectId) =>
        resolveClassroomSubjectNamesInDatabase(sqlite, classroomId, subjectId),
    };
  }

  try {
    const { env } = await import("cloudflare:workers");
    if (env.CAMPUS_DB) {
      const db = wrapD1Database(env.CAMPUS_DB);
      const {
        schoolYearStore,
        schoolCatalogStore,
        teacherAccountStore,
        teacherSetupStore,
        teacherNotesStore,
        pedagogicalPathStore,
        annualCourseNotesStore,
        annualCourseStore,
        courseScheduleStore,
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
        pedagogicalPathStore,
        annualCourseNotesStore,
        annualCourseStore,
        courseScheduleStore,
        kind: "d1",
        sqlDb: db,
        adapters: new SqlRuntimeAgendaAdapterStore(db),
        classroomExists: (classroomId) => classroomExistsInDatabase(db, classroomId),
        listRuntimeClassrooms: () => listClassroomsInDatabase(db),
        listStudentAccesses: () => listStudentAccessesInDatabase(db),
        resolveClassroomSubjectNames: (classroomId, subjectId) =>
          resolveClassroomSubjectNamesInDatabase(db, classroomId, subjectId),
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
    pedagogicalPathStore,
    annualCourseNotesStore,
    annualCourseStore,
    courseScheduleStore,
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
    pedagogicalPathStore,
    annualCourseNotesStore,
    annualCourseStore,
    courseScheduleStore,
    kind: "memory",
    sqlDb: null,
    adapters: getMemoryRuntimeAgendaAdapterStore(),
    classroomExists: memoryClassroomExists,
    listRuntimeClassrooms: memoryListRuntimeClassrooms,
    listStudentAccesses: memoryListStudentAccesses,
    resolveClassroomSubjectNames: memoryResolveClassroomSubjectNames,
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

export async function getPedagogicalPathStore(): Promise<PedagogicalPathStore> {
  return (await resolveAgendaStore()).pedagogicalPathStore;
}

export async function getAnnualCourseNotesStore(): Promise<AnnualCourseNotesStore> {
  return (await resolveAgendaStore()).annualCourseNotesStore;
}

export async function getAnnualCourseStore(): Promise<AnnualCourseStore> {
  return (await resolveAgendaStore()).annualCourseStore;
}

export async function getCourseScheduleStore(): Promise<CourseScheduleStore> {
  return (await resolveAgendaStore()).courseScheduleStore;
}

export async function getStoreKind(): Promise<StoreKind> {
  return (await resolveAgendaStore()).kind;
}

export async function checkClassroomExists(classroomId: string): Promise<boolean> {
  const resolved = await resolveAgendaStore();
  return resolved.classroomExists(classroomId);
}

export async function getRuntimeAgendaAdapterStore(): Promise<RuntimeAgendaAdapterStore> {
  return (await resolveAgendaStore()).adapters;
}

export async function listRuntimeClassrooms(): Promise<RuntimeClassroomListItem[]> {
  const resolved = await resolveAgendaStore();
  return resolved.listRuntimeClassrooms();
}

export async function listStudentAccesses(): Promise<Array<{ classroomId: string }>> {
  const resolved = await resolveAgendaStore();
  return resolved.listStudentAccesses();
}

export async function exportStoreSnapshot(): Promise<CampusBackupSnapshot> {
  const resolved = await resolveAgendaStore();
  return exportCampusSnapshot({
    agenda: resolved.store,
    teacherSetups: resolved.teacherSetupStore,
    teacherNotes: resolved.teacherNotesStore,
    teacherAccounts: resolved.teacherAccountStore,
    catalog: resolved.schoolCatalogStore,
    years: resolved.schoolYearStore,
    courses: resolved.annualCourseStore,
    schedules: resolved.courseScheduleStore,
    memberships: resolved.membershipStore,
    paths: resolved.pedagogicalPathStore,
    courseNotes: resolved.annualCourseNotesStore,
    templates: resolved.templateStore,
    timetable: resolved.timetableStore,
    sqlDb: resolved.sqlDb,
  });
}

export async function restoreStoreSnapshot(payload: unknown): Promise<CampusBackupRestoreResult> {
  const resolved = await resolveAgendaStore();
  return restoreCampusSnapshot(
    {
      agenda: resolved.store,
      teacherSetups: resolved.teacherSetupStore,
      teacherNotes: resolved.teacherNotesStore,
      teacherAccounts: resolved.teacherAccountStore,
      catalog: resolved.schoolCatalogStore,
      years: resolved.schoolYearStore,
      courses: resolved.annualCourseStore,
      schedules: resolved.courseScheduleStore,
      memberships: resolved.membershipStore,
      paths: resolved.pedagogicalPathStore,
      courseNotes: resolved.annualCourseNotesStore,
      templates: resolved.templateStore,
      timetable: resolved.timetableStore,
      sqlDb: resolved.sqlDb,
    },
    payload,
  );
}


export async function resolveClassroomSubjectNames(
  classroomId: string,
  subjectId: string,
): Promise<{ classroomName: string | null; subjectName: string | null }> {
  const resolved = await resolveAgendaStore();
  return resolved.resolveClassroomSubjectNames(classroomId, subjectId);
}
