import { createPublication, deletePublication, updatePublication } from "../../../features/agenda/publications.ts";
import { verifyPassword } from "../../auth/password.ts";
import type { AgendaMutationResult, AgendaStore, CreateAgendaInput } from "../types.ts";
import type { PrototypeAgendaItem } from "../../../features/agenda/demo-items.ts";
import type { AgendaItemRow, SqlDatabase, StudentAccessRow } from "./types.ts";

const AGENDA_ITEM_COLUMNS =
  "id, classroom_id, subject_id, author_teacher_id, day, hour, week_offset, school_week_number, type, title, detail, template_id, school_year_id";

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
  };
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
    const items = await this.exportAllItems();
    const id = Math.max(0, ...items.map((item) => item.id)) + 1;
    const nextItems = createPublication(items, {
      id,
      classroomId: input.classroomId,
      subjectId: input.subjectId,
      authorTeacherId: input.authorTeacherId,
      day: input.day,
      hour: input.hour,
      weekOffset: input.weekOffset ?? 0,
      schoolWeekNumber: input.schoolWeekNumber,
      type: input.type,
      title: input.title,
      detail: input.detail,
      templateId: input.templateId ?? null,
      schoolYearId: input.schoolYearId ?? null,
    });
    const created = nextItems.find((item) => item.id === id);
    if (!created) throw new Error("Publication créée mais introuvable.");

    await this.db
      .prepare(
        `INSERT INTO agenda_items
          (id, classroom_id, subject_id, author_teacher_id, day, hour, week_offset, school_week_number, type, title, detail, template_id, school_year_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        created.id,
        created.classroomId,
        created.subjectId,
        created.authorTeacherId,
        created.day,
        created.hour,
        created.weekOffset,
        created.schoolWeekNumber,
        created.type,
        created.title,
        created.detail,
        created.templateId ?? null,
        created.schoolYearId ?? null,
      )
      .run();

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
      .prepare("SELECT is_admin, is_active FROM teachers WHERE id = ? LIMIT 1")
      .bind(teacherId)
      .first<{ is_admin: number; is_active: number | null }>();
    if (!row?.is_admin) return false;
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
            (id, classroom_id, subject_id, author_teacher_id, day, hour, week_offset, school_week_number, type, title, detail, template_id, school_year_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
): Promise<Array<{ id: string; name: string }>> {
  const { results } = await db.prepare("SELECT id, name FROM classrooms").bind().all<{ id: string; name: string }>();
  return results ?? [];
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
