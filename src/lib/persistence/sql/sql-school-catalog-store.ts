import {
  formatAdminCode,
  parseAdminCodeSequence,
  type AdminCodeKind,
} from "../../../features/school-catalog/admin-codes.ts";
import {
  buildDefaultSchoolBranches,
  buildDefaultSchoolClasses,
  normalizeClassCode,
} from "../../../features/school-catalog/index.ts";
import {
  branchDeleteBlockers,
  canReduceProfessionDuration,
  professionDeleteBlockers,
} from "../../../features/school-catalog/profession-rules.ts";
import type {
  PedagogicalContextInput,
  PedagogicalContextRecord,
  PedagogyMutationResult,
  SchoolProfessionInput,
  SchoolProfessionRecord,
} from "../../../features/school-catalog/profession-types.ts";
import type {
  SchoolBranchInput,
  SchoolBranchRecord,
  SchoolClassInput,
  SchoolClassRecord,
} from "../../../features/school-catalog/types.ts";
import type { SchoolCatalogStore } from "../school-catalog-types.ts";
import type { SqlDatabase } from "./types.ts";

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function mapClass(row: {
  id: string;
  code: string;
  label: string;
  sort_order: number;
  is_active: number;
  school_year_label: string | null;
  profession_id: string | null;
  training_year: number | null;
}): SchoolClassRecord {
  return {
    id: row.id,
    code: row.code,
    label: row.label,
    sortOrder: row.sort_order,
    isActive: Boolean(row.is_active),
    schoolYearLabel: row.school_year_label,
    professionId: row.profession_id ?? null,
    trainingYear: row.training_year ?? null,
  };
}

function mapBranch(row: {
  id: string;
  code: string;
  label: string;
  sort_order: number;
  is_active: number;
  admin_code: string | null;
  archived_at: string | null;
}): SchoolBranchRecord {
  return {
    id: row.id,
    code: row.code,
    label: row.label,
    sortOrder: row.sort_order,
    isActive: Boolean(row.is_active),
    adminCode: row.admin_code ?? "",
    isArchived: row.archived_at !== null,
    archivedAt: row.archived_at,
  };
}

function mapProfession(row: {
  id: string;
  admin_code: string;
  label: string;
  duration_years: number;
  sort_order: number;
  is_active: number;
  archived_at: string | null;
}): SchoolProfessionRecord {
  return {
    id: row.id,
    adminCode: row.admin_code,
    label: row.label,
    durationYears: row.duration_years,
    sortOrder: row.sort_order,
    isActive: Boolean(row.is_active),
    isArchived: row.archived_at !== null,
    archivedAt: row.archived_at,
  };
}

function mapContext(row: {
  id: string;
  admin_code: string;
  profession_id: string;
  training_year: number;
  branch_id: string;
  is_active: number;
  archived_at: string | null;
}): PedagogicalContextRecord {
  return {
    id: row.id,
    adminCode: row.admin_code,
    professionId: row.profession_id,
    trainingYear: row.training_year,
    branchId: row.branch_id,
    isActive: Boolean(row.is_active),
    isArchived: row.archived_at !== null,
    archivedAt: row.archived_at,
  };
}

export class SqlSchoolCatalogStore implements SchoolCatalogStore {
  // Champ explicite : `constructor(private …)` n'est pas supporté par
  // `node --experimental-strip-types` (suite `npm test`).
  private readonly db: SqlDatabase;

  constructor(db: SqlDatabase) {
    this.db = db;
  }

  private async ensureCounterRow(kind: AdminCodeKind): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO admin_code_counters (kind, next_value)
         VALUES (?, 1)
         ON CONFLICT(kind) DO NOTHING`,
      )
      .bind(kind)
      .run();
  }

  private async nextAdminCode(kind: AdminCodeKind): Promise<string> {
    await this.ensureCounterRow(kind);
    const row = await this.db
      .prepare("SELECT next_value FROM admin_code_counters WHERE kind = ?")
      .bind(kind)
      .first<{ next_value: number }>();
    const sequence = Number(row?.next_value ?? 1);
    await this.db
      .prepare("UPDATE admin_code_counters SET next_value = ? WHERE kind = ?")
      .bind(sequence + 1, kind)
      .run();
    return formatAdminCode(kind, sequence);
  }

  private async syncCounterFromExisting(kind: AdminCodeKind, adminCodes: string[]): Promise<void> {
    let maxSequence = 0;
    for (const code of adminCodes) {
      const sequence = parseAdminCodeSequence(code, kind);
      if (sequence !== null && sequence > maxSequence) maxSequence = sequence;
    }
    const nextValue = maxSequence + 1;
    await this.ensureCounterRow(kind);
    const row = await this.db
      .prepare("SELECT next_value FROM admin_code_counters WHERE kind = ?")
      .bind(kind)
      .first<{ next_value: number }>();
    const current = Number(row?.next_value ?? 1);
    if (nextValue > current) {
      await this.db
        .prepare("UPDATE admin_code_counters SET next_value = ? WHERE kind = ?")
        .bind(nextValue, kind)
        .run();
    }
  }

  private async backfillBranchAdminCodes(): Promise<void> {
    const rows = await this.db
      .prepare(
        `SELECT id, admin_code FROM school_branches
         ORDER BY sort_order ASC, label ASC`,
      )
      .bind()
      .all<{ id: string; admin_code: string | null }>();
    const existing = rows.results ?? [];
    const existingCodes = existing
      .map((row) => row.admin_code)
      .filter((code): code is string => Boolean(code));
    // Aligner le compteur avant d’attribuer les codes manquants (évite les collisions).
    await this.syncCounterFromExisting("BR", existingCodes);

    for (const row of existing) {
      if (row.admin_code) continue;
      const adminCode = await this.nextAdminCode("BR");
      await this.db
        .prepare("UPDATE school_branches SET admin_code = ? WHERE id = ?")
        .bind(adminCode, row.id)
        .run();
    }
  }

  async ensureSeeded(): Promise<void> {
    const classCount = await this.db
      .prepare("SELECT COUNT(*) AS count FROM school_classes")
      .bind()
      .first<{ count: number }>();
    if (Number(classCount?.count ?? 0) === 0) {
      for (const entry of buildDefaultSchoolClasses()) {
        await this.db
          .prepare(
            `INSERT INTO school_classes
               (id, code, label, sort_order, is_active, school_year_label, profession_id, training_year)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            entry.id,
            entry.code,
            entry.label,
            entry.sortOrder,
            entry.isActive ? 1 : 0,
            entry.schoolYearLabel,
            entry.professionId,
            entry.trainingYear,
          )
          .run();
      }
    }

    const branchCount = await this.db
      .prepare("SELECT COUNT(*) AS count FROM school_branches")
      .bind()
      .first<{ count: number }>();
    if (Number(branchCount?.count ?? 0) === 0) {
      for (const entry of buildDefaultSchoolBranches()) {
        await this.db
          .prepare(
            `INSERT INTO school_branches
               (id, code, label, sort_order, is_active, admin_code, archived_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            entry.id,
            entry.code,
            entry.label,
            entry.sortOrder,
            entry.isActive ? 1 : 0,
            entry.adminCode,
            entry.archivedAt,
          )
          .run();
      }
    }

    await this.backfillBranchAdminCodes();
    await this.ensureCounterRow("PRF");
    await this.ensureCounterRow("CTX");

    const professionCodes = await this.db
      .prepare("SELECT admin_code FROM school_professions")
      .bind()
      .all<{ admin_code: string }>();
    await this.syncCounterFromExisting(
      "PRF",
      (professionCodes.results ?? []).map((row) => row.admin_code),
    );

    const contextCodes = await this.db
      .prepare("SELECT admin_code FROM pedagogical_contexts")
      .bind()
      .all<{ admin_code: string }>();
    await this.syncCounterFromExisting(
      "CTX",
      (contextCodes.results ?? []).map((row) => row.admin_code),
    );
  }

  async listClasses(): Promise<SchoolClassRecord[]> {
    await this.ensureSeeded();
    const rows = await this.db
      .prepare(
        `SELECT id, code, label, sort_order, is_active, school_year_label,
                profession_id, training_year
         FROM school_classes ORDER BY sort_order ASC, code ASC`,
      )
      .bind()
      .all<{
        id: string;
        code: string;
        label: string;
        sort_order: number;
        is_active: number;
        school_year_label: string | null;
        profession_id: string | null;
        training_year: number | null;
      }>();
    return (rows.results ?? []).map(mapClass);
  }

  async listBranches(): Promise<SchoolBranchRecord[]> {
    await this.ensureSeeded();
    const rows = await this.db
      .prepare(
        `SELECT id, code, label, sort_order, is_active, admin_code, archived_at
         FROM school_branches ORDER BY sort_order ASC, label ASC`,
      )
      .bind()
      .all<{
        id: string;
        code: string;
        label: string;
        sort_order: number;
        is_active: number;
        admin_code: string | null;
        archived_at: string | null;
      }>();
    return (rows.results ?? []).map(mapBranch);
  }

  async listProfessions(): Promise<SchoolProfessionRecord[]> {
    await this.ensureSeeded();
    const rows = await this.db
      .prepare(
        `SELECT id, admin_code, label, duration_years, sort_order, is_active, archived_at
         FROM school_professions ORDER BY sort_order ASC, label ASC`,
      )
      .bind()
      .all<{
        id: string;
        admin_code: string;
        label: string;
        duration_years: number;
        sort_order: number;
        is_active: number;
        archived_at: string | null;
      }>();
    return (rows.results ?? []).map(mapProfession);
  }

  async listContexts(): Promise<PedagogicalContextRecord[]> {
    await this.ensureSeeded();
    const rows = await this.db
      .prepare(
        `SELECT id, admin_code, profession_id, training_year, branch_id, is_active, archived_at
         FROM pedagogical_contexts
         ORDER BY profession_id ASC, training_year ASC, branch_id ASC`,
      )
      .bind()
      .all<{
        id: string;
        admin_code: string;
        profession_id: string;
        training_year: number;
        branch_id: string;
        is_active: number;
        archived_at: string | null;
      }>();
    return (rows.results ?? []).map(mapContext);
  }

  async createClass(input: SchoolClassInput): Promise<SchoolClassRecord> {
    await this.ensureSeeded();
    const count = await this.db
      .prepare("SELECT COUNT(*) AS count FROM school_classes")
      .bind()
      .first<{ count: number }>();
    const record: SchoolClassRecord = {
      id: createId("school-class"),
      code: normalizeClassCode(input.code),
      label: input.label.trim() || normalizeClassCode(input.code),
      sortOrder: input.sortOrder ?? Number(count?.count ?? 0) + 1,
      isActive: input.isActive ?? true,
      schoolYearLabel: input.schoolYearLabel ?? null,
      professionId: input.professionId ?? null,
      trainingYear: input.trainingYear ?? null,
    };
    await this.db
      .prepare(
        `INSERT INTO school_classes
           (id, code, label, sort_order, is_active, school_year_label, profession_id, training_year)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        record.id,
        record.code,
        record.label,
        record.sortOrder,
        record.isActive ? 1 : 0,
        record.schoolYearLabel,
        record.professionId,
        record.trainingYear,
      )
      .run();
    return record;
  }

  async updateClass(id: string, patch: Partial<SchoolClassInput>): Promise<SchoolClassRecord | null> {
    await this.ensureSeeded();
    const current = (await this.listClasses()).find((entry) => entry.id === id);
    if (!current) return null;
    const next: SchoolClassRecord = {
      ...current,
      code: patch.code !== undefined ? normalizeClassCode(patch.code) : current.code,
      label: patch.label !== undefined ? patch.label.trim() : current.label,
      sortOrder: patch.sortOrder ?? current.sortOrder,
      isActive: patch.isActive ?? current.isActive,
      schoolYearLabel:
        patch.schoolYearLabel !== undefined ? patch.schoolYearLabel : current.schoolYearLabel,
      professionId: patch.professionId !== undefined ? patch.professionId : current.professionId,
      trainingYear: patch.trainingYear !== undefined ? patch.trainingYear : current.trainingYear,
    };
    await this.db
      .prepare(
        `UPDATE school_classes
         SET code = ?, label = ?, sort_order = ?, is_active = ?, school_year_label = ?,
             profession_id = ?, training_year = ?
         WHERE id = ?`,
      )
      .bind(
        next.code,
        next.label,
        next.sortOrder,
        next.isActive ? 1 : 0,
        next.schoolYearLabel,
        next.professionId,
        next.trainingYear,
        id,
      )
      .run();
    return next;
  }

  async createBranch(input: SchoolBranchInput): Promise<SchoolBranchRecord> {
    await this.ensureSeeded();
    const count = await this.db
      .prepare("SELECT COUNT(*) AS count FROM school_branches")
      .bind()
      .first<{ count: number }>();
    const archivedAt = input.isArchived ? new Date().toISOString() : null;
    const record: SchoolBranchRecord = {
      id: createId("school-branch"),
      code: normalizeClassCode(input.code),
      label: input.label.trim(),
      sortOrder: input.sortOrder ?? Number(count?.count ?? 0) + 1,
      isActive: input.isActive ?? true,
      adminCode: await this.nextAdminCode("BR"),
      isArchived: archivedAt !== null,
      archivedAt,
    };
    await this.db
      .prepare(
        `INSERT INTO school_branches
           (id, code, label, sort_order, is_active, admin_code, archived_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        record.id,
        record.code,
        record.label,
        record.sortOrder,
        record.isActive ? 1 : 0,
        record.adminCode,
        record.archivedAt,
      )
      .run();
    return record;
  }

  async updateBranch(id: string, patch: Partial<SchoolBranchInput>): Promise<SchoolBranchRecord | null> {
    await this.ensureSeeded();
    const current = (await this.listBranches()).find((entry) => entry.id === id);
    if (!current) return null;
    let archivedAt = current.archivedAt;
    if (patch.isArchived === true) {
      archivedAt = current.archivedAt ?? new Date().toISOString();
    } else if (patch.isArchived === false) {
      archivedAt = null;
    }
    const next: SchoolBranchRecord = {
      ...current,
      code: patch.code !== undefined ? normalizeClassCode(patch.code) : current.code,
      label: patch.label !== undefined ? patch.label.trim() : current.label,
      sortOrder: patch.sortOrder ?? current.sortOrder,
      isActive: patch.isActive ?? current.isActive,
      isArchived: archivedAt !== null,
      archivedAt,
    };
    await this.db
      .prepare(
        `UPDATE school_branches
         SET code = ?, label = ?, sort_order = ?, is_active = ?, archived_at = ?
         WHERE id = ?`,
      )
      .bind(next.code, next.label, next.sortOrder, next.isActive ? 1 : 0, next.archivedAt, id)
      .run();
    return next;
  }

  async deleteBranch(id: string): Promise<PedagogyMutationResult<{ id: string }>> {
    await this.ensureSeeded();
    const contexts = await this.listContexts();
    const reason = branchDeleteBlockers({ branchId: id, contexts });
    if (reason) return { ok: false, reason };
    const current = (await this.listBranches()).find((entry) => entry.id === id);
    if (!current) return { ok: false, reason: "Branche introuvable." };
    await this.db.prepare("DELETE FROM school_branches WHERE id = ?").bind(id).run();
    return { ok: true, value: { id } };
  }

  async createProfession(input: SchoolProfessionInput): Promise<SchoolProfessionRecord> {
    await this.ensureSeeded();
    const durationYears = Math.trunc(input.durationYears);
    if (durationYears < 1 || durationYears > 10) {
      throw new Error("La durée de formation doit être comprise entre 1 et 10 ans.");
    }
    const count = await this.db
      .prepare("SELECT COUNT(*) AS count FROM school_professions")
      .bind()
      .first<{ count: number }>();
    const archivedAt = input.isArchived ? new Date().toISOString() : null;
    const record: SchoolProfessionRecord = {
      id: createId("school-profession"),
      adminCode: await this.nextAdminCode("PRF"),
      label: input.label.trim(),
      durationYears,
      sortOrder: input.sortOrder ?? Number(count?.count ?? 0) + 1,
      isActive: input.isActive ?? true,
      isArchived: archivedAt !== null,
      archivedAt,
    };
    await this.db
      .prepare(
        `INSERT INTO school_professions
           (id, admin_code, label, duration_years, sort_order, is_active, archived_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        record.id,
        record.adminCode,
        record.label,
        record.durationYears,
        record.sortOrder,
        record.isActive ? 1 : 0,
        record.archivedAt,
      )
      .run();
    return record;
  }

  async updateProfession(
    id: string,
    patch: Partial<SchoolProfessionInput>,
  ): Promise<PedagogyMutationResult<SchoolProfessionRecord>> {
    await this.ensureSeeded();
    const current = (await this.listProfessions()).find((entry) => entry.id === id);
    if (!current) return { ok: false, reason: "Profession introuvable." };

    if (patch.durationYears !== undefined) {
      const check = canReduceProfessionDuration({
        profession: current,
        nextDurationYears: Math.trunc(patch.durationYears),
        contexts: await this.listContexts(),
        classes: await this.listClasses(),
      });
      if (!check.ok) return check;
    }

    let archivedAt = current.archivedAt;
    if (patch.isArchived === true) archivedAt = current.archivedAt ?? new Date().toISOString();
    else if (patch.isArchived === false) archivedAt = null;

    const next: SchoolProfessionRecord = {
      ...current,
      label: patch.label !== undefined ? patch.label.trim() : current.label,
      durationYears:
        patch.durationYears !== undefined ? Math.trunc(patch.durationYears) : current.durationYears,
      sortOrder: patch.sortOrder ?? current.sortOrder,
      isActive: patch.isActive ?? current.isActive,
      isArchived: archivedAt !== null,
      archivedAt,
    };
    await this.db
      .prepare(
        `UPDATE school_professions
         SET label = ?, duration_years = ?, sort_order = ?, is_active = ?, archived_at = ?
         WHERE id = ?`,
      )
      .bind(
        next.label,
        next.durationYears,
        next.sortOrder,
        next.isActive ? 1 : 0,
        next.archivedAt,
        id,
      )
      .run();
    return { ok: true, value: next };
  }

  async deleteProfession(id: string): Promise<PedagogyMutationResult<{ id: string }>> {
    await this.ensureSeeded();
    const reason = professionDeleteBlockers({
      professionId: id,
      contexts: await this.listContexts(),
      classes: await this.listClasses(),
    });
    if (reason) return { ok: false, reason };
    const current = (await this.listProfessions()).find((entry) => entry.id === id);
    if (!current) return { ok: false, reason: "Profession introuvable." };
    await this.db.prepare("DELETE FROM school_professions WHERE id = ?").bind(id).run();
    return { ok: true, value: { id } };
  }

  async createContext(
    input: PedagogicalContextInput,
  ): Promise<PedagogyMutationResult<PedagogicalContextRecord>> {
    await this.ensureSeeded();
    const profession = (await this.listProfessions()).find((entry) => entry.id === input.professionId);
    if (!profession) return { ok: false, reason: "Profession introuvable." };
    const trainingYear = Math.trunc(input.trainingYear);
    if (trainingYear < 1 || trainingYear > profession.durationYears) {
      return {
        ok: false,
        reason: `L'année de formation doit être entre 1 et ${profession.durationYears}.`,
      };
    }
    if (!(await this.listBranches()).some((entry) => entry.id === input.branchId)) {
      return { ok: false, reason: "Branche introuvable." };
    }
    const duplicate = (await this.listContexts()).find(
      (entry) =>
        entry.professionId === input.professionId &&
        entry.trainingYear === trainingYear &&
        entry.branchId === input.branchId,
    );
    if (duplicate) {
      return { ok: false, reason: `Cette combinaison existe déjà (${duplicate.adminCode}).` };
    }
    const archivedAt = input.isArchived ? new Date().toISOString() : null;
    const record: PedagogicalContextRecord = {
      id: createId("pedagogical-context"),
      adminCode: await this.nextAdminCode("CTX"),
      professionId: input.professionId,
      trainingYear,
      branchId: input.branchId,
      isActive: input.isActive ?? true,
      isArchived: archivedAt !== null,
      archivedAt,
    };
    await this.db
      .prepare(
        `INSERT INTO pedagogical_contexts
           (id, admin_code, profession_id, training_year, branch_id, is_active, archived_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        record.id,
        record.adminCode,
        record.professionId,
        record.trainingYear,
        record.branchId,
        record.isActive ? 1 : 0,
        record.archivedAt,
      )
      .run();
    return { ok: true, value: record };
  }

  async updateContext(
    id: string,
    patch: Partial<Pick<PedagogicalContextInput, "isActive" | "isArchived">>,
  ): Promise<PedagogicalContextRecord | null> {
    await this.ensureSeeded();
    const current = (await this.listContexts()).find((entry) => entry.id === id);
    if (!current) return null;
    let archivedAt = current.archivedAt;
    if (patch.isArchived === true) archivedAt = current.archivedAt ?? new Date().toISOString();
    else if (patch.isArchived === false) archivedAt = null;
    const next: PedagogicalContextRecord = {
      ...current,
      isActive: patch.isActive ?? current.isActive,
      isArchived: archivedAt !== null,
      archivedAt,
    };
    await this.db
      .prepare(
        `UPDATE pedagogical_contexts
         SET is_active = ?, archived_at = ?
         WHERE id = ?`,
      )
      .bind(next.isActive ? 1 : 0, next.archivedAt, id)
      .run();
    return next;
  }

  async deleteContext(id: string): Promise<PedagogyMutationResult<{ id: string }>> {
    await this.ensureSeeded();
    const current = (await this.listContexts()).find((entry) => entry.id === id);
    if (!current) return { ok: false, reason: "Contexte pédagogique introuvable." };
    await this.db.prepare("DELETE FROM pedagogical_contexts WHERE id = ?").bind(id).run();
    return { ok: true, value: { id } };
  }
}
