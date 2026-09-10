import {
  getAgendaStore,
  getAnnualCourseNotesStore,
  getAnnualCourseStore,
  getCourseScheduleStore,
  getMembershipStore,
  getPedagogicalPathStore,
  getRuntimeAgendaAdapterStore,
  getSchoolCatalogStore,
  getStudentAccessStore,
  getTeacherNotesStore,
  getTeacherSetupStore,
  getTimetableStore,
  resolveAgendaStore,
} from "../../lib/persistence/store-factory.ts";
import type { CatalogDeleteSnapshotDeps } from "./snapshot.ts";

export async function loadCatalogDeleteDeps(): Promise<CatalogDeleteSnapshotDeps> {
  const resolved = await resolveAgendaStore();
  return {
    catalog: await getSchoolCatalogStore(),
    courses: await getAnnualCourseStore(),
    notes: await getAnnualCourseNotesStore(),
    paths: await getPedagogicalPathStore(),
    schedules: await getCourseScheduleStore(),
    agenda: await getAgendaStore(),
    adapters: await getRuntimeAgendaAdapterStore(),
    memberships: await getMembershipStore(),
    studentAccesses: await getStudentAccessStore(),
    teacherSetups: await getTeacherSetupStore(),
    teacherNotes: await getTeacherNotesStore(),
    timetable: await getTimetableStore(),
    sqlDb: resolved.sqlDb,
  };
}
