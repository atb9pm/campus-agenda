import { normalizeTeacherSetup } from "../../../features/teacher-setup/queries.ts";
import { parseStoredTeacherSetup, serializeTeacherSetup } from "../../../features/teacher-setup/storage.ts";
import type { TeacherSetupConfig } from "../../../features/teacher-setup/types.ts";
import type { TeacherSetupStore } from "../teacher-setup-types.ts";
import type { SqlDatabase } from "./types.ts";

export class SqlTeacherSetupStore implements TeacherSetupStore {
  private readonly db: SqlDatabase;

  constructor(db: SqlDatabase) {
    this.db = db;
  }

  async getSetup(teacherId: string): Promise<TeacherSetupConfig | null> {
    const row = await this.db
      .prepare("SELECT config_json FROM teacher_setups WHERE teacher_id = ? LIMIT 1")
      .bind(teacherId)
      .first<{ config_json: string }>();
    if (!row) return null;
    const parsed = parseStoredTeacherSetup(row.config_json);
    return parsed ? normalizeTeacherSetup(parsed) : null;
  }

  async saveSetup(teacherId: string, config: TeacherSetupConfig): Promise<TeacherSetupConfig> {
    const normalized = normalizeTeacherSetup(config);
    await this.db
      .prepare(
        `INSERT INTO teacher_setups (teacher_id, config_json, updated_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(teacher_id) DO UPDATE SET
           config_json = excluded.config_json,
           updated_at = datetime('now')`,
      )
      .bind(teacherId, serializeTeacherSetup(normalized))
      .run();
    return normalized;
  }
}
