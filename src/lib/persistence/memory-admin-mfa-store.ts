import type { AdminMfaStore, TeacherMfaBackupEntry, TeacherMfaRecord } from "../../features/admin-mfa/types.ts";
import { isAdminMfaStatus } from "../../features/admin-mfa/types.ts";
import { parseRecoveryHashes, serializeRecoveryHashes } from "../auth/recovery-codes.ts";

function cloneRecord(record: TeacherMfaRecord): TeacherMfaRecord {
  return {
    ...record,
    recoveryHashes: [...record.recoveryHashes],
  };
}

export class MemoryAdminMfaStore implements AdminMfaStore {
  private readonly rows = new Map<string, TeacherMfaRecord>();

  async get(teacherId: string): Promise<TeacherMfaRecord | null> {
    const row = this.rows.get(teacherId);
    return row ? cloneRecord(row) : null;
  }

  async upsert(record: TeacherMfaRecord): Promise<void> {
    this.rows.set(record.teacherId, cloneRecord(record));
  }

  async deleteForTeacher(teacherId: string): Promise<void> {
    this.rows.delete(teacherId);
  }

  async exportAll(): Promise<TeacherMfaBackupEntry[]> {
    return [...this.rows.values()]
      .sort((left, right) => left.teacherId.localeCompare(right.teacherId))
      .map((row) => ({
        teacher_id: row.teacherId,
        status: row.status,
        secret_encrypted: row.secretEncrypted,
        pending_secret_encrypted: row.pendingSecretEncrypted,
        recovery_hashes: row.recoveryHashes.length ? serializeRecoveryHashes(row.recoveryHashes) : null,
        confirmed_at: row.confirmedAt,
        updated_at: row.updatedAt,
      }));
  }

  async replaceAll(entries: TeacherMfaBackupEntry[]): Promise<void> {
    this.rows.clear();
    for (const entry of entries) {
      const record = recordFromBackup(entry);
      if (record) this.rows.set(record.teacherId, record);
    }
  }
}

export function recordFromBackup(entry: TeacherMfaBackupEntry): TeacherMfaRecord | null {
  const teacherId = entry.teacher_id?.trim();
  if (!teacherId || !isAdminMfaStatus(entry.status)) return null;
  return {
    teacherId,
    status: entry.status,
    secretEncrypted: entry.secret_encrypted || null,
    pendingSecretEncrypted: entry.pending_secret_encrypted || null,
    recoveryHashes: parseRecoveryHashes(entry.recovery_hashes),
    confirmedAt: entry.confirmed_at || null,
    updatedAt: entry.updated_at || new Date().toISOString(),
  };
}

let memoryAdminMfaStore: MemoryAdminMfaStore | null = null;

export function getMemoryAdminMfaStore(): MemoryAdminMfaStore {
  memoryAdminMfaStore ??= new MemoryAdminMfaStore();
  return memoryAdminMfaStore;
}

export function resetMemoryAdminMfaStore(): void {
  memoryAdminMfaStore = null;
}
