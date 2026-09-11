import { sameInitials, wouldRemoveLastAdmin } from "../teacher-accounts/rules.ts";
import type { TeacherAccountRecord } from "../teacher-accounts/types.ts";
import type { AnnualCourseStore } from "../../lib/persistence/annual-course-types.ts";
import type { MembershipStore } from "../../lib/persistence/membership-types.ts";
import type { TeacherAccountStore } from "../../lib/persistence/teacher-account-types.ts";
import type { TeacherNotesStore } from "../../lib/persistence/teacher-notes-types.ts";
import type { TeacherSetupStore } from "../../lib/persistence/teacher-setup-types.ts";
import type { AgendaStore, TemplateStore } from "../../lib/persistence/types.ts";
import type { AnnualCourseNotesStore } from "../../lib/persistence/pedagogical-path-types.ts";
import type { SqlDatabase } from "../../lib/persistence/sql/types.ts";
import { emptyTeacherDeleteCounts, type TeacherDeletePlan } from "./types.ts";

export interface TeacherDeleteSnapshotDeps {
  accounts: TeacherAccountStore;
  courses: AnnualCourseStore;
  agenda: AgendaStore;
  templates: TemplateStore;
  memberships: MembershipStore;
  teacherSetups: TeacherSetupStore;
  teacherNotes: TeacherNotesStore;
  notes?: AnnualCourseNotesStore;
  sqlDb?: SqlDatabase | null;
}

const PEDAGOGICAL_TYPES = new Set(["HOMEWORK", "TEST", "INFORMATION"]);

export async function buildTeacherDeletePlan(
  deps: TeacherDeleteSnapshotDeps,
  teacherId: string,
): Promise<TeacherDeletePlan | null> {
  const accounts = await deps.accounts.listAccounts();
  const teacher = accounts.find((account) => account.id === teacherId);
  if (!teacher) return null;

  const assignments = (await deps.courses.listAssignments()).filter(
    (entry) => entry.teacherId === teacherId,
  );
  const events = (await deps.courses.listEvents()).filter((entry) => entry.teacherId === teacherId);
  const courses = await deps.courses.listCourses();
  const courseById = new Map(courses.map((course) => [course.id, course]));
  const classIds = [
    ...new Set(
      assignments
        .map((entry) => courseById.get(entry.annualCourseId)?.classId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const annualCourseIds = [...new Set(assignments.map((entry) => entry.annualCourseId))];

  const memberships = (await deps.memberships.listMemberships()).filter(
    (entry) => entry.teacherId === teacherId,
  );
  const templates = await deps.templates.listTemplatesForTeacher(teacherId);
  const setups = await deps.teacherSetups.exportAllSetups();
  const personalNotes = await deps.teacherNotes.exportAllNotes();

  const agendaItems = (await deps.agenda.exportAllItems()).filter(
    (item) => item.authorTeacherId === teacherId,
  );
  const publications = agendaItems.filter((item) => PEDAGOGICAL_TYPES.has(item.type));

  let annualCourseNoteIds: string[] = [];
  if (deps.sqlDb) {
    const { results } = await deps.sqlDb
      .prepare("SELECT id FROM annual_course_notes WHERE author_teacher_id = ?")
      .bind(teacherId)
      .all<{ id: string }>();
    annualCourseNoteIds = results.map((row) => row.id);
  }

  const initialsUnique =
    accounts.filter((account) => sameInitials(account.initials, teacher.initials)).length <= 1;

  return {
    target: {
      id: teacher.id,
      displayName: teacher.displayName,
      initials: teacher.initials,
    },
    confirmationText: initialsUnique ? teacher.initials : teacher.id,
    lastAdminBlocked: isLastUsableAdmin(accounts, teacher),
    counts: {
      ...emptyTeacherDeleteCounts(),
      assignments: assignments.length,
      classes: classIds.length,
      publications: publications.length,
      memberships: memberships.length,
      templates: templates.length,
      personalNotes: personalNotes.filter((entry) => entry.teacherId === teacherId).length,
      setups: setups.filter((entry) => entry.teacherId === teacherId).length,
      annualCourseNotes: annualCourseNoteIds.length,
    },
    assignmentIds: assignments.map((entry) => entry.id),
    assignmentEventIds: events.map((entry) => entry.id),
    membershipIds: memberships.map((entry) => entry.id),
    publicationIds: publications.map((item) => item.id),
    templateIds: templates.map((entry) => entry.id),
    annualCourseNoteIds,
    annualCourseIds,
    classIds,
  };
}

function isLastUsableAdmin(accounts: TeacherAccountRecord[], teacher: TeacherAccountRecord): boolean {
  if (!teacher.isAdmin) return false;
  return wouldRemoveLastAdmin(accounts, teacher.id, {
    isAdmin: false,
    isActive: false,
    isArchived: true,
  });
}
