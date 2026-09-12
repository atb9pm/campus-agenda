import type { SqlBatchStatement } from "../../lib/persistence/sql/types.ts";

/**
 * Ordre de la transaction :
 * 1. détacher les publications / notes (conserver les lignes) ;
 * 2. supprimer les données personnelles et les accès ;
 * 3. supprimer le compte.
 *
 * Ne jamais DELETE agenda_items, annual_courses, school_classes,
 * pedagogical_contexts, school_branches.
 */
export function buildTeacherDeleteStatements(teacherId: string): SqlBatchStatement[] {
  return [
    {
      sql: `UPDATE agenda_items
            SET template_id = NULL
            WHERE template_id IN (
              SELECT id FROM publication_templates WHERE owner_teacher_id = ?
            )`,
      values: [teacherId],
    },
    {
      sql: "DELETE FROM publication_templates WHERE owner_teacher_id = ?",
      values: [teacherId],
    },
    {
      sql: "UPDATE agenda_items SET author_teacher_id = NULL WHERE author_teacher_id = ?",
      values: [teacherId],
    },
    {
      sql: "UPDATE annual_course_notes SET author_teacher_id = NULL WHERE author_teacher_id = ?",
      values: [teacherId],
    },
    {
      sql: "UPDATE timetable_teacher_codes SET teacher_id = NULL WHERE teacher_id = ?",
      values: [teacherId],
    },
    {
      sql: `DELETE FROM membership_subjects
            WHERE membership_id IN (SELECT id FROM memberships WHERE teacher_id = ?)`,
      values: [teacherId],
    },
    {
      sql: "DELETE FROM memberships WHERE teacher_id = ?",
      values: [teacherId],
    },
    {
      sql: "DELETE FROM teacher_course_assignment_events WHERE teacher_id = ?",
      values: [teacherId],
    },
    {
      sql: "DELETE FROM teacher_course_assignments WHERE teacher_id = ?",
      values: [teacherId],
    },
    {
      sql: "DELETE FROM teacher_setups WHERE teacher_id = ?",
      values: [teacherId],
    },
    {
      sql: "DELETE FROM teacher_notes WHERE teacher_id = ?",
      values: [teacherId],
    },
    {
      sql: "DELETE FROM teacher_mfa WHERE teacher_id = ?",
      values: [teacherId],
    },
    {
      sql: "DELETE FROM teachers WHERE id = ?",
      values: [teacherId],
    },
  ];
}

export const SQL_TEACHER_DELETE_ROLLBACK_PROBE = {
  sql: "SELECT 1 FROM campus_teacher_delete_rollback WHERE injected = 1",
  values: [] as unknown[],
};
