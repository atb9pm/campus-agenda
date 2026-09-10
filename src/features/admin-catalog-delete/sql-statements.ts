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

/**
 * membership_subjects a deux parents FK :
 * membership_id → memberships, subject_id → subjects.
 * Un CTX/branche peut supprimer un subject sans supprimer le membership.
 */
export function buildMembershipSubjectDeletes(plan: CatalogDeletePlan): SqlBatchStatement[] {
  const clauses: string[] = [];
  const values: unknown[] = [];
  if (plan.membershipIds.length > 0) {
    clauses.push(`membership_id IN (${plan.membershipIds.map(() => "?").join(", ")})`);
    values.push(...plan.membershipIds);
  }
  if (plan.subjectIds.length > 0) {
    clauses.push(`subject_id IN (${plan.subjectIds.map(() => "?").join(", ")})`);
    values.push(...plan.subjectIds);
  }
  if (clauses.length === 0) return [];
  return [{ sql: `DELETE FROM membership_subjects WHERE ${clauses.join(" OR ")}`, values }];
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

/**
 * Ordre aligné sur les FK des migrations (enfants d’abord) :
 * - membership_subjects → memberships + subjects
 * - memberships / student_accesses → classrooms
 * - agenda_items.template_id → publication_templates
 * - agenda_items.subject_id → subjects
 * - publication_templates.subject_id → subjects
 * - assignments / slots / notes → annual_courses
 * - class_attendance_days → school_classes
 * - subjects → classrooms
 * - timetable_class_mappings → classrooms
 * - annual_courses → school_classes + pedagogical_contexts
 * - pedagogical_paths → pedagogical_contexts
 * - pedagogical_contexts → professions + branches
 */
export function buildCatalogDeleteStatements(
  plan: CatalogDeletePlan,
  snapshot: CatalogDeleteSnapshot,
): SqlBatchStatement[] {
  const mappingDeletes = plan.timetableMappingKeys.map((key) => ({
    sql: "DELETE FROM timetable_class_mappings WHERE import_id = ? AND UPPER(class_code) = UPPER(?)",
    values: [key.importId, key.classCode],
  }));

  return [
    ...buildMembershipSubjectDeletes(plan),
    ...deleteIn("memberships", "id", plan.membershipIds),
    ...deleteIn("student_accesses", "id", plan.studentAccessIds),
    ...deleteIn("agenda_items", "id", plan.agendaItemIds),
    ...deleteIn("publication_templates", "id", plan.publicationTemplateIds),
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
