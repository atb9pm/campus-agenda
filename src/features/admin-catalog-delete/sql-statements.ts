import { serializeClassNotes } from "../class-notebook/notes-storage.ts";
import { serializeTeacherSetup } from "../teacher-setup/storage.ts";
import type { SqlBatchStatement } from "../../lib/persistence/sql/types.ts";
import type { CatalogDeleteSnapshot } from "./snapshot.ts";
import type { CatalogDeletePlan } from "./types.ts";

function deleteIn(table: string, column: string, ids: Array<string | number>): SqlBatchStatement[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(", ");
  return [{ sql: `DELETE FROM ${table} WHERE ${column} IN (${placeholders})`, values: ids }];
}

export function buildTeacherJsonUpdates(
  plan: CatalogDeletePlan,
  snapshot: CatalogDeleteSnapshot,
): SqlBatchStatement[] {
  const classroomIds = new Set(plan.classroomIds);
  const statements: SqlBatchStatement[] = [];
  for (const entry of snapshot.teacherSetups) {
    const nextClasses = entry.config.classes.filter((item) => !classroomIds.has(item.id));
    if (nextClasses.length === entry.config.classes.length) continue;
    statements.push({
      sql: `UPDATE teacher_setups SET config_json = ?, updated_at = datetime('now') WHERE teacher_id = ?`,
      values: [serializeTeacherSetup({ ...entry.config, classes: nextClasses }), entry.teacherId],
    });
  }
  for (const entry of snapshot.teacherNotes) {
    const weeks = { ...entry.document.weeks };
    let changed = false;
    for (const key of Object.keys(weeks)) {
      if (plan.classroomIds.some((classroomId) => key.startsWith(`${classroomId}:`))) {
        delete weeks[key];
        changed = true;
      }
    }
    if (!changed) continue;
    statements.push({
      sql: `UPDATE teacher_notes SET notes_json = ?, updated_at = datetime('now') WHERE teacher_id = ?`,
      values: [serializeClassNotes({ ...entry.document, weeks }), entry.teacherId],
    });
  }
  return statements;
}

export function buildCatalogDeleteStatements(
  plan: CatalogDeletePlan,
  snapshot: CatalogDeleteSnapshot,
): SqlBatchStatement[] {
  const mappingDeletes = plan.timetableMappingKeys.map((key) => ({
    sql: "DELETE FROM timetable_class_mappings WHERE import_id = ? AND UPPER(class_code) = UPPER(?)",
    values: [key.importId, key.classCode],
  }));

  return [
    ...deleteIn("membership_subjects", "membership_id", plan.membershipIds),
    ...deleteIn("memberships", "id", plan.membershipIds),
    ...deleteIn("student_accesses", "id", plan.studentAccessIds),
    ...deleteIn("publication_templates", "id", plan.publicationTemplateIds),
    ...deleteIn("agenda_items", "id", plan.agendaItemIds),
    ...deleteIn("teacher_course_assignment_events", "id", plan.assignmentEventIds),
    ...deleteIn("teacher_course_assignments", "id", plan.assignmentIds),
    ...deleteIn("course_schedule_slots", "id", plan.courseScheduleSlotIds),
    ...deleteIn("annual_course_notes", "id", plan.annualCourseNoteIds),
    ...deleteIn("class_attendance_days", "id", plan.attendanceDayIds),
    ...deleteIn("subjects", "id", plan.subjectIds),
    ...mappingDeletes,
    ...deleteIn("timetable_slots", "id", plan.timetableSlotIds),
    ...deleteIn("classrooms", "id", plan.classroomIds),
    ...deleteIn("pedagogical_paths", "context_id", plan.contextIds),
    ...deleteIn("annual_courses", "id", plan.annualCourseIds),
    ...deleteIn("school_classes", "id", plan.classIds),
    ...deleteIn("pedagogical_contexts", "id", plan.contextIds),
    ...deleteIn("school_branches", "id", plan.branchIds),
    ...deleteIn("school_professions", "id", plan.professionIds),
    ...buildTeacherJsonUpdates(plan, snapshot),
  ];
}

export const SQL_ROLLBACK_PROBE = {
  sql: "SELECT 1 FROM campus_catalog_delete_rollback WHERE injected = 1",
  values: [] as unknown[],
};
