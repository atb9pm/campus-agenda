import {
  buildDefaultSchoolBranches,
  buildDefaultSchoolClasses,
  normalizeClassCode,
} from "../../../features/school-catalog/index.ts";
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
}): SchoolClassRecord {
  return {
    id: row.id,
    code: row.code,
    label: row.label,
    sortOrder: row.sort_order,
    isActive: Boolean(row.is_active),
    schoolYearLabel: row.school_year_label,
  };
}

function mapBranch(row: {
  id: string;
  code: string;
  label: string;
  sort_order: number;
  is_active: number;
  archived_at: string | null;
}): SchoolBranchRecord {
  return {
    id: row.id,
    code: row.code,
    label: row.label,
    sortOrder: row.sort_order,
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

  async ensureSeeded(): Promise<void> {
    const classCount = await this.db
      .prepare("SELECT COUNT(*) AS count FROM school_classes")
      .bind()
      .first<{ count: number }>();
    if (Number(classCount?.count ?? 0) === 0) {
      for (const entry of buildDefaultSchoolClasses()) {
        await this.db
          .prepare(
            `INSERT INTO school_classes (id, code, label, sort_order, is_active, school_year_label)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .bind(entry.id, entry.code, entry.label, entry.sortOrder, entry.isActive ? 1 : 0, entry.schoolYearLabel)
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
            `INSERT INTO school_branches (id, code, label, sort_order, is_active, archived_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .bind(entry.id, entry.code, entry.label, entry.sortOrder, entry.isActive ? 1 : 0, entry.archivedAt)
          .run();
      }
    }
  }

  async listClasses(): Promise<SchoolClassRecord[]> {
    await this.ensureSeeded();
    const rows = await this.db
      .prepare(
        `SELECT id, code, label, sort_order, is_active, school_year_label
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
      }>();
    return (rows.results ?? []).map(mapClass);
  }

  async listBranches(): Promise<SchoolBranchRecord[]> {
    await this.ensureSeeded();
    const rows = await this.db
      .prepare(
        `SELECT id, code, label, sort_order, is_active, archived_at
         FROM school_branches ORDER BY sort_order ASC, label ASC`,
      )
      .bind()
      .all<{
        id: string;
        code: string;
        label: string;
        sort_order: number;
        is_active: number;
        archived_at: string | null;
      }>();
    return (rows.results ?? []).map(mapBranch);
  }

  async createClass(input: SchoolClassInput): Promise<SchoolClassRecord> {
    await this.ensureSeeded();
    const record: SchoolClassRecord = {
      id: createId("school-class"),
      code: normalizeClassCode(input.code),
      label: input.label.trim() || normalizeClassCode(input.code),
      sortOrder: input.sortOrder ?? 0,
      isActive: input.isActive ?? true,
      schoolYearLabel: input.schoolYearLabel ?? null,
    };
    await this.db
      .prepare(
        `INSERT INTO school_classes (id, code, label, sort_order, is_active, school_year_label)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(record.id, record.code, record.label, record.sortOrder, record.isActive ? 1 : 0, record.schoolYearLabel)
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
    };
    await this.db
      .prepare(
        `UPDATE school_classes
         SET code = ?, label = ?, sort_order = ?, is_active = ?, school_year_label = ?
         WHERE id = ?`,
      )
      .bind(next.code, next.label, next.sortOrder, next.isActive ? 1 : 0, next.schoolYearLabel, id)
      .run();
    return next;
  }

  async createBranch(input: SchoolBranchInput): Promise<SchoolBranchRecord> {
    await this.ensureSeeded();
    const archivedAt = input.isArchived ? new Date().toISOString() : null;
    const record: SchoolBranchRecord = {
      id: createId("school-branch"),
      code: normalizeClassCode(input.code),
      label: input.label.trim(),
      sortOrder: input.sortOrder ?? 0,
      isActive: input.isActive ?? true,
      isArchived: archivedAt !== null,
      archivedAt,
    };
    await this.db
      .prepare(
        `INSERT INTO school_branches (id, code, label, sort_order, is_active, archived_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(record.id, record.code, record.label, record.sortOrder, record.isActive ? 1 : 0, record.archivedAt)
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
}
