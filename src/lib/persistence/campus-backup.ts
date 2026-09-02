import type { AgendaStore } from "./types.ts";
import type { TeacherAccountStore } from "./teacher-account-types.ts";
import type { TeacherSetupStore } from "./teacher-setup-types.ts";
import type { TeacherNotesStore } from "./teacher-notes-types.ts";
import type { SchoolCatalogStore } from "./school-catalog-types.ts";
import type { SchoolYearStore } from "./school-year-types.ts";
import type { AnnualCourseStore } from "./annual-course-types.ts";
import type { CourseScheduleStore } from "./course-schedule-types.ts";
import type { MembershipStore } from "./membership-types.ts";
import type { AnnualCourseNotesStore, PedagogicalPathStore } from "./pedagogical-path-types.ts";
import type { SqlDatabase } from "./sql/types.ts";
import {
  BACKUP_FORMAT_VERSION_V2,
  BACKUP_FORMAT_VERSION as BACKUP_FORMAT_VERSION_V3,
  LEGACY_BACKUP_FORMAT_VERSION,
  exportAgendaSnapshot as exportAgendaSnapshotV3,
  restoreAgendaSnapshot as restoreAgendaSnapshotLegacy,
  type AgendaBackupSnapshot as AgendaBackupSnapshotV3,
  type BackupRestoreResult as LegacyBackupRestoreResult,
  type BackupStoreDeps,
} from "./backup.ts";
import { BACKUP_FORMAT_VERSION_V4, CAMPUS_BACKUP_INSERT_ORDER } from "./campus-backup-tables.ts";
import { dumpCampusTables, restoreCampusTables, validateCampusTables, type CampusTableDump } from "./sql/sql-campus-backup.ts";
import { getMemoryLegacySchool, replaceMemoryLegacySchool } from "./memory-legacy-school.ts";
import { setMemoryMemberships } from "./memory-membership-store.ts";
import { exportMemoryTemplates, replaceMemoryTemplates } from "./memory-template-store.ts";
import {
  exportMemoryTimetableTables,
  replaceMemoryTimetableTables,
} from "./memory-timetable-store.ts";
import { MemorySchoolCatalogStore } from "./memory-school-catalog-store.ts";
import { MemoryAnnualCourseStore } from "./memory-annual-course-store.ts";
import { MemoryCourseScheduleStore } from "./memory-course-schedule-store.ts";
import { MemoryPedagogicalPathStore, MemoryAnnualCourseNotesStore } from "./memory-pedagogical-path-store.ts";
import { replaceMemorySchoolYears } from "./memory-school-year-store.ts";
import type { SchoolYearWithWeeks } from "../../features/school-year/types.ts";
import type { SchoolDayException } from "../../features/school-days/types.ts";
import type { CourseScheduleSlot, ClassAttendanceDay, CourseWeekKind, CourseWeekday, AttendanceRole } from "../../features/course-schedule/types.ts";
import type { AnnualCourse, TeacherCourseAssignment, TeacherCourseAssignmentEvent, AssignmentRole, AssignmentEventKind } from "../../features/annual-courses/types.ts";
import type { PrototypeAgendaItem } from "../../features/agenda/demo-items.ts";
import type { SchoolClassRecord, SchoolBranchRecord } from "../../features/school-catalog/types.ts";
import type { SchoolProfessionRecord, PedagogicalContextRecord } from "../../features/school-catalog/profession-types.ts";
import type { AnnualCourseNote, ReferencePedagogicalPath } from "../../features/pedagogical-path/index.ts";
import type { PublicationTemplate } from "../../features/library/types.ts";
import type { AdminCodeKind } from "../../features/school-catalog/admin-codes.ts";
import type { TemplateStore } from "./types.ts";
import type { TimetableStore } from "./timetable-types.ts";

export const BACKUP_FORMAT_VERSION = BACKUP_FORMAT_VERSION_V4;

export interface CampusBackupSnapshot extends Omit<AgendaBackupSnapshotV3, "version"> {
  version: typeof BACKUP_FORMAT_VERSION_V4;
  tables: CampusTableDump;
}

export type CampusBackupRestoreResult =
  | (LegacyBackupRestoreResult & { restoredTables: boolean })
  | { ok: false; reason: string };

export interface CampusBackupDeps extends BackupStoreDeps {
  sqlDb?: SqlDatabase | null;
  catalog: SchoolCatalogStore;
  years: SchoolYearStore;
  courses: AnnualCourseStore;
  schedules: CourseScheduleStore;
  memberships: MembershipStore;
  paths?: PedagogicalPathStore;
  courseNotes?: AnnualCourseNotesStore;
  /** Memory : dump/restore des modèles. SQL : déjà dans dumpCampusTables. */
  templates?: TemplateStore | null;
  /** Memory : dump/restore horaire. SQL : déjà dans dumpCampusTables. */
  timetable?: TimetableStore | null;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asBool(value: unknown, fallback = false): boolean {
  if (value === true || value === 1 || value === "1") return true;
  if (value === false || value === 0 || value === "0") return false;
  return fallback;
}

function asNullableString(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  return String(value);
}

function emptyDump(): CampusTableDump {
  const dump: CampusTableDump = {};
  for (const table of CAMPUS_BACKUP_INSERT_ORDER) dump[table] = [];
  return dump;
}

function flag01(value: boolean): number {
  return value ? 1 : 0;
}

async function buildMemoryTables(deps: CampusBackupDeps): Promise<CampusTableDump> {
  const dump = emptyDump();
  const [accounts, records, items, setups, notes, classes, branches, professions, contexts, years, courses, assignments, events, slots, attendance, memberships] =
    await Promise.all([
      deps.teacherAccounts.exportAllAccounts(),
      deps.teacherAccounts.listAccounts(),
      deps.agenda.exportAllItems(),
      deps.teacherSetups.exportAllSetups(),
      deps.teacherNotes.exportAllNotes(),
      deps.catalog.listClasses(),
      deps.catalog.listBranches(),
      deps.catalog.listProfessions(),
      deps.catalog.listContexts(),
      deps.years.listSchoolYears(),
      deps.courses.listCourses(),
      deps.courses.listAssignments(),
      deps.courses.listEvents(),
      deps.schedules.listSlots(),
      deps.schedules.listAttendanceDays(),
      deps.memberships.listMemberships(),
    ]);
  const recordById = new Map(records.map((entry) => [entry.id, entry]));
  const legacy = getMemoryLegacySchool();

  dump.teachers = accounts.map((entry) => {
    const live = recordById.get(entry.id);
    return {
      id: entry.id,
      display_name: entry.displayName,
      initials: entry.initials,
      password_hash: entry.passwordHash,
      is_admin: flag01(entry.isAdmin),
      is_active: flag01(entry.isActive),
      must_change_password: flag01(entry.mustChangePassword),
      created_at: entry.createdAt,
      password_updated_at: entry.passwordUpdatedAt,
      archived_at: live?.archivedAt ?? entry.archivedAt ?? null,
      last_login_at: live?.lastLoginAt ?? entry.lastLoginAt ?? null,
      teaching_type: live?.teachingType ?? null,
    };
  });
  dump.classrooms = legacy.classrooms.map((entry) => ({
    id: entry.id,
    name: entry.name,
    program_label: entry.programLabel,
    access_code_hint: entry.accessCodeHint,
    school_class_id: entry.schoolClassId ?? null,
  }));
  dump.subjects = legacy.subjects.map((entry) => ({
    id: entry.id,
    classroom_id: entry.classroomId,
    name: entry.name,
    annual_course_id: entry.annualCourseId ?? null,
  }));
  dump.student_accesses = legacy.studentAccesses.map((entry) => ({
    id: entry.id,
    classroom_id: entry.classroomId,
    label: entry.label,
    access_code_hash: entry.accessCodeHash ?? "",
  }));
  dump.memberships = memberships.map((entry) => ({
    id: entry.id,
    teacher_id: entry.teacherId,
    classroom_id: entry.classroomId,
    valid_from: entry.validFrom ?? null,
    valid_to: entry.validTo ?? null,
  }));
  dump.membership_subjects = memberships.flatMap((entry) =>
    entry.subjectIds.map((subjectId) => ({ membership_id: entry.id, subject_id: subjectId })),
  );
  dump.agenda_items = items.map((item) => ({
    id: item.id,
    classroom_id: item.classroomId,
    subject_id: item.subjectId,
    author_teacher_id: item.authorTeacherId,
    day: item.day,
    hour: item.hour,
    week_offset: item.weekOffset,
    school_week_number: item.schoolWeekNumber,
    type: item.type,
    title: item.title,
    detail: item.detail,
    template_id: item.templateId,
    school_year_id: item.schoolYearId,
    annual_course_id: item.annualCourseId ?? null,
    course_session_key: item.courseSessionKey ?? null,
    course_session_date: item.courseSessionDate ?? null,
    reference_session_id: item.referenceSessionId ?? null,
    reference_item_id: item.referenceItemId ?? null,
  }));

  for (const year of years) {
    dump.school_years!.push({
      id: year.id,
      label: year.label,
      status: year.status,
      starts_on: year.startsOn,
      ends_on: year.endsOn,
      source_filename: year.sourceFilename,
      imported_at: year.importedAt,
      activated_at: year.activatedAt,
      created_at: year.createdAt,
    });
    const full = await deps.years.getSchoolYearById(year.id);
    for (const week of full?.weeks ?? []) {
      dump.school_weeks!.push({
        school_year_id: year.id,
        week_number: week.number,
        week_kind: week.kind,
        monday: week.monday,
      });
    }
    const exceptions = await deps.years.listDayExceptions(year.id);
    for (const exception of exceptions) {
      dump.school_day_exceptions!.push({
        school_year_id: year.id,
        day_date: exception.date,
        day_state: exception.state,
        label: exception.label,
      });
    }
  }

  dump.school_classes = classes.map((entry) => ({
    id: entry.id,
    code: entry.code,
    label: entry.label,
    sort_order: entry.sortOrder,
    is_active: flag01(entry.isActive),
    school_year_id: entry.schoolYearId,
    school_year_label: entry.schoolYearLabel,
    profession_id: entry.professionId,
    training_year: entry.trainingYear,
    parallel_code: entry.parallelCode,
    is_archived: flag01(entry.isArchived),
    archived_at: entry.archivedAt,
  }));
  dump.school_branches = branches.map((entry) => ({
    id: entry.id,
    code: entry.code,
    label: entry.label,
    sort_order: entry.sortOrder,
    is_active: flag01(entry.isActive),
    admin_code: entry.adminCode,
    archived_at: entry.archivedAt,
    teaching_type: entry.teachingType,
  }));
  dump.school_professions = professions.map((entry) => ({
    id: entry.id,
    admin_code: entry.adminCode,
    label: entry.label,
    duration_years: entry.durationYears,
    sort_order: entry.sortOrder,
    is_active: flag01(entry.isActive),
    archived_at: entry.archivedAt,
    class_code_prefix: entry.classCodePrefix,
  }));
  dump.pedagogical_contexts = contexts.map((entry) => ({
    id: entry.id,
    admin_code: entry.adminCode,
    profession_id: entry.professionId,
    training_year: entry.trainingYear,
    branch_id: entry.branchId,
    is_active: flag01(entry.isActive),
    archived_at: entry.archivedAt,
  }));
  dump.annual_courses = courses.map((entry) => ({
    id: entry.id,
    school_year_id: entry.schoolYearId,
    class_id: entry.classId,
    context_id: entry.contextId,
    archived_at: entry.archivedAt,
    created_at: entry.createdAt,
    updated_at: entry.updatedAt,
  }));
  dump.teacher_course_assignments = assignments.map((entry) => ({
    id: entry.id,
    annual_course_id: entry.annualCourseId,
    teacher_id: entry.teacherId,
    role: entry.role,
    valid_from: entry.validFrom,
    valid_to: entry.validTo,
    created_by_admin_id: entry.createdByAdminId,
    created_at: entry.createdAt,
    ended_at: entry.endedAt,
    override_reason: entry.overrideReason,
    override_by_admin_id: entry.overrideByAdminId,
  }));
  dump.teacher_course_assignment_events = events.map((entry) => ({
    id: entry.id,
    annual_course_id: entry.annualCourseId,
    assignment_id: entry.assignmentId,
    teacher_id: entry.teacherId,
    admin_id: entry.adminId,
    kind: entry.kind,
    role: entry.role,
    detail: entry.detail,
    created_at: entry.createdAt,
  }));
  dump.course_schedule_slots = slots.map((entry) => ({
    id: entry.id,
    annual_course_id: entry.annualCourseId,
    day_of_week: entry.dayOfWeek,
    period_start: entry.periodStart,
    period_end: entry.periodEnd,
    week_kind: entry.weekKind,
    valid_from: entry.validFrom,
    valid_to: entry.validTo,
    created_at: entry.createdAt,
    updated_at: entry.updatedAt,
  }));
  dump.class_attendance_days = attendance.map((entry) => ({
    id: entry.id,
    class_id: entry.classId,
    day_of_week: entry.dayOfWeek,
    week_kind: entry.weekKind,
    role: entry.role,
    created_at: entry.createdAt,
    updated_at: entry.updatedAt,
  }));
  dump.teacher_setups = setups.map((entry) => ({
    teacher_id: entry.teacherId,
    config_json: JSON.stringify(entry.config),
  }));
  dump.teacher_notes = notes.map((entry) => ({
    teacher_id: entry.teacherId,
    notes_json: JSON.stringify(entry.document),
  }));

  if (deps.catalog instanceof MemorySchoolCatalogStore) {
    const counters = deps.catalog.getAdminCounters();
    dump.admin_code_counters = (Object.entries(counters) as Array<[AdminCodeKind, number]>).map(([kind, next_value]) => ({
      kind,
      next_value,
    }));
  }

  if (deps.paths) {
    const paths = await deps.paths.listPaths();
    dump.pedagogical_paths = paths.map((path) => ({
      context_id: path.contextId,
      path_json: JSON.stringify(path),
      updated_at: path.updatedAt,
    }));
  }
  if (deps.courseNotes instanceof MemoryAnnualCourseNotesStore) {
    dump.annual_course_notes = deps.courseNotes.exportAllNotes().map((note) => ({
      id: note.id,
      school_year_id: note.schoolYearId,
      class_id: note.classId,
      context_id: note.contextId,
      reference_session_id: note.referenceSessionId,
      author_teacher_id: note.authorTeacherId,
      text: note.text,
      source_note_id: note.sourceNoteId,
      source_school_year_id: note.sourceSchoolYearId,
      inherited_at: note.inheritedAt,
      annual_course_id: note.annualCourseId,
      created_at: note.createdAt,
      updated_at: note.updatedAt,
    }));
  }

  dump.publication_templates = exportMemoryTemplates().map((entry) => ({
    id: entry.id,
    owner_teacher_id: entry.ownerTeacherId,
    title: entry.title,
    detail: entry.detail,
    type: entry.type,
    subject_id: entry.subjectId,
    default_school_week_number: entry.defaultSchoolWeekNumber,
    default_day: entry.defaultDay,
    source_school_year_id: entry.sourceSchoolYearId,
    source_item_id: entry.sourceItemId,
    created_at: entry.createdAt,
    updated_at: entry.updatedAt,
  }));

  const timetable = exportMemoryTimetableTables();
  dump.timetable_imports = timetable.timetable_imports;
  dump.timetable_slots = timetable.timetable_slots;
  dump.timetable_class_mappings = timetable.timetable_class_mappings;
  dump.timetable_teacher_codes = timetable.timetable_teacher_codes;

  return dump;
}

export async function exportCampusSnapshot(deps: CampusBackupDeps): Promise<CampusBackupSnapshot> {
  const base = await exportAgendaSnapshotV3(deps);
  const tables = deps.sqlDb ? await dumpCampusTables(deps.sqlDb) : await buildMemoryTables(deps);
  return {
    ...base,
    version: BACKUP_FORMAT_VERSION_V4,
    tables,
  };
}

function mapSchoolClass(row: Record<string, unknown>): SchoolClassRecord {
  return {
    id: asString(row.id),
    code: asString(row.code),
    label: asString(row.label),
    sortOrder: asNumber(row.sort_order ?? row.sortOrder),
    isActive: asBool(row.is_active ?? row.isActive, true),
    schoolYearId: asNullableString(row.school_year_id ?? row.schoolYearId),
    schoolYearLabel: asNullableString(row.school_year_label ?? row.schoolYearLabel),
    professionId: asNullableString(row.profession_id ?? row.professionId),
    trainingYear: row.training_year == null && row.trainingYear == null ? null : asNumber(row.training_year ?? row.trainingYear),
    parallelCode: asNullableString(row.parallel_code ?? row.parallelCode),
    isArchived: asBool(row.is_archived ?? row.isArchived),
    archivedAt: asNullableString(row.archived_at ?? row.archivedAt),
  };
}

function mapBranch(row: Record<string, unknown>): SchoolBranchRecord {
  const teachingType = row.teaching_type ?? row.teachingType;
  return {
    id: asString(row.id),
    code: asString(row.code),
    label: asString(row.label),
    sortOrder: asNumber(row.sort_order ?? row.sortOrder),
    isActive: asBool(row.is_active ?? row.isActive, true),
    adminCode: asString(row.admin_code ?? row.adminCode),
    isArchived: Boolean(row.archived_at ?? row.archivedAt ?? row.isArchived),
    archivedAt: asNullableString(row.archived_at ?? row.archivedAt),
    teachingType: teachingType === "TECHNICAL" || teachingType === "GENERAL" ? teachingType : null,
  };
}

function mapProfession(row: Record<string, unknown>): SchoolProfessionRecord {
  return {
    id: asString(row.id),
    adminCode: asString(row.admin_code ?? row.adminCode),
    label: asString(row.label),
    classCodePrefix: asNullableString(row.class_code_prefix ?? row.classCodePrefix),
    durationYears: asNumber(row.duration_years ?? row.durationYears, 3),
    sortOrder: asNumber(row.sort_order ?? row.sortOrder),
    isActive: asBool(row.is_active ?? row.isActive, true),
    isArchived: Boolean(row.archived_at ?? row.archivedAt ?? row.isArchived),
    archivedAt: asNullableString(row.archived_at ?? row.archivedAt),
  };
}

function mapContext(row: Record<string, unknown>): PedagogicalContextRecord {
  return {
    id: asString(row.id),
    adminCode: asString(row.admin_code ?? row.adminCode),
    professionId: asString(row.profession_id ?? row.professionId),
    trainingYear: asNumber(row.training_year ?? row.trainingYear, 1),
    branchId: asString(row.branch_id ?? row.branchId),
    isActive: asBool(row.is_active ?? row.isActive, true),
    isArchived: Boolean(row.archived_at ?? row.archivedAt ?? row.isArchived),
    archivedAt: asNullableString(row.archived_at ?? row.archivedAt),
  };
}

function mapAssignment(row: Record<string, unknown>): TeacherCourseAssignment {
  return {
    id: asString(row.id),
    annualCourseId: asString(row.annual_course_id ?? row.annualCourseId),
    teacherId: asString(row.teacher_id ?? row.teacherId),
    role: asString(row.role) as AssignmentRole,
    validFrom: asString(row.valid_from ?? row.validFrom),
    validTo: asNullableString(row.valid_to ?? row.validTo),
    createdByAdminId: asString(row.created_by_admin_id ?? row.createdByAdminId),
    createdAt: asString(row.created_at ?? row.createdAt),
    endedAt: asNullableString(row.ended_at ?? row.endedAt),
    overrideReason: asNullableString(row.override_reason ?? row.overrideReason),
    overrideByAdminId: asNullableString(row.override_by_admin_id ?? row.overrideByAdminId),
  };
}

function mapAssignmentEvent(row: Record<string, unknown>): TeacherCourseAssignmentEvent {
  return {
    id: asString(row.id),
    annualCourseId: asString(row.annual_course_id ?? row.annualCourseId),
    assignmentId: asNullableString(row.assignment_id ?? row.assignmentId),
    teacherId: asString(row.teacher_id ?? row.teacherId),
    adminId: asString(row.admin_id ?? row.adminId),
    kind: asString(row.kind) as AssignmentEventKind,
    role: (row.role == null ? null : asString(row.role)) as AssignmentRole | null,
    detail: asString(row.detail),
    createdAt: asString(row.created_at ?? row.createdAt),
  };
}

function mapAnnualNote(row: Record<string, unknown>): AnnualCourseNote {
  return {
    id: asString(row.id),
    schoolYearId: asString(row.school_year_id ?? row.schoolYearId),
    classId: asString(row.class_id ?? row.classId),
    contextId: asString(row.context_id ?? row.contextId),
    referenceSessionId: asNullableString(row.reference_session_id ?? row.referenceSessionId),
    authorTeacherId: asString(row.author_teacher_id ?? row.authorTeacherId),
    text: asString(row.text),
    sourceNoteId: asNullableString(row.source_note_id ?? row.sourceNoteId),
    sourceSchoolYearId: asNullableString(row.source_school_year_id ?? row.sourceSchoolYearId),
    inheritedAt: asNullableString(row.inherited_at ?? row.inheritedAt),
    annualCourseId: asNullableString(row.annual_course_id ?? row.annualCourseId),
    createdAt: asString(row.created_at ?? row.createdAt),
    updatedAt: asString(row.updated_at ?? row.updatedAt),
  };
}

async function restoreMemoryTables(deps: CampusBackupDeps, dump: CampusTableDump): Promise<void> {
  const teachers = dump.teachers ?? [];
  await deps.teacherAccounts.replaceAllAccounts(
    teachers.map((row) => ({
      id: asString(row.id ?? row.display_name),
      displayName: asString(row.display_name ?? row.displayName),
      initials: asString(row.initials),
      isAdmin: asBool(row.is_admin ?? row.isAdmin),
      isActive: row.is_active === undefined && row.isActive === undefined ? true : asBool(row.is_active ?? row.isActive, true),
      mustChangePassword: asBool(row.must_change_password ?? row.mustChangePassword),
      passwordHash: asString(row.password_hash ?? row.passwordHash),
      createdAt: asNullableString(row.created_at ?? row.createdAt),
      passwordUpdatedAt: asNullableString(row.password_updated_at ?? row.passwordUpdatedAt),
      archivedAt: asNullableString(row.archived_at ?? row.archivedAt),
      lastLoginAt: asNullableString(row.last_login_at ?? row.lastLoginAt),
    })),
  );

  await deps.agenda.replaceAllItems(
    (dump.agenda_items ?? []).map((row) => ({
      id: asNumber(row.id),
      classroomId: asString(row.classroom_id ?? row.classroomId),
      subjectId: asString(row.subject_id ?? row.subjectId),
      authorTeacherId: asString(row.author_teacher_id ?? row.authorTeacherId),
      day: asNumber(row.day),
      hour: asNumber(row.hour),
      weekOffset: asNumber(row.week_offset ?? row.weekOffset),
      schoolWeekNumber: asNumber(row.school_week_number ?? row.schoolWeekNumber),
      type: asString(row.type) as PrototypeAgendaItem["type"],
      title: asString(row.title),
      detail: asString(row.detail),
      templateId: asNullableString(row.template_id ?? row.templateId),
      schoolYearId: asNullableString(row.school_year_id ?? row.schoolYearId),
      annualCourseId: asNullableString(row.annual_course_id ?? row.annualCourseId),
      courseSessionKey: asNullableString(row.course_session_key ?? row.courseSessionKey),
      courseSessionDate: asNullableString(row.course_session_date ?? row.courseSessionDate),
      referenceSessionId: asNullableString(row.reference_session_id ?? row.referenceSessionId),
      referenceItemId: asNullableString(row.reference_item_id ?? row.referenceItemId),
    })),
  );

  replaceMemoryLegacySchool({
    classrooms: (dump.classrooms ?? []).map((row) => ({
      id: asString(row.id),
      name: asString(row.name),
      programLabel: asString(row.program_label ?? row.programLabel),
      accessCodeHint: asString(row.access_code_hint ?? row.accessCodeHint),
      schoolClassId: asNullableString(row.school_class_id ?? row.schoolClassId),
    })),
    subjects: (dump.subjects ?? []).map((row) => ({
      id: asString(row.id),
      classroomId: asString(row.classroom_id ?? row.classroomId),
      name: asString(row.name),
      annualCourseId: asNullableString(row.annual_course_id ?? row.annualCourseId),
    })),
    studentAccesses: (dump.student_accesses ?? []).map((row) => ({
      id: asString(row.id),
      classroomId: asString(row.classroom_id ?? row.classroomId),
      label: asString(row.label),
      accessCodeHash: asNullableString(row.access_code_hash ?? row.accessCodeHash),
    })),
  });

  const membershipSubjects = dump.membership_subjects ?? [];
  setMemoryMemberships(
    (dump.memberships ?? []).map((row) => ({
      id: asString(row.id),
      teacherId: asString(row.teacher_id ?? row.teacherId),
      classroomId: asString(row.classroom_id ?? row.classroomId),
      subjectIds: membershipSubjects
        .filter((entry) => asString(entry.membership_id) === asString(row.id))
        .map((entry) => asString(entry.subject_id)),
      validFrom: asString(row.valid_from ?? row.validFrom, "1970-01-01"),
      validTo: asNullableString(row.valid_to ?? row.validTo),
    })),
  );

  if (deps.catalog instanceof MemorySchoolCatalogStore) {
    const counters: Partial<Record<AdminCodeKind, number>> = {};
    for (const row of dump.admin_code_counters ?? []) {
      const kind = asString(row.kind) as AdminCodeKind;
      if (kind === "PRF" || kind === "BR" || kind === "CTX") {
        counters[kind] = asNumber(row.next_value ?? row.nextValue, 1);
      }
    }
    deps.catalog.replaceSnapshot({
      classes: (dump.school_classes ?? []).map(mapSchoolClass),
      branches: (dump.school_branches ?? []).map(mapBranch),
      professions: (dump.school_professions ?? []).map(mapProfession),
      contexts: (dump.pedagogical_contexts ?? []).map(mapContext),
      counters: Object.keys(counters).length
        ? { PRF: counters.PRF ?? 1, BR: counters.BR ?? 1, CTX: counters.CTX ?? 1 }
        : undefined,
    });
  }

  const years: SchoolYearWithWeeks[] = (dump.school_years ?? []).map((row) => {
    const id = asString(row.id);
    return {
      id,
      label: asString(row.label),
      status: asString(row.status) as SchoolYearWithWeeks["status"],
      startsOn: asString(row.starts_on ?? row.startsOn),
      endsOn: asString(row.ends_on ?? row.endsOn),
      sourceFilename: asNullableString(row.source_filename ?? row.sourceFilename),
      importedAt: asNullableString(row.imported_at ?? row.importedAt),
      activatedAt: asNullableString(row.activated_at ?? row.activatedAt),
      createdAt: asString(row.created_at ?? row.createdAt),
      weeks: (dump.school_weeks ?? [])
        .filter((week) => asString(week.school_year_id) === id)
        .map((week) => ({
          number: asNumber(week.week_number ?? week.number),
          kind: asString(week.week_kind ?? week.kind) as "A" | "B",
          monday: asString(week.monday),
        })),
    };
  });
  const exceptions = new Map<string, SchoolDayException[]>();
  for (const row of dump.school_day_exceptions ?? []) {
    const yearId = asString(row.school_year_id ?? row.schoolYearId);
    const list = exceptions.get(yearId) ?? [];
    list.push({
      date: asString(row.day_date ?? row.date),
      state: asString(row.day_state ?? row.state) as SchoolDayException["state"],
      label: asNullableString(row.label),
    });
    exceptions.set(yearId, list);
  }
  replaceMemorySchoolYears(years, exceptions);

  if (deps.courses instanceof MemoryAnnualCourseStore) {
    deps.courses.replaceSnapshot({
      courses: (dump.annual_courses ?? []).map((row) => ({
        id: asString(row.id),
        schoolYearId: asString(row.school_year_id ?? row.schoolYearId),
        classId: asString(row.class_id ?? row.classId),
        contextId: asString(row.context_id ?? row.contextId),
        isArchived: Boolean(row.archived_at ?? row.isArchived),
        archivedAt: asNullableString(row.archived_at ?? row.archivedAt),
        createdAt: asString(row.created_at ?? row.createdAt),
        updatedAt: asString(row.updated_at ?? row.updatedAt),
      })) as AnnualCourse[],
      assignments: (dump.teacher_course_assignments ?? []).map(mapAssignment),
      events: (dump.teacher_course_assignment_events ?? []).map(mapAssignmentEvent),
    });
  }

  if (deps.schedules instanceof MemoryCourseScheduleStore) {
    deps.schedules.replaceSnapshot(
      (dump.course_schedule_slots ?? []).map((row) => ({
        id: asString(row.id),
        annualCourseId: asString(row.annual_course_id ?? row.annualCourseId),
        dayOfWeek: asNumber(row.day_of_week ?? row.dayOfWeek) as CourseWeekday,
        periodStart: asNumber(row.period_start ?? row.periodStart),
        periodEnd: asNumber(row.period_end ?? row.periodEnd),
        weekKind: asString(row.week_kind ?? row.weekKind) as CourseWeekKind,
        validFrom: asNullableString(row.valid_from ?? row.validFrom),
        validTo: asNullableString(row.valid_to ?? row.validTo),
        createdAt: asString(row.created_at ?? row.createdAt),
        updatedAt: asString(row.updated_at ?? row.updatedAt),
      })) as CourseScheduleSlot[],
      (dump.class_attendance_days ?? []).map((row) => ({
        id: asString(row.id),
        classId: asString(row.class_id ?? row.classId),
        dayOfWeek: asNumber(row.day_of_week ?? row.dayOfWeek) as CourseWeekday,
        weekKind: asString(row.week_kind ?? row.weekKind) as CourseWeekKind,
        role: asString(row.role) as AttendanceRole,
        createdAt: asString(row.created_at ?? row.createdAt),
        updatedAt: asString(row.updated_at ?? row.updatedAt),
      })) as ClassAttendanceDay[],
    );
  }

  if (deps.paths instanceof MemoryPedagogicalPathStore) {
    const paths: ReferencePedagogicalPath[] = [];
    for (const row of dump.pedagogical_paths ?? []) {
      if (typeof row.path_json === "string") {
        try {
          paths.push(JSON.parse(row.path_json) as ReferencePedagogicalPath);
        } catch {
          // ignore
        }
      }
    }
    deps.paths.replaceAll(paths);
  }
  if (deps.courseNotes instanceof MemoryAnnualCourseNotesStore) {
    deps.courseNotes.replaceAllNotes((dump.annual_course_notes ?? []).map(mapAnnualNote));
  }

  const setups = dump.teacher_setups ?? [];
  if (setups.length) {
    await deps.teacherSetups.replaceAllSetups(
      setups.map((row) => ({
        teacherId: asString(row.teacher_id ?? row.teacherId),
        config: typeof row.config_json === "string" ? JSON.parse(row.config_json) : row.config,
      })),
    );
  }
  const notes = dump.teacher_notes ?? [];
  if (notes.length) {
    await deps.teacherNotes.replaceAllNotes(
      notes.map((row) => ({
        teacherId: asString(row.teacher_id ?? row.teacherId),
        document: typeof row.notes_json === "string" ? JSON.parse(row.notes_json) : row.document,
      })),
    );
  }

  replaceMemoryTemplates(
    (dump.publication_templates ?? []).map((row) => ({
      id: asString(row.id),
      ownerTeacherId: asString(row.owner_teacher_id ?? row.ownerTeacherId),
      title: asString(row.title),
      detail: asString(row.detail),
      type: asString(row.type) as PublicationTemplate["type"],
      subjectId: asNullableString(row.subject_id ?? row.subjectId),
      defaultSchoolWeekNumber:
        row.default_school_week_number == null && row.defaultSchoolWeekNumber == null
          ? null
          : asNumber(row.default_school_week_number ?? row.defaultSchoolWeekNumber),
      defaultDay: row.default_day == null && row.defaultDay == null ? null : asNumber(row.default_day ?? row.defaultDay),
      sourceSchoolYearId: asNullableString(row.source_school_year_id ?? row.sourceSchoolYearId),
      sourceItemId: row.source_item_id == null && row.sourceItemId == null ? null : asNumber(row.source_item_id ?? row.sourceItemId),
      createdAt: asString(row.created_at ?? row.createdAt),
      updatedAt: asString(row.updated_at ?? row.updatedAt),
    })),
  );

  replaceMemoryTimetableTables({
    timetable_imports: dump.timetable_imports,
    timetable_slots: dump.timetable_slots,
    timetable_class_mappings: dump.timetable_class_mappings,
    timetable_teacher_codes: dump.timetable_teacher_codes,
  });
}

export async function restoreCampusSnapshot(
  deps: CampusBackupDeps,
  payload: unknown,
): Promise<CampusBackupRestoreResult> {
  if (!payload || typeof payload !== "object") {
    return { ok: false, reason: "Sauvegarde invalide." };
  }
  const snapshot = payload as { version?: number; tables?: unknown };
  if (
    snapshot.version === LEGACY_BACKUP_FORMAT_VERSION
    || snapshot.version === BACKUP_FORMAT_VERSION_V2
    || snapshot.version === BACKUP_FORMAT_VERSION_V3
  ) {
    const result = await restoreAgendaSnapshotLegacy(deps, payload);
    if (!result.ok) return result;
    return { ...result, restoredTables: false };
  }
  if (snapshot.version !== BACKUP_FORMAT_VERSION_V4) {
    return { ok: false, reason: "Version de sauvegarde non supportée." };
  }

  const validated = validateCampusTables(snapshot.tables);
  if (!validated.ok) return validated;

  if (deps.sqlDb) {
    try {
      await restoreCampusTables(deps.sqlDb, validated.tables);
    } catch {
      return { ok: false, reason: "Restauration SQL échouée ; la base précédente est conservée." };
    }
  } else {
    const previous = await exportCampusSnapshot(deps);
    try {
      await restoreMemoryTables(deps, validated.tables);
    } catch {
      await restoreMemoryTables(deps, previous.tables);
      return { ok: false, reason: "Restauration mémoire échouée ; l'état précédent est conservé." };
    }
  }

  const items = validated.tables.agenda_items ?? [];
  const setups = validated.tables.teacher_setups ?? [];
  const notes = validated.tables.teacher_notes ?? [];
  const teachers = validated.tables.teachers ?? [];
  return {
    ok: true,
    itemCount: items.length,
    teacherSetupCount: setups.length,
    teacherNotesCount: notes.length,
    teacherAccountCount: teachers.length,
    restoredTeacherData: true,
    restoredTeacherAccounts: true,
    restoredTables: true,
  };
}

export { BACKUP_FORMAT_VERSION_V2, BACKUP_FORMAT_VERSION_V3, LEGACY_BACKUP_FORMAT_VERSION };
export type { AgendaStore };
