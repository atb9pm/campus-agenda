import {
  buildTeacherId,
  checkAccountInput,
  initialsKey,
  normalizeDisplayName,
  normalizeInitials,
  sortAccounts,
  wouldRemoveLastAdmin,
} from "../../../features/teacher-accounts/rules.ts";
import type {
  TeacherAccountInput,
  TeacherAccountPatch,
  TeacherAccountRecord,
  TeacherAccountResult,
  TeacherAccountSecretResult,
  TeacherAuthOutcome,
  TeacherPasswordChangeResult,
} from "../../../features/teacher-accounts/types.ts";
import {
  checkPasswordStrength,
  generateTemporaryPassword,
  hashPassword,
  isUsablePasswordHash,
  verifyPassword,
} from "../../auth/password.ts";
import type { TeacherAccountStore } from "../teacher-account-types.ts";
import type { SqlDatabase } from "./types.ts";

interface TeacherRow {
  id: string;
  display_name: string;
  initials: string;
  password_hash: string;
  is_admin: number | null;
  is_active: number | null;
  must_change_password: number | null;
  created_at: string | null;
  password_updated_at: string | null;
  archived_at: string | null;
  last_login_at: string | null;
}

const TEACHER_COLUMNS =
  "id, display_name, initials, password_hash, is_admin, is_active, must_change_password, created_at, password_updated_at, archived_at, last_login_at";

function toRecord(row: TeacherRow): TeacherAccountRecord {
  return {
    id: row.id,
    displayName: row.display_name,
    initials: row.initials,
    isAdmin: Boolean(row.is_admin),
    isActive: row.is_active === null ? true : Boolean(row.is_active),
    isArchived: row.archived_at !== null,
    archivedAt: row.archived_at,
    lastLoginAt: row.last_login_at,
    mustChangePassword: Boolean(row.must_change_password),
    hasPassword: isUsablePasswordHash(row.password_hash),
    createdAt: row.created_at,
    passwordUpdatedAt: row.password_updated_at,
  };
}

export class SqlTeacherAccountStore implements TeacherAccountStore {
  private readonly db: SqlDatabase;

  constructor(db: SqlDatabase) {
    this.db = db;
  }

  private async rows(): Promise<TeacherRow[]> {
    const { results } = await this.db
      .prepare(`SELECT ${TEACHER_COLUMNS} FROM teachers`)
      .bind()
      .all<TeacherRow>();
    return results;
  }

  private async row(teacherId: string): Promise<TeacherRow | null> {
    return this.db
      .prepare(`SELECT ${TEACHER_COLUMNS} FROM teachers WHERE id = ? LIMIT 1`)
      .bind(teacherId)
      .first<TeacherRow>();
  }

  private async rowByInitials(initials: string): Promise<TeacherRow | null> {
    const key = initialsKey(initials);
    if (!key) return null;
    const rows = await this.rows();
    return rows.find((row) => initialsKey(row.initials) === key) ?? null;
  }

  async listAccounts(): Promise<TeacherAccountRecord[]> {
    return sortAccounts((await this.rows()).map(toRecord));
  }

  async findAccount(teacherId: string): Promise<TeacherAccountRecord | null> {
    const row = await this.row(teacherId);
    return row ? toRecord(row) : null;
  }

  async findAccountByInitials(initials: string): Promise<TeacherAccountRecord | null> {
    const row = await this.rowByInitials(initials);
    return row ? toRecord(row) : null;
  }

  async createAccount(input: TeacherAccountInput): Promise<TeacherAccountSecretResult> {
    const check = checkAccountInput(input.displayName, input.initials);
    if (!check.ok) return { ok: false, reason: check.reason, status: 400 };

    const initials = normalizeInitials(input.initials);
    if (await this.rowByInitials(initials)) {
      return { ok: false, reason: `Les initiales ${initials} sont déjà utilisées.`, status: 409 };
    }

    const existingIds = (await this.rows()).map((row) => row.id);
    const teacherId = buildTeacherId(initials, existingIds);
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);

    await this.db
      .prepare(
        `INSERT INTO teachers
          (id, display_name, initials, password_hash, is_admin, is_active, must_change_password, password_updated_at)
         VALUES (?, ?, ?, ?, ?, 1, 1, datetime('now'))`,
      )
      .bind(teacherId, normalizeDisplayName(input.displayName), initials, passwordHash, input.isAdmin ? 1 : 0)
      .run();

    const created = await this.row(teacherId);
    if (!created) return { ok: false, reason: "Création du compte impossible.", status: 400 };
    return { ok: true, account: toRecord(created), temporaryPassword };
  }

  async updateAccount(teacherId: string, patch: TeacherAccountPatch): Promise<TeacherAccountResult> {
    const row = await this.row(teacherId);
    if (!row) return { ok: false, reason: "Compte enseignant introuvable.", status: 404 };

    let initials = row.initials;
    if (patch.initials !== undefined) {
      initials = normalizeInitials(patch.initials);
      if (initials.length < 2) {
        return { ok: false, reason: "Les initiales doivent contenir au moins deux lettres.", status: 400 };
      }
      const conflict = await this.rowByInitials(initials);
      if (conflict && conflict.id !== teacherId) {
        return { ok: false, reason: `Les initiales ${initials} sont déjà utilisées.`, status: 409 };
      }
    }

    let displayName = row.display_name;
    if (patch.displayName !== undefined) {
      displayName = normalizeDisplayName(patch.displayName);
      if (displayName.length < 2) return { ok: false, reason: "Le nom affiché est requis.", status: 400 };
    }

    if (
      patch.isAdmin !== undefined
      || patch.isActive !== undefined
      || patch.isArchived !== undefined
    ) {
      const records = (await this.rows()).map(toRecord);
      if (wouldRemoveLastAdmin(records, teacherId, patch)) {
        return { ok: false, reason: "Au moins un administrateur actif doit rester.", status: 400 };
      }
    }

    const isAdmin = patch.isAdmin ?? Boolean(row.is_admin);
    let isActive = patch.isActive ?? (row.is_active === null ? true : Boolean(row.is_active));
    let archivedAt = row.archived_at;
    if (patch.isArchived === true) {
      archivedAt = row.archived_at ?? new Date().toISOString();
      isActive = false;
    } else if (patch.isArchived === false) {
      archivedAt = null;
    }

    await this.db
      .prepare(
        `UPDATE teachers
         SET display_name = ?, initials = ?, is_admin = ?, is_active = ?, archived_at = ?
         WHERE id = ?`,
      )
      .bind(displayName, initials, isAdmin ? 1 : 0, isActive ? 1 : 0, archivedAt, teacherId)
      .run();

    const updated = await this.row(teacherId);
    if (!updated) return { ok: false, reason: "Compte enseignant introuvable.", status: 404 };
    return { ok: true, account: toRecord(updated) };
  }

  async resetPassword(teacherId: string): Promise<TeacherAccountSecretResult> {
    const row = await this.row(teacherId);
    if (!row) return { ok: false, reason: "Compte enseignant introuvable.", status: 404 };

    const temporaryPassword = generateTemporaryPassword();
    await this.writePassword(teacherId, temporaryPassword, true);

    const updated = await this.row(teacherId);
    if (!updated) return { ok: false, reason: "Compte enseignant introuvable.", status: 404 };
    return { ok: true, account: toRecord(updated), temporaryPassword };
  }

  private async writePassword(teacherId: string, password: string, mustChange: boolean): Promise<void> {
    const passwordHash = await hashPassword(password.trim());
    await this.db
      .prepare(
        `UPDATE teachers
         SET password_hash = ?, must_change_password = ?, password_updated_at = datetime('now')
         WHERE id = ?`,
      )
      .bind(passwordHash, mustChange ? 1 : 0, teacherId)
      .run();
  }

  async changeOwnPassword(
    teacherId: string,
    currentPassword: string,
    nextPassword: string,
  ): Promise<TeacherPasswordChangeResult> {
    const row = await this.row(teacherId);
    if (!row) return { ok: false, reason: "Compte enseignant introuvable.", status: 404 };
    if (!(await verifyPassword(currentPassword, row.password_hash))) {
      return { ok: false, reason: "Mot de passe actuel incorrect.", status: 401 };
    }
    const strength = checkPasswordStrength(nextPassword);
    if (!strength.ok) return { ok: false, reason: strength.reason, status: 400 };

    await this.writePassword(teacherId, nextPassword, false);
    return { ok: true };
  }

  async setPassword(teacherId: string, password: string, mustChangePassword: boolean): Promise<boolean> {
    if (!(await this.row(teacherId))) return false;
    await this.writePassword(teacherId, password, mustChangePassword);
    return true;
  }

  async authenticate(initialsOrId: string, password: string): Promise<TeacherAuthOutcome> {
    const candidate = initialsOrId.trim();
    const row = (await this.rowByInitials(candidate)) ?? (await this.row(candidate));
    if (!row) return { ok: false, reason: "Initiales ou mot de passe incorrect." };
    if (!(await verifyPassword(password, row.password_hash))) {
      return { ok: false, reason: "Initiales ou mot de passe incorrect." };
    }
    if (row.archived_at !== null) {
      return { ok: false, reason: "Ce compte est archivé. Contactez l'administrateur." };
    }
    if (row.is_active !== null && !row.is_active) {
      return { ok: false, reason: "Ce compte est désactivé. Contactez l'administrateur." };
    }
    await this.db
      .prepare("UPDATE teachers SET last_login_at = datetime('now') WHERE id = ?")
      .bind(row.id)
      .run();
    return { ok: true, teacherId: row.id, mustChangePassword: Boolean(row.must_change_password) };
  }

  async mustChangePassword(teacherId: string): Promise<boolean> {
    const row = await this.row(teacherId);
    return Boolean(row?.must_change_password);
  }
}
