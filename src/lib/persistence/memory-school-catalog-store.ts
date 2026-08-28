import {
  buildDefaultSchoolBranches,
  buildDefaultSchoolClasses,
  normalizeClassCode,
} from "../../features/school-catalog/index.ts";
import type { SchoolBranchInput, SchoolBranchRecord, SchoolClassInput, SchoolClassRecord } from "../../features/school-catalog/types.ts";
import type { SchoolCatalogStore } from "./school-catalog-types.ts";

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export class MemorySchoolCatalogStore implements SchoolCatalogStore {
  private classes: SchoolClassRecord[] = [];
  private branches: SchoolBranchRecord[] = [];
  private seeded = false;

  async ensureSeeded(): Promise<void> {
    if (this.seeded) return;
    this.classes = buildDefaultSchoolClasses();
    this.branches = buildDefaultSchoolBranches();
    this.seeded = true;
  }

  async listClasses(): Promise<SchoolClassRecord[]> {
    await this.ensureSeeded();
    return [...this.classes];
  }

  async listBranches(): Promise<SchoolBranchRecord[]> {
    await this.ensureSeeded();
    return [...this.branches];
  }

  async createClass(input: SchoolClassInput): Promise<SchoolClassRecord> {
    await this.ensureSeeded();
    const record: SchoolClassRecord = {
      id: createId("school-class"),
      code: normalizeClassCode(input.code),
      label: input.label.trim() || normalizeClassCode(input.code),
      sortOrder: input.sortOrder ?? this.classes.length + 1,
      isActive: input.isActive ?? true,
      schoolYearLabel: input.schoolYearLabel ?? null,
    };
    this.classes.push(record);
    return record;
  }

  async updateClass(id: string, patch: Partial<SchoolClassInput>): Promise<SchoolClassRecord | null> {
    await this.ensureSeeded();
    const index = this.classes.findIndex((entry) => entry.id === id);
    if (index < 0) return null;
    const current = this.classes[index];
    const next: SchoolClassRecord = {
      ...current,
      code: patch.code !== undefined ? normalizeClassCode(patch.code) : current.code,
      label: patch.label !== undefined ? patch.label.trim() : current.label,
      sortOrder: patch.sortOrder ?? current.sortOrder,
      isActive: patch.isActive ?? current.isActive,
      schoolYearLabel:
        patch.schoolYearLabel !== undefined ? patch.schoolYearLabel : current.schoolYearLabel,
    };
    this.classes[index] = next;
    return next;
  }

  async createBranch(input: SchoolBranchInput): Promise<SchoolBranchRecord> {
    await this.ensureSeeded();
    const record: SchoolBranchRecord = {
      id: createId("school-branch"),
      code: normalizeClassCode(input.code),
      label: input.label.trim(),
      sortOrder: input.sortOrder ?? this.branches.length + 1,
      isActive: input.isActive ?? true,
    };
    this.branches.push(record);
    return record;
  }

  async updateBranch(id: string, patch: Partial<SchoolBranchInput>): Promise<SchoolBranchRecord | null> {
    await this.ensureSeeded();
    const index = this.branches.findIndex((entry) => entry.id === id);
    if (index < 0) return null;
    const current = this.branches[index];
    const next: SchoolBranchRecord = {
      ...current,
      code: patch.code !== undefined ? normalizeClassCode(patch.code) : current.code,
      label: patch.label !== undefined ? patch.label.trim() : current.label,
      sortOrder: patch.sortOrder ?? current.sortOrder,
      isActive: patch.isActive ?? current.isActive,
    };
    this.branches[index] = next;
    return next;
  }
}

let memoryCatalogStore: MemorySchoolCatalogStore | null = null;

export function getMemorySchoolCatalogStore(): MemorySchoolCatalogStore {
  if (!memoryCatalogStore) memoryCatalogStore = new MemorySchoolCatalogStore();
  return memoryCatalogStore;
}

export function resetMemorySchoolCatalogStore(): void {
  memoryCatalogStore = null;
}
