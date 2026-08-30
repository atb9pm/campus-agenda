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
  normalizeParallelCode,
  parseOptionalClassCodePrefix,
} from "../../../features/school-catalog/class-codes.ts";
import { prepareClassRecords } from "../../../features/school-catalog/class-prepare.ts";
import {
  assertClassCodeAvailable,
  assertProfessionPrefixAvailable,
  assertStructuredGroupAvailable,
} from "../../../features/school-catalog/class-uniqueness.ts";
import {
  branchDeleteBlockers,
  canReduceProfessionDuration,
  professionDeleteBlockers,
  validateClassProfessionAttachment,
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
  school_year_id: string | null;
  school_year_label: string | null;
  profession_id: string | null;
  training_year: number | null;
  parallel_code?: string | null;
}): SchoolClassRecord {
  return {
    id: row.id,
    code: row.code,
    label: row.label,
    sortOrder: row.sort_order,
    isActive: Boolean(row.is_active),
    schoolYearId: row.school_year_id ?? null,
    schoolYearLabel: row.school_year_label,
    professionId: row.profession_id ?? null,
    trainingYear: row.training_year ?? null,
    parallelCode: row.parallel_code ?? null,
  };
}

function parseStoredTeachingType(value: unknown): "TECHNICAL" | "GENERAL" | null {
  if (value === undefined || value === null || value === "") return null;
  if (value === "TECHNICAL" || value === "GENERAL") return value;
  throw new Error("Le type de la branche doit être TECHNICAL ou GENERAL.");
}

function mapBranch(row: {
  id: string;
  code: string;
  label: string;
  sort_order: number;
  is_active: number;
  admin_code: string | null;
  archived_at: string | null;
  teaching_type?: string | null;
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
    teachingType: row.teaching_type === "TECHNICAL" || row.teaching_type === "GENERAL"
      ? row.teaching_type
      : null,
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
  class_code_prefix?: string | null;
}): SchoolProfessionRecord {
  return {
    id: row.id,
    adminCode: row.admin_code,
    label: row.label,
    classCodePrefix: row.class_code_prefix ?? null,
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

  /**
   * Attribution atomique du prochain code (PRF/BR/CTX).
   * `next_value` = prochaine séquence à allouer. UPDATE…RETURNING sous le verrou
   * d’écriture SQLite empêche deux lecteurs d’obtenir la même valeur.
   * Les codes déjà émis ne sont jamais recyclés.
   */
  private async nextAdminCode(kind: AdminCodeKind): Promise<string> {
    await this.ensureCounterRow(kind);
    const row = await this.db
      .prepare(
        `UPDATE admin_code_counters
         SET next_value = next_value + 1
         WHERE kind = ?
         RETURNING next_value - 1 AS sequence`,
      )
      .bind(kind)
      .first<{ sequence: number }>();
    const sequence = Number(row?.sequence ?? 0);
    if (!Number.isInteger(sequence) || sequence < 1) {
      throw new Error(`Impossible d’attribuer un code administratif ${kind}.`);
    }
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
               (id, code, label, sort_order, is_active, school_year_id, school_year_label, profession_id, training_year, parallel_code)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            entry.id,
            entry.code,
            entry.label,
            entry.sortOrder,
            entry.isActive ? 1 : 0,
            entry.schoolYearId,
            entry.schoolYearLabel,
            entry.professionId,
            entry.trainingYear,
            entry.parallelCode,
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
               (id, code, label, sort_order, is_active, admin_code, archived_at, teaching_type)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            entry.id,
            entry.code,
            entry.label,
            entry.sortOrder,
            entry.isActive ? 1 : 0,
            entry.adminCode,
            entry.archivedAt,
            entry.teachingType,
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
        `SELECT id, code, label, sort_order, is_active, school_year_id, school_year_label,
                profession_id, training_year, parallel_code
         FROM school_classes ORDER BY sort_order ASC, code ASC`,
      )
      .bind()
      .all<{
        id: string;
        code: string;
        label: string;
        sort_order: number;
        is_active: number;
        school_year_id: string | null;
        school_year_label: string | null;
        profession_id: string | null;
        training_year: number | null;
        parallel_code: string | null;
      }>();
    return (rows.results ?? []).map(mapClass);
  }

  async listBranches(): Promise<SchoolBranchRecord[]> {
    await this.ensureSeeded();
    const rows = await this.db
      .prepare(
        `SELECT id, code, label, sort_order, is_active, admin_code, archived_at, teaching_type
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
        teaching_type: string | null;
      }>();
    return (rows.results ?? []).map(mapBranch);
  }

  async listProfessions(): Promise<SchoolProfessionRecord[]> {
    await this.ensureSeeded();
    const rows = await this.db
      .prepare(
        `SELECT id, admin_code, label, duration_years, sort_order, is_active, archived_at, class_code_prefix
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
        class_code_prefix: string | null;
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
    const [record] = await this.createClassesBatch([input]);
    return record!;
  }

  async createClassesBatch(inputs: SchoolClassInput[]): Promise<SchoolClassRecord[]> {
    await this.ensureSeeded();
    if (inputs.length === 0) return [];
    const [classes, professions] = await Promise.all([this.listClasses(), this.listProfessions()]);
    const prepared = prepareClassRecords(inputs, {
      professions,
      classes,
      createId: () => createId("school-class"),
      sortOrderStart: classes.length + 1,
    });
    if (!prepared.ok) throw new Error(prepared.reason);
    await this.db.batch(
      prepared.value.map((record) => ({
        sql: `INSERT INTO school_classes
           (id, code, label, sort_order, is_active, school_year_id, school_year_label, profession_id, training_year, parallel_code)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        values: [
          record.id,
          record.code,
          record.label,
          record.sortOrder,
          record.isActive ? 1 : 0,
          record.schoolYearId,
          record.schoolYearLabel,
          record.professionId,
          record.trainingYear,
          record.parallelCode,
        ],
      })),
    );
    return prepared.value;
  }

  async updateClass(id: string, patch: Partial<SchoolClassInput>): Promise<SchoolClassRecord | null> {
    await this.ensureSeeded();
    const current = (await this.listClasses()).find((entry) => entry.id === id);
    if (!current) return null;
    const attachment = validateClassProfessionAttachment({
      professionId: patch.professionId !== undefined ? patch.professionId : current.professionId,
      trainingYear: patch.trainingYear !== undefined ? patch.trainingYear : current.trainingYear,
      professions: await this.listProfessions(),
    });
    if (!attachment.ok) throw new Error(attachment.reason);
    const parallel =
      patch.parallelCode !== undefined
        ? normalizeParallelCode(patch.parallelCode)
        : { ok: true as const, value: current.parallelCode };
    if (!parallel.ok) throw new Error(parallel.reason);
    const nextCode = patch.code !== undefined ? normalizeClassCode(patch.code) : current.code;
    const nextYearId = patch.schoolYearId !== undefined ? patch.schoolYearId : current.schoolYearId;
    const available = assertClassCodeAvailable({
      code: nextCode,
      schoolYearId: nextYearId,
      classes: await this.listClasses(),
      excludeId: id,
    });
    if (!available.ok) throw new Error(available.reason);
    const group = assertStructuredGroupAvailable({
      schoolYearId: nextYearId,
      professionId: attachment.value.professionId,
      trainingYear: attachment.value.trainingYear,
      parallelCode: parallel.value,
      classes: await this.listClasses(),
      excludeId: id,
    });
    if (!group.ok) throw new Error(group.reason);
    const next: SchoolClassRecord = {
      ...current,
      code: nextCode,
      label: patch.label !== undefined ? patch.label.trim() : current.label,
      sortOrder: patch.sortOrder ?? current.sortOrder,
      isActive: patch.isActive ?? current.isActive,
      schoolYearId: nextYearId,
      schoolYearLabel:
        patch.schoolYearLabel !== undefined ? patch.schoolYearLabel : current.schoolYearLabel,
      professionId: attachment.value.professionId,
      trainingYear: attachment.value.trainingYear,
      parallelCode: parallel.value,
    };
    await this.db
      .prepare(
        `UPDATE school_classes
         SET code = ?, label = ?, sort_order = ?, is_active = ?, school_year_id = ?, school_year_label = ?,
             profession_id = ?, training_year = ?, parallel_code = ?
         WHERE id = ?`,
      )
      .bind(
        next.code,
        next.label,
        next.sortOrder,
        next.isActive ? 1 : 0,
        next.schoolYearId,
        next.schoolYearLabel,
        next.professionId,
        next.trainingYear,
        next.parallelCode,
        id,
      )
      .run();
    return next;
  }


  async applySchoolYearBackfill(
    years: Array<{ id: string; label: string }>,
  ): Promise<number> {
    await this.ensureSeeded();
    let updated = 0;
    const classes = await this.listClasses();
    for (const entry of classes) {
      if (entry.schoolYearId) continue;
      const matches = years.filter((year) => year.label.trim() === (entry.schoolYearLabel ?? "").trim());
      if (matches.length !== 1) continue;
      const year = matches[0]!;
      await this.db
        .prepare(
          `UPDATE school_classes
           SET school_year_id = ?, school_year_label = ?
           WHERE id = ? AND school_year_id IS NULL`,
        )
        .bind(year.id, year.label, entry.id)
        .run();
      updated += 1;
    }
    return updated;
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
      teachingType: parseStoredTeachingType(input.teachingType),
    };
    await this.db
      .prepare(
        `INSERT INTO school_branches
           (id, code, label, sort_order, is_active, admin_code, archived_at, teaching_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        record.id,
        record.code,
        record.label,
        record.sortOrder,
        record.isActive ? 1 : 0,
        record.adminCode,
        record.archivedAt,
        record.teachingType,
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
      teachingType:
        patch.teachingType !== undefined
          ? parseStoredTeachingType(patch.teachingType)
          : current.teachingType,
    };
    await this.db
      .prepare(
        `UPDATE school_branches
         SET code = ?, label = ?, sort_order = ?, is_active = ?, archived_at = ?, teaching_type = ?
         WHERE id = ?`,
      )
      .bind(
        next.code,
        next.label,
        next.sortOrder,
        next.isActive ? 1 : 0,
        next.archivedAt,
        next.teachingType,
        id,
      )
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
    const prefix = parseOptionalClassCodePrefix(input.classCodePrefix);
    if (!prefix.ok) throw new Error(prefix.reason);
    if (prefix.value) {
      const unique = assertProfessionPrefixAvailable({
        prefix: prefix.value,
        professions: await this.listProfessions(),
      });
      if (!unique.ok) throw new Error(unique.reason);
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
      classCodePrefix: prefix.value,
      durationYears,
      sortOrder: input.sortOrder ?? Number(count?.count ?? 0) + 1,
      isActive: input.isActive ?? true,
      isArchived: archivedAt !== null,
      archivedAt,
    };
    await this.db
      .prepare(
        `INSERT INTO school_professions
           (id, admin_code, label, duration_years, sort_order, is_active, archived_at, class_code_prefix)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        record.id,
        record.adminCode,
        record.label,
        record.durationYears,
        record.sortOrder,
        record.isActive ? 1 : 0,
        record.archivedAt,
        record.classCodePrefix,
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

    const prefix =
      patch.classCodePrefix !== undefined
        ? parseOptionalClassCodePrefix(patch.classCodePrefix)
        : { ok: true as const, value: current.classCodePrefix };
    if (!prefix.ok) return prefix;
    if (prefix.value) {
      const unique = assertProfessionPrefixAvailable({
        prefix: prefix.value,
        professions: await this.listProfessions(),
        excludeId: id,
      });
      if (!unique.ok) return unique;
    }
    const next: SchoolProfessionRecord = {
      ...current,
      label: patch.label !== undefined ? patch.label.trim() : current.label,
      classCodePrefix: prefix.value,
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
         SET label = ?, duration_years = ?, sort_order = ?, is_active = ?, archived_at = ?, class_code_prefix = ?
         WHERE id = ?`,
      )
      .bind(
        next.label,
        next.durationYears,
        next.sortOrder,
        next.isActive ? 1 : 0,
        next.archivedAt,
        next.classCodePrefix,
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
    const { contextDeleteBlockers } = await import("../../../features/school-catalog/ctx-guards.ts");
    const pathRow = await this.db
      .prepare("SELECT 1 AS ok FROM pedagogical_paths WHERE context_id = ? LIMIT 1")
      .bind(id)
      .first<{ ok: number }>();
    const noteRow = await this.db
      .prepare("SELECT COUNT(*) AS count FROM annual_course_notes WHERE context_id = ?")
      .bind(id)
      .first<{ count: number }>();
    const courseRow = await this.db
      .prepare("SELECT COUNT(*) AS count FROM annual_courses WHERE context_id = ?")
      .bind(id)
      .first<{ count: number }>();
    const blocker = contextDeleteBlockers({
      hasPedagogicalPath: Boolean(pathRow),
      hasAnnualNotes: Number(noteRow?.count ?? 0) > 0,
      hasAnnualCourse: Number(courseRow?.count ?? 0) > 0,
    });
    if (blocker) return { ok: false, reason: blocker };
    try {
      await this.db.prepare("DELETE FROM pedagogical_contexts WHERE id = ?").bind(id).run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("CTX used") || message.includes("archive instead")) {
        return {
          ok: false,
          reason:
            blocker ??
            contextDeleteBlockers({
              hasPedagogicalPath: true,
              hasAnnualNotes: false,
              hasAnnualCourse: true,
            })!,
        };
      }
      throw error;
    }
    return { ok: true, value: { id } };
  }
}
