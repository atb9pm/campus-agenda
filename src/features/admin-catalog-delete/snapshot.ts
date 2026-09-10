import type { PrototypeAgendaItem } from "../agenda/demo-items.ts";
import type { AnnualCourse, TeacherCourseAssignment, TeacherCourseAssignmentEvent } from "../annual-courses/types.ts";
import type { ClassAttendanceDay, CourseScheduleSlot } from "../course-schedule/types.ts";
import type { AnnualCourseNote, ReferencePedagogicalPath } from "../pedagogical-path/index.ts";
import type { PublicationTemplate } from "../library/types.ts";
import {
  type PedagogicalContextRecord,
  type SchoolBranchRecord,
  type SchoolClassRecord,
  type SchoolProfessionRecord,
} from "../school-catalog/index.ts";
import type { TeacherNotesBackupEntry } from "../../lib/persistence/teacher-notes-types.ts";
import type { TeacherSetupBackupEntry } from "../../lib/persistence/teacher-setup-types.ts";
import type { Membership } from "../../types/membership.ts";
import type { RuntimeClassroom, RuntimeSubject } from "../../lib/persistence/runtime-agenda-types.ts";
import type { StudentAccessRecord } from "../../lib/persistence/student-access-types.ts";
import type { AnnualCourseNotesStore, PedagogicalPathStore } from "../../lib/persistence/pedagogical-path-types.ts";
import type { AnnualCourseStore } from "../../lib/persistence/annual-course-types.ts";
import type { CourseScheduleStore } from "../../lib/persistence/course-schedule-types.ts";
import type { AgendaStore } from "../../lib/persistence/types.ts";
import type { MembershipStore } from "../../lib/persistence/membership-types.ts";
import type { SchoolCatalogStore } from "../../lib/persistence/school-catalog-types.ts";
import type { StudentAccessStore } from "../../lib/persistence/student-access-types.ts";
import type { TeacherNotesStore } from "../../lib/persistence/teacher-notes-types.ts";
import type { TeacherSetupStore } from "../../lib/persistence/teacher-setup-types.ts";
import type { RuntimeAgendaAdapterStore } from "../../lib/persistence/runtime-agenda-types.ts";
import type { TimetableStore } from "../../lib/persistence/timetable-types.ts";
import type { SqlDatabase } from "../../lib/persistence/sql/types.ts";
import { exportMemoryTemplates } from "../../lib/persistence/memory-template-store.ts";
import { exportMemoryTimetableTables } from "../../lib/persistence/memory-timetable-store.ts";

export interface CatalogDeleteSnapshot {
  classes: SchoolClassRecord[];
  professions: SchoolProfessionRecord[];
  branches: SchoolBranchRecord[];
  contexts: PedagogicalContextRecord[];
  courses: AnnualCourse[];
  assignments: TeacherCourseAssignment[];
  events: TeacherCourseAssignmentEvent[];
  notes: AnnualCourseNote[];
  paths: ReferencePedagogicalPath[];
  scheduleSlots: CourseScheduleSlot[];
  attendanceDays: ClassAttendanceDay[];
  agendaItems: PrototypeAgendaItem[];
  classrooms: RuntimeClassroom[];
  subjects: RuntimeSubject[];
  memberships: Membership[];
  studentAccesses: StudentAccessRecord[];
  templates: PublicationTemplate[];
  teacherSetups: TeacherSetupBackupEntry[];
  teacherNotes: TeacherNotesBackupEntry[];
  timetableSlots: Array<{ id: string; importId: string; classCode: string; schoolYearId: string | null }>;
  timetableMappings: Array<{ importId: string; classCode: string; classroomId: string }>;
}

export interface CatalogDeleteSnapshotDeps {
  catalog: SchoolCatalogStore;
  courses: AnnualCourseStore;
  notes: AnnualCourseNotesStore & { exportAllNotes?: () => AnnualCourseNote[] };
  paths: PedagogicalPathStore;
  schedules: CourseScheduleStore;
  agenda: AgendaStore;
  adapters: RuntimeAgendaAdapterStore;
  memberships: MembershipStore;
  studentAccesses: StudentAccessStore;
  teacherSetups: TeacherSetupStore;
  teacherNotes: TeacherNotesStore;
  timetable: TimetableStore;
  sqlDb?: SqlDatabase | null;
}

export async function loadCatalogDeleteSnapshot(
  deps: CatalogDeleteSnapshotDeps,
): Promise<CatalogDeleteSnapshot> {
  const [
    classes,
    professions,
    branches,
    contexts,
    courses,
    assignments,
    events,
    paths,
    scheduleSlots,
    attendanceDays,
    agendaItems,
    classrooms,
    subjects,
    memberships,
    studentAccesses,
    teacherSetups,
    teacherNotes,
  ] = await Promise.all([
    deps.catalog.listClasses(),
    deps.catalog.listProfessions(),
    deps.catalog.listBranches(),
    deps.catalog.listContexts(),
    deps.courses.listCourses(),
    deps.courses.listAssignments(),
    deps.courses.listEvents(),
    deps.paths.listPaths(),
    deps.schedules.listSlots(),
    deps.schedules.listAttendanceDays(),
    deps.agenda.exportAllItems(),
    deps.adapters.listClassrooms(),
    deps.adapters.listSubjects(),
    deps.memberships.listMemberships(),
    deps.studentAccesses.listAll(),
    deps.teacherSetups.exportAllSetups(),
    deps.teacherNotes.exportAllNotes(),
  ]);

  const notes = await loadAllAnnualNotes(deps);
  const { templates, timetableSlots, timetableMappings } = await loadAuxiliaryRows(deps);

  return {
    classes,
    professions,
    branches,
    contexts,
    courses,
    assignments,
    events,
    notes,
    paths,
    scheduleSlots,
    attendanceDays,
    agendaItems,
    classrooms,
    subjects,
    memberships,
    studentAccesses,
    templates,
    teacherSetups,
    teacherNotes,
    timetableSlots,
    timetableMappings,
  };
}

async function loadAllAnnualNotes(deps: CatalogDeleteSnapshotDeps): Promise<AnnualCourseNote[]> {
  if (deps.sqlDb) {
    const { results } = await deps.sqlDb
      .prepare(
        `SELECT id, school_year_id, class_id, context_id, reference_session_id, author_teacher_id,
                text, source_note_id, source_school_year_id, inherited_at, annual_course_id,
                created_at, updated_at
         FROM annual_course_notes`,
      )
      .bind()
      .all<{
        id: string;
        school_year_id: string;
        class_id: string;
        context_id: string;
        reference_session_id: string | null;
        author_teacher_id: string;
        text: string;
        source_note_id: string | null;
        source_school_year_id: string | null;
        inherited_at: string | null;
        annual_course_id: string | null;
        created_at: string;
        updated_at: string;
      }>();
    return (results ?? []).map((row) => ({
      id: row.id,
      schoolYearId: row.school_year_id,
      classId: row.class_id,
      contextId: row.context_id,
      referenceSessionId: row.reference_session_id,
      authorTeacherId: row.author_teacher_id,
      text: row.text,
      sourceNoteId: row.source_note_id,
      sourceSchoolYearId: row.source_school_year_id,
      inheritedAt: row.inherited_at,
      annualCourseId: row.annual_course_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }
  if (typeof deps.notes.exportAllNotes === "function") {
    return deps.notes.exportAllNotes();
  }
  const collected: AnnualCourseNote[] = [];
  const courses = await deps.courses.listCourses();
  for (const course of courses) {
    collected.push(
      ...(await deps.notes.listNotes({
        schoolYearId: course.schoolYearId,
        classId: course.classId,
        contextId: course.contextId,
      })),
    );
  }
  return collected;
}

async function loadAuxiliaryRows(deps: CatalogDeleteSnapshotDeps): Promise<{
  templates: PublicationTemplate[];
  timetableSlots: CatalogDeleteSnapshot["timetableSlots"];
  timetableMappings: CatalogDeleteSnapshot["timetableMappings"];
}> {
  if (deps.sqlDb) {
    const templates = await deps.sqlDb
      .prepare("SELECT id, source_item_id FROM publication_templates")
      .bind()
      .all<{ id: string; source_item_id: number | null }>();
    const slots = await deps.sqlDb
      .prepare(
        `SELECT s.id AS id, s.import_id AS import_id, s.class_code AS class_code,
                i.school_year_id AS school_year_id
         FROM timetable_slots s
         INNER JOIN timetable_imports i ON i.id = s.import_id`,
      )
      .bind()
      .all<{ id: string; import_id: string; class_code: string; school_year_id: string | null }>();
    const mappings = await deps.sqlDb
      .prepare("SELECT import_id, class_code, classroom_id FROM timetable_class_mappings")
      .bind()
      .all<{ import_id: string; class_code: string; classroom_id: string }>();
    return {
      templates: (templates.results ?? []).map((row) => ({
        id: row.id,
        ownerTeacherId: "",
        title: "",
        detail: "",
        type: "INFORMATION",
        subjectId: null,
        defaultSchoolWeekNumber: null,
        defaultDay: null,
        sourceSchoolYearId: null,
        sourceItemId: row.source_item_id,
        createdAt: "",
        updatedAt: "",
      })),
      timetableSlots: (slots.results ?? []).map((row) => ({
        id: row.id,
        importId: row.import_id,
        classCode: row.class_code,
        schoolYearId: row.school_year_id,
      })),
      timetableMappings: (mappings.results ?? []).map((row) => ({
        importId: row.import_id,
        classCode: row.class_code,
        classroomId: row.classroom_id,
      })),
    };
  }

  const memoryTables = exportMemoryTimetableTables();
  const imports = await deps.timetable.listImports();
  const yearByImport = new Map(imports.map((entry) => [entry.id, entry.schoolYearId ?? null]));
  return {
    templates: exportMemoryTemplates(),
    timetableSlots: memoryTables.timetable_slots.map((row) => ({
      id: String(row.id),
      importId: String(row.import_id),
      classCode: String(row.class_code),
      schoolYearId: yearByImport.get(String(row.import_id)) ?? null,
    })),
    timetableMappings: memoryTables.timetable_class_mappings.map((row) => ({
      importId: String(row.import_id),
      classCode: String(row.class_code),
      classroomId: String(row.classroom_id),
    })),
  };
}
