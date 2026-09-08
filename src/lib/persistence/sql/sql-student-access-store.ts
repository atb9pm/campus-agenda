import type { SqlDatabase } from "./types.ts";
import type { StudentAccessRecord, StudentAccessStore } from "../student-access-types.ts";

const COLUMNS =
  "id, classroom_id, school_class_id, label, access_code_hash, access_version, created_at, updated_at, revoked_at";

interface StudentAccessSqlRow {
  id: string;
  classroom_id: string;
  school_class_id: string | null;
  label: string;
  access_code_hash: string | null;
  access_version: number | null;
  created_at: string | null;
  updated_at: string | null;
  revoked_at: string | null;
}

function rowToRecord(row: StudentAccessSqlRow): StudentAccessRecord {
  return {
    id: row.id,
    classroomId: row.classroom_id,
    schoolClassId: row.school_class_id,
    label: row.label,
    accessCodeHash: row.access_code_hash,
    accessVersion: Number(row.access_version ?? 1) || 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revokedAt: row.revoked_at,
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

export class SqlStudentAccessStore implements StudentAccessStore {
  private readonly db: SqlDatabase;

  constructor(db: SqlDatabase) {
    this.db = db;
  }

  async getById(id: string): Promise<StudentAccessRecord | null> {
    const row = await this.db
      .prepare(`SELECT ${COLUMNS} FROM student_accesses WHERE id = ? LIMIT 1`)
      .bind(id)
      .first<StudentAccessSqlRow>();
    return row ? rowToRecord(row) : null;
  }

  async getBySchoolClassId(schoolClassId: string): Promise<StudentAccessRecord | null> {
    const row = await this.db
      .prepare(`SELECT ${COLUMNS} FROM student_accesses WHERE school_class_id = ? LIMIT 1`)
      .bind(schoolClassId)
      .first<StudentAccessSqlRow>();
    return row ? rowToRecord(row) : null;
  }

  async listAll(): Promise<StudentAccessRecord[]> {
    const { results } = await this.db
      .prepare(`SELECT ${COLUMNS} FROM student_accesses ORDER BY id`)
      .bind()
      .all<StudentAccessSqlRow>();
    return (results ?? []).map(rowToRecord);
  }

  async saveGenerated(input: {
    schoolClassId: string;
    classroomId: string;
    label: string;
    accessCodeHash: string;
  }): Promise<StudentAccessRecord> {
    const stamp = nowIso();
    const existing = await this.getBySchoolClassId(input.schoolClassId);
    if (existing) {
      await this.db
        .prepare(
          `UPDATE student_accesses
           SET classroom_id = ?, label = ?, access_code_hash = ?, access_version = ?, updated_at = ?, revoked_at = NULL
           WHERE id = ?`,
        )
        .bind(
          input.classroomId,
          input.label,
          input.accessCodeHash,
          existing.accessVersion + 1,
          stamp,
          existing.id,
        )
        .run();
      const updated = await this.getById(existing.id);
      if (!updated) throw new Error("Accès apprentis introuvable après régénération.");
      return updated;
    }

    const id = `student-access-${input.schoolClassId}`;
    await this.db
      .prepare(
        `INSERT INTO student_accesses
          (id, classroom_id, school_class_id, label, access_code_hash, access_version, created_at, updated_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, NULL)`,
      )
      .bind(id, input.classroomId, input.schoolClassId, input.label, input.accessCodeHash, stamp, stamp)
      .run();
    const created = await this.getById(id);
    if (!created) throw new Error("Accès apprentis introuvable après génération.");
    return created;
  }

  async revokeBySchoolClassId(schoolClassId: string): Promise<StudentAccessRecord | null> {
    const existing = await this.getBySchoolClassId(schoolClassId);
    if (!existing) return null;
    const stamp = nowIso();
    await this.db
      .prepare(
        `UPDATE student_accesses
         SET revoked_at = ?, access_version = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(stamp, existing.accessVersion + 1, stamp, existing.id)
      .run();
    return this.getById(existing.id);
  }

  async replaceAll(records: StudentAccessRecord[]): Promise<void> {
    await this.db.exec("DELETE FROM student_accesses");
    for (const record of records) {
      await this.db
        .prepare(
          `INSERT INTO student_accesses
            (id, classroom_id, school_class_id, label, access_code_hash, access_version, created_at, updated_at, revoked_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          record.id,
          record.classroomId,
          record.schoolClassId,
          record.label,
          record.accessCodeHash ?? "",
          record.accessVersion,
          record.createdAt,
          record.updatedAt,
          record.revokedAt,
        )
        .run();
    }
  }
}
