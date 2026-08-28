import { DEMO_PROTOTYPE_ITEMS } from "../../../features/agenda/demo-items.ts";
import { DEMO_CATALOG, DEMO_CURRENT_TEACHER_ID } from "../../../features/classes/demo-data.ts";
import { legacyDemoPasswordHash } from "../../auth/password.ts";
import type { SqlDatabase } from "./types.ts";

/**
 * Empreinte documentée de la démonstration : refusée en production, où
 * l'amorçage installe un mot de passe administrateur réel.
 */
export const DEMO_PASSWORD_HASH = legacyDemoPasswordHash();

export async function seedDemoDatabase(db: SqlDatabase): Promise<void> {
  for (const teacher of DEMO_CATALOG.teachers) {
    await db
      .prepare(
        "INSERT OR IGNORE INTO teachers (id, display_name, initials, password_hash, is_admin) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(teacher.id, teacher.displayName, teacher.initials, DEMO_PASSWORD_HASH, teacher.id === DEMO_CURRENT_TEACHER_ID ? 1 : 0)
      .run();
  }

  for (const classroom of DEMO_CATALOG.classrooms) {
    await db
      .prepare(
        "INSERT OR IGNORE INTO classrooms (id, name, program_label, access_code_hint) VALUES (?, ?, ?, ?)",
      )
      .bind(classroom.id, classroom.name, classroom.programLabel, classroom.accessCodeHint)
      .run();
  }

  for (const subject of DEMO_CATALOG.subjects) {
    await db
      .prepare("INSERT OR IGNORE INTO subjects (id, classroom_id, name) VALUES (?, ?, ?)")
      .bind(subject.id, subject.classroomId, subject.name)
      .run();
  }

  for (const membership of DEMO_CATALOG.memberships) {
    await db
      .prepare(
        "INSERT OR IGNORE INTO memberships (id, teacher_id, classroom_id, valid_from, valid_to) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(membership.id, membership.teacherId, membership.classroomId, membership.validFrom, membership.validTo)
      .run();

    for (const subjectId of membership.subjectIds) {
      await db
        .prepare("INSERT OR IGNORE INTO membership_subjects (membership_id, subject_id) VALUES (?, ?)")
        .bind(membership.id, subjectId)
        .run();
    }
  }

  for (const access of DEMO_CATALOG.studentAccesses) {
    await db
      .prepare(
        "INSERT OR IGNORE INTO student_accesses (id, classroom_id, label, access_code_hash) VALUES (?, ?, ?, ?)",
      )
      .bind(access.id, access.classroomId, access.label, `demo:${access.label}`)
      .run();
  }

  for (const item of DEMO_PROTOTYPE_ITEMS) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO agenda_items
          (id, classroom_id, subject_id, author_teacher_id, day, hour, week_offset, school_week_number, type, title, detail)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        item.id,
        item.classroomId,
        item.subjectId,
        item.authorTeacherId,
        item.day,
        item.hour,
        item.weekOffset,
        item.schoolWeekNumber,
        item.type,
        item.title,
        item.detail,
      )
      .run();
  }
}
