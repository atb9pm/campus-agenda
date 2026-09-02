import { deletePublication, updatePublication } from "../../../features/agenda/publications.ts";
import { verifyPassword } from "../../auth/password.ts";
import type { AgendaMutationResult, AgendaStore, CreateAgendaInput, StructuredControlPlacement } from "../types.ts";
import type { PrototypeAgendaItem } from "../../../features/agenda/demo-items.ts";
import type { AgendaItemRow, SqlDatabase, StudentAccessRow } from "./types.ts";

const AGENDA_ITEM_COLUMNS =
  "id, classroom_id, subject_id, author_teacher_id, day, hour, week_offset, school_week_number, type, title, detail, template_id, school_year_id, annual_course_id, course_session_key, course_session_date, reference_session_id, reference_item_id";

function rowToItem(row: AgendaItemRow): PrototypeAgendaItem {
  return {
    id: row.id,
    classroomId: row.classroom_id,
    subjectId: row.subject_id,
    authorTeacherId: row.author_teacher_id,
    day: row.day,
    hour: row.hour,
    weekOffset: row.week_offset,
    schoolWeekNumber: row.school_week_number ?? row.week_offset,
    type: row.type as PrototypeAgendaItem["type"],
    title: row.title,
    detail: row.detail,
    templateId: row.template_id ?? null,
    schoolYearId: row.school_year_id ?? null,
    annualCourseId: row.annual_course_id ?? null,
    courseSessionKey: row.course_session_key ?? null,
    courseSessionDate: row.course_session_date ?? null,
    referenceSessionId: row.reference_session_id ?? null,
    referenceItemId: row.reference_item_id ?? null,
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /UNIQUE constraint failed/i.test(message);
}

export class SqlAgendaStore implements AgendaStore {
  private readonly db: SqlDatabase;

  constructor(db: SqlDatabase) {
    this.db = db;
  }

  async listAgendaItems(classroomId: string): Promise<PrototypeAgendaItem[]> {
    const { results } = await this.db
      .prepare(
        `SELECT ${AGENDA_ITEM_COLUMNS} FROM agenda_items WHERE classroom_id = ? ORDER BY id`,
      )
      .bind(classroomId)
      .all<AgendaItemRow>();
    return results.map(rowToItem);
  }

  async findAgendaItem(itemId: number): Promise<PrototypeAgendaItem | undefined> {
    const row = await this.db
      .prepare(
        `SELECT ${AGENDA_ITEM_COLUMNS} FROM agenda_items WHERE id = ?`,
      )
      .bind(itemId)
      .first<AgendaItemRow>();
    return row ? rowToItem(row) : undefined;
  }

  async createAgendaItem(input: CreateAgendaInput): Promise<PrototypeAgendaItem> {
    const title = input.title.trim();
    if (!title) throw new Error("Le titre est obligatoire.");
    const detail = input.detail.trim() || "Aucune précision";
    let result;
    try {
      result = await this.db
        .prepare(
          `INSERT INTO agenda_items
            (classroom_id, subject_id, author_teacher_id, day, hour, week_offset, school_week_number, type, title, detail, template_id, school_year_id, annual_course_id, course_session_key, course_session_date, reference_session_id, reference_item_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          input.classroomId,
          input.subjectId,
          input.authorTeacherId,
          input.day,
          input.hour,
          input.weekOffset ?? 0,
          input.schoolWeekNumber,
          input.type,
          title,
          detail,
          input.templateId ?? null,
          input.schoolYearId ?? null,
          input.annualCourseId ?? null,
          input.courseSessionKey ?? null,
          input.courseSessionDate ?? null,
          input.referenceSessionId ?? null,
          input.referenceItemId ?? null,
        )
        .run();
    } catch (error) {
      if (
        isUniqueConstraintError(error) &&
        input.annualCourseId?.trim() &&
        input.referenceItemId?.trim()
      ) {
        const existing = await this.findAgendaItemByReferenceItem(
          input.annualCourseId.trim(),
          input.referenceItemId.trim(),
        );
        if (existing) {
          throw new Error("Cet élément de référence a déjà été publié dans l’Agenda pour ce cours.");
        }
      }
      throw error;
    }
    const id = Number(result.meta?.last_row_id);
    if (!Number.isFinite(id) || id <= 0) {
      throw new Error("Identifiant de publication introuvable.");
    }
    const created = await this.findAgendaItem(id);
    if (!created) throw new Error("Publication créée mais introuvable.");
    return created;
  }

  async updateAgendaItem(
    itemId: number,
    actorTeacherId: string,
    patch: Partial<Pick<CreateAgendaInput, "title" | "detail" | "day" | "hour" | "subjectId" | "schoolWeekNumber">>,
  ): Promise<AgendaMutationResult> {
    const items = await this.exportAllItems();
    const actorIsAdmin = await this.teacherIsAdmin(actorTeacherId);
    const result = updatePublication(items, itemId, actorTeacherId, patch, actorIsAdmin);
    if (!result.ok) {
      return { ok: false, reason: result.reason, status: result.reason.includes("introuvable") ? 404 : 403 };
    }

    const updated = result.items.find((item) => item.id === itemId);
    if (!updated) return { ok: false, reason: "Publication introuvable.", status: 404 };

    await this.db
      .prepare(
        "UPDATE agenda_items SET title = ?, detail = ?, day = ?, hour = ?, subject_id = ?, school_week_number = ?, updated_at = datetime('now') WHERE id = ?",
      )
      .bind(updated.title, updated.detail, updated.day, updated.hour, updated.subjectId, updated.schoolWeekNumber, itemId)
      .run();

    return { ok: true, item: updated };
  }

  async moveStructuredControlPlacement(
    itemId: number,
    actorTeacherId: string,
    placement: StructuredControlPlacement,
  ): Promise<AgendaMutationResult> {
    const existing = await this.findAgendaItem(itemId);
    if (!existing) return { ok: false, reason: "Publication introuvable.", status: 404 };
    if (existing.type !== "TEST") {
      return { ok: false, reason: "Seul un contrôle peut être déplacé vers une autre séance.", status: 400 };
    }
    if (existing.authorTeacherId !== actorTeacherId) {
      return { ok: false, reason: "Seul l'auteur peut déplacer ce contrôle.", status: 403 };
    }
    if (!existing.annualCourseId?.trim() || !existing.courseSessionKey?.trim()) {
      return { ok: false, reason: "Ce contrôle n'est pas rattaché à une séance de cours réelle.", status: 400 };
    }

    const item = {
      ...existing,
      classroomId: placement.classroomId,
      subjectId: placement.subjectId,
      schoolYearId: placement.schoolYearId,
      annualCourseId: placement.annualCourseId,
      courseSessionKey: placement.courseSessionKey,
      courseSessionDate: placement.courseSessionDate,
      schoolWeekNumber: placement.schoolWeekNumber,
      day: placement.day,
      hour: placement.hour,
    };

    await this.db
      .prepare(
        `UPDATE agenda_items SET
          classroom_id = ?,
          subject_id = ?,
          school_year_id = ?,
          annual_course_id = ?,
          course_session_key = ?,
          course_session_date = ?,
          school_week_number = ?,
          day = ?,
          hour = ?,
          updated_at = datetime('now')
         WHERE id = ?`,
      )
      .bind(
        item.classroomId,
        item.subjectId,
        item.schoolYearId,
        item.annualCourseId,
        item.courseSessionKey,
        item.courseSessionDate,
        item.schoolWeekNumber,
        item.day,
        item.hour,
        itemId,
      )
      .run();

    return { ok: true, item };
  }

  async deleteAgendaItem(itemId: number, actorTeacherId: string): Promise<AgendaMutationResult> {
    const items = await this.exportAllItems();
    const actorIsAdmin = await this.teacherIsAdmin(actorTeacherId);
    const result = deletePublication(items, itemId, actorTeacherId, actorIsAdmin);
    if (!result.ok) {
      return { ok: false, reason: result.reason, status: result.reason.includes("introuvable") ? 404 : 403 };
    }

    const deleted = items.find((item) => item.id === itemId);
    if (!deleted) return { ok: false, reason: "Publication introuvable.", status: 404 };

    await this.db.prepare("DELETE FROM agenda_items WHERE id = ?").bind(itemId).run();
    return { ok: true, item: deleted };
  }

  async teacherCanAccessClassroom(teacherId: string, classroomId: string): Promise<boolean> {
    const row = await this.db
      .prepare(
        `SELECT 1 AS ok FROM memberships
         WHERE teacher_id = ? AND classroom_id = ?
           AND valid_from <= datetime('now')
           AND (valid_to IS NULL OR valid_to > datetime('now'))
         LIMIT 1`,
      )
      .bind(teacherId, classroomId)
      .first<{ ok: number }>();
    return Boolean(row);
  }

  async teacherCanPublish(teacherId: string, classroomId: string, subjectId: string): Promise<boolean> {
    const row = await this.db
      .prepare(
        `SELECT 1 AS ok FROM memberships m
         JOIN membership_subjects ms ON ms.membership_id = m.id
         WHERE m.teacher_id = ? AND m.classroom_id = ? AND ms.subject_id = ?
           AND m.valid_from <= datetime('now')
           AND (m.valid_to IS NULL OR m.valid_to > datetime('now'))
         LIMIT 1`,
      )
      .bind(teacherId, classroomId, subjectId)
      .first<{ ok: number }>();
    return Boolean(row);
  }

  async teacherIsAdmin(teacherId: string): Promise<boolean> {
    const row = await this.db
      .prepare("SELECT is_admin, is_active, archived_at FROM teachers WHERE id = ? LIMIT 1")
      .bind(teacherId)
      .first<{ is_admin: number; is_active: number | null; archived_at: string | null }>();
    if (!row?.is_admin) return false;
    if (row.archived_at) return false;
    return row.is_active === null ? true : Boolean(row.is_active);
  }

  async resolveStudentAccess(label: string) {
    const row = await this.db
      .prepare("SELECT id, classroom_id, label FROM student_accesses WHERE lower(label) = lower(?) LIMIT 1")
      .bind(label.trim())
      .first<StudentAccessRow>();
    if (!row) return undefined;
    return { id: row.id, classroomId: row.classroom_id, label: row.label };
  }

  async findStudentAccessById(accessId: string) {
    const row = await this.db
      .prepare("SELECT id, classroom_id, label FROM student_accesses WHERE id = ? LIMIT 1")
      .bind(accessId)
      .first<StudentAccessRow>();
    if (!row) return undefined;
    return { id: row.id, classroomId: row.classroom_id, label: row.label };
  }

  async findTeacherIdByInitials(initials: string): Promise<string | undefined> {
    const normalized = initials.trim();
    if (!normalized) return undefined;
    const row = await this.db
      .prepare("SELECT id FROM teachers WHERE lower(initials) = lower(?) LIMIT 1")
      .bind(normalized)
      .first<{ id: string }>();
    return row?.id;
  }

  async verifyTeacherCredentials(teacherId: string, password: string): Promise<boolean> {
    const row = await this.db
      .prepare("SELECT password_hash, is_active FROM teachers WHERE id = ? LIMIT 1")
      .bind(teacherId)
      .first<{ password_hash: string; is_active: number | null }>();
    if (!row) return false;
    if (row.is_active !== null && !row.is_active) return false;
    return verifyPassword(password, row.password_hash);
  }

  async listAgendaItemsByAnnualCourse(annualCourseId: string): Promise<PrototypeAgendaItem[]> {
    const { results } = await this.db
      .prepare(
        `SELECT ${AGENDA_ITEM_COLUMNS} FROM agenda_items WHERE annual_course_id = ? ORDER BY id`,
      )
      .bind(annualCourseId)
      .all<AgendaItemRow>();
    return results.map(rowToItem);
  }

  async findAgendaItemByReferenceItem(
    annualCourseId: string,
    referenceItemId: string,
  ): Promise<PrototypeAgendaItem | undefined> {
    const row = await this.db
      .prepare(
        `SELECT ${AGENDA_ITEM_COLUMNS} FROM agenda_items
         WHERE annual_course_id = ? AND reference_item_id = ? LIMIT 1`,
      )
      .bind(annualCourseId, referenceItemId)
      .first<AgendaItemRow>();
    return row ? rowToItem(row) : undefined;
  }

  async countAgendaItemsByAnnualCourse(annualCourseId: string): Promise<number> {
    const row = await this.db
      .prepare("SELECT COUNT(*) AS count FROM agenda_items WHERE annual_course_id = ?")
      .bind(annualCourseId)
      .first<{ count: number }>();
    return Number(row?.count ?? 0);
  }

  async exportAllItems(): Promise<PrototypeAgendaItem[]> {
    const { results } = await this.db
      .prepare(
        `SELECT ${AGENDA_ITEM_COLUMNS} FROM agenda_items ORDER BY id`,
      )
      .bind()
      .all<AgendaItemRow>();
    return results.map(rowToItem);
  }

  async replaceAllItems(items: PrototypeAgendaItem[]): Promise<void> {
    await this.db.exec("DELETE FROM agenda_items");
    for (const item of items) {
      await this.db
        .prepare(
          `INSERT INTO agenda_items
            (id, classroom_id, subject_id, author_teacher_id, day, hour, week_offset, school_week_number, type, title, detail, template_id, school_year_id, annual_course_id, course_session_key, course_session_date, reference_session_id, reference_item_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          item.templateId ?? null,
          item.schoolYearId ?? null,
          item.annualCourseId ?? null,
          item.courseSessionKey ?? null,
          item.courseSessionDate ?? null,
          item.referenceSessionId ?? null,
          item.referenceItemId ?? null,
        )
        .run();
    }
  }
}

export async function classroomExistsInDatabase(db: SqlDatabase, classroomId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS ok FROM classrooms WHERE id = ? LIMIT 1")
    .bind(classroomId)
    .first<{ ok: number }>();
  return Boolean(row);
}

export async function listClassroomsInDatabase(
  db: SqlDatabase,
): Promise<Array<{ id: string; name: string; schoolClassId?: string | null }>> {
  const { results } = await db
    .prepare("SELECT id, name, school_class_id FROM classrooms")
    .bind()
    .all<{ id: string; name: string; school_class_id: string | null }>();
  return (results ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    schoolClassId: row.school_class_id,
  }));
}

export async function listStudentAccessesInDatabase(
  db: SqlDatabase,
): Promise<Array<{ classroomId: string }>> {
  const { results } = await db
    .prepare("SELECT classroom_id FROM student_accesses")
    .bind()
    .all<{ classroom_id: string }>();
  return (results ?? []).map((row) => ({ classroomId: row.classroom_id }));
}


export async function resolveClassroomSubjectNamesInDatabase(
  db: SqlDatabase,
  classroomId: string,
  subjectId: string,
): Promise<{ classroomName: string | null; subjectName: string | null }> {
  const classroom = await db
    .prepare("SELECT name FROM classrooms WHERE id = ? LIMIT 1")
    .bind(classroomId)
    .first<{ name: string }>();
  const subject = await db
    .prepare("SELECT name FROM subjects WHERE id = ? AND classroom_id = ? LIMIT 1")
    .bind(subjectId, classroomId)
    .first<{ name: string }>();
  return {
    classroomName: classroom?.name ?? null,
    subjectName: subject?.name ?? null,
  };
}
