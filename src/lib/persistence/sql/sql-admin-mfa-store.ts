import type { AdminMfaStore, TeacherMfaBackupEntry, TeacherMfaRecord } from "../../../features/admin-mfa/types.ts";
import { isAdminMfaStatus } from "../../../features/admin-mfa/types.ts";
import { parseRecoveryHashes, serializeRecoveryHashes } from "../../auth/recovery-codes.ts";
import type { SqlDatabase } from "./types.ts";

interface MfaRow {
  teacher_id: string;
  status: string;
  secret_encrypted: string | null;
  pending_secret_encrypted: string | null;
  recovery_hashes: string | null;
  confirmed_at: string | null;
  updated_at: string | null;
}

const COLUMNS =
  "teacher_id, status, secret_encrypted, pending_secret_encrypted, recovery_hashes, confirmed_at, updated_at";

function toRecord(row: MfaRow): TeacherMfaRecord | null {
  if (!isAdminMfaStatus(row.status)) return null;
  return {
    teacherId: row.teacher_id,
    status: row.status,
    secretEncrypted: row.secret_encrypted,
    pendingSecretEncrypted: row.pending_secret_encrypted,
    recoveryHashes: parseRecoveryHashes(row.recovery_hashes),
    confirmedAt: row.confirmed_at,
    updatedAt: row.updated_at ?? new Date().toISOString(),
  };
}

export class SqlAdminMfaStore implements AdminMfaStore {
  private readonly db: SqlDatabase;

  constructor(db: SqlDatabase) {
    this.db = db;
  }

  async get(teacherId: string): Promise<TeacherMfaRecord | null> {
    const row = await this.db
      .prepare(`SELECT ${COLUMNS} FROM teacher_mfa WHERE teacher_id = ? LIMIT 1`)
      .bind(teacherId)
      .first<MfaRow>();
    return row ? toRecord(row) : null;
  }

  async upsert(record: TeacherMfaRecord): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO teacher_mfa (${COLUMNS})
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(teacher_id) DO UPDATE SET
           status = excluded.status,
           secret_encrypted = excluded.secret_encrypted,
           pending_secret_encrypted = excluded.pending_secret_encrypted,
           recovery_hashes = excluded.recovery_hashes,
           confirmed_at = excluded.confirmed_at,
           updated_at = excluded.updated_at`,
      )
      .bind(
        record.teacherId,
        record.status,
        record.secretEncrypted,
        record.pendingSecretEncrypted,
        record.recoveryHashes.length ? serializeRecoveryHashes(record.recoveryHashes) : null,
        record.confirmedAt,
        record.updatedAt,
      )
      .run();
  }

  async deleteForTeacher(teacherId: string): Promise<void> {
    await this.db.prepare("DELETE FROM teacher_mfa WHERE teacher_id = ?").bind(teacherId).run();
  }

  async exportAll(): Promise<TeacherMfaBackupEntry[]> {
    const { results } = await this.db
      .prepare(`SELECT ${COLUMNS} FROM teacher_mfa ORDER BY teacher_id`)
      .bind()
      .all<MfaRow>();
    return results.map((row) => ({
      teacher_id: row.teacher_id,
      status: row.status,
      secret_encrypted: row.secret_encrypted,
      pending_secret_encrypted: row.pending_secret_encrypted,
      recovery_hashes: row.recovery_hashes,
      confirmed_at: row.confirmed_at,
      updated_at: row.updated_at,
    }));
  }

  async replaceAll(entries: TeacherMfaBackupEntry[]): Promise<void> {
    await this.db.exec("DELETE FROM teacher_mfa");
    for (const entry of entries) {
      await this.db
        .prepare(`INSERT INTO teacher_mfa (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(
          entry.teacher_id,
          entry.status,
          entry.secret_encrypted,
          entry.pending_secret_encrypted,
          entry.recovery_hashes,
          entry.confirmed_at,
          entry.updated_at,
        )
        .run();
    }
  }
}
