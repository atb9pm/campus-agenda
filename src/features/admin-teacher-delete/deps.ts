import {
  getAgendaStore,
  getAnnualCourseNotesStore,
  getAnnualCourseStore,
  getMembershipStore,
  getTeacherAccountStore,
  getTeacherNotesStore,
  getTeacherSetupStore,
  getTemplateStore,
  resolveAgendaStore,
} from "../../lib/persistence/store-factory.ts";
import type { TeacherDeleteSnapshotDeps } from "./snapshot.ts";

export async function loadTeacherDeleteDeps(): Promise<TeacherDeleteSnapshotDeps> {
  const resolved = await resolveAgendaStore();
  return {
    accounts: await getTeacherAccountStore(),
    courses: await getAnnualCourseStore(),
    agenda: await getAgendaStore(),
    templates: await getTemplateStore(),
    memberships: await getMembershipStore(),
    teacherSetups: await getTeacherSetupStore(),
    teacherNotes: await getTeacherNotesStore(),
    notes: await getAnnualCourseNotesStore(),
    sqlDb: resolved.sqlDb,
  };
}
