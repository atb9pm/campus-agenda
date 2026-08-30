import { formatAdminCode, type AdminCodeKind } from "../../features/school-catalog/admin-codes.ts";
import {
  buildDefaultSchoolBranches,
  buildDefaultSchoolClasses,
  normalizeClassCode,
} from "../../features/school-catalog/index.ts";
import {
  branchDeleteBlockers,
  canReduceProfessionDuration,
  professionDeleteBlockers,
  validateClassProfessionAttachment,
} from "../../features/school-catalog/profession-rules.ts";
import { findUniqueSchoolYearIdForLabel } from "../../features/school-catalog/school-year-attachment.ts";
import type { SchoolYearRef } from "../../features/school-catalog/school-year-attachment.ts";
import type {
  PedagogicalContextInput,
  PedagogicalContextRecord,
  PedagogyMutationResult,
  SchoolProfessionInput,
  SchoolProfessionRecord,
} from "../../features/school-catalog/profession-types.ts";
import type {
  SchoolBranchInput,
  SchoolBranchRecord,
  SchoolClassInput,
  SchoolClassRecord,
} from "../../features/school-catalog/types.ts";
import type { SchoolCatalogStore } from "./school-catalog-types.ts";

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function parseStoredTeachingType(value: unknown): "TECHNICAL" | "GENERAL" | null {
  if (value === undefined || value === null || value === "") return null;
  if (value === "TECHNICAL" || value === "GENERAL") return value;
  throw new Error("Le type de la branche doit être TECHNICAL ou GENERAL.");
}

export class MemorySchoolCatalogStore implements SchoolCatalogStore {
  private classes: SchoolClassRecord[] = [];
  private branches: SchoolBranchRecord[] = [];
  private professions: SchoolProfessionRecord[] = [];
  private contexts: PedagogicalContextRecord[] = [];
  private counters: Record<AdminCodeKind, number> = { PRF: 1, BR: 1, CTX: 1 };
  private seeded = false;

  async ensureSeeded(): Promise<void> {
    if (this.seeded) return;
    this.classes = buildDefaultSchoolClasses();
    this.branches = buildDefaultSchoolBranches();
    this.counters.BR = this.branches.length + 1;
    this.seeded = true;
  }

  /** Backfill prudent : n'écrit schoolYearId que si le label correspond à une unique année. */
  async applySchoolYearBackfill(years: SchoolYearRef[]): Promise<number> {
    await this.ensureSeeded();
    let updated = 0;
    this.classes = this.classes.map((entry) => {
      if (entry.schoolYearId) return entry;
      const matchedId = findUniqueSchoolYearIdForLabel(entry.schoolYearLabel, years);
      if (!matchedId) return entry;
      const year = years.find((candidate) => candidate.id === matchedId);
      updated += 1;
      return {
        ...entry,
        schoolYearId: matchedId,
        schoolYearLabel: year?.label ?? entry.schoolYearLabel,
      };
    });
    return updated;
  }

  private nextAdminCode(kind: AdminCodeKind): string {
    const sequence = this.counters[kind];
    this.counters[kind] = sequence + 1;
    return formatAdminCode(kind, sequence);
  }

  async listClasses(): Promise<SchoolClassRecord[]> {
    await this.ensureSeeded();
    return [...this.classes];
  }

  async listBranches(): Promise<SchoolBranchRecord[]> {
    await this.ensureSeeded();
    return [...this.branches];
  }

  async listProfessions(): Promise<SchoolProfessionRecord[]> {
    await this.ensureSeeded();
    return [...this.professions];
  }

  async listContexts(): Promise<PedagogicalContextRecord[]> {
    await this.ensureSeeded();
    return [...this.contexts];
  }

  async createClass(input: SchoolClassInput): Promise<SchoolClassRecord> {
    await this.ensureSeeded();
    const attachment = validateClassProfessionAttachment({
      professionId: input.professionId ?? null,
      trainingYear: input.trainingYear ?? null,
      professions: this.professions,
    });
    if (!attachment.ok) throw new Error(attachment.reason);
    const record: SchoolClassRecord = {
      id: createId("school-class"),
      code: normalizeClassCode(input.code),
      label: input.label.trim() || normalizeClassCode(input.code),
      sortOrder: input.sortOrder ?? this.classes.length + 1,
      isActive: input.isActive ?? true,
      schoolYearId: input.schoolYearId ?? null,
      schoolYearLabel: input.schoolYearLabel ?? null,
      professionId: attachment.value.professionId,
      trainingYear: attachment.value.trainingYear,
    };
    this.classes.push(record);
    return record;
  }

  async updateClass(id: string, patch: Partial<SchoolClassInput>): Promise<SchoolClassRecord | null> {
    await this.ensureSeeded();
    const index = this.classes.findIndex((entry) => entry.id === id);
    if (index < 0) return null;
    const current = this.classes[index]!;
    const attachment = validateClassProfessionAttachment({
      professionId: patch.professionId !== undefined ? patch.professionId : current.professionId,
      trainingYear: patch.trainingYear !== undefined ? patch.trainingYear : current.trainingYear,
      professions: this.professions,
    });
    if (!attachment.ok) throw new Error(attachment.reason);
    const next: SchoolClassRecord = {
      ...current,
      code: patch.code !== undefined ? normalizeClassCode(patch.code) : current.code,
      label: patch.label !== undefined ? patch.label.trim() : current.label,
      sortOrder: patch.sortOrder ?? current.sortOrder,
      isActive: patch.isActive ?? current.isActive,
      schoolYearId: patch.schoolYearId !== undefined ? patch.schoolYearId : current.schoolYearId,
      schoolYearLabel:
        patch.schoolYearLabel !== undefined ? patch.schoolYearLabel : current.schoolYearLabel,
      professionId: attachment.value.professionId,
      trainingYear: attachment.value.trainingYear,
    };
    this.classes[index] = next;
    return next;
  }

  async createBranch(input: SchoolBranchInput): Promise<SchoolBranchRecord> {
    await this.ensureSeeded();
    const archivedAt = input.isArchived ? new Date().toISOString() : null;
    const record: SchoolBranchRecord = {
      id: createId("school-branch"),
      code: normalizeClassCode(input.code),
      label: input.label.trim(),
      sortOrder: input.sortOrder ?? this.branches.length + 1,
      isActive: input.isActive ?? true,
      adminCode: this.nextAdminCode("BR"),
      isArchived: archivedAt !== null,
      archivedAt,
      teachingType: parseStoredTeachingType(input.teachingType),
    };
    this.branches.push(record);
    return record;
  }

  async updateBranch(id: string, patch: Partial<SchoolBranchInput>): Promise<SchoolBranchRecord | null> {
    await this.ensureSeeded();
    const index = this.branches.findIndex((entry) => entry.id === id);
    if (index < 0) return null;
    const current = this.branches[index]!;
    let archivedAt = current.archivedAt;
    if (patch.isArchived === true) archivedAt = current.archivedAt ?? new Date().toISOString();
    else if (patch.isArchived === false) archivedAt = null;
    const next: SchoolBranchRecord = {
      ...current,
      code: patch.code !== undefined ? normalizeClassCode(patch.code) : current.code,
      label: patch.label !== undefined ? patch.label.trim() : current.label,
      sortOrder: patch.sortOrder ?? current.sortOrder,
      isActive: patch.isActive ?? current.isActive,
      isArchived: archivedAt !== null,
      archivedAt,
      teachingType:
        patch.teachingType !== undefined ? parseStoredTeachingType(patch.teachingType) : current.teachingType,
    };
    this.branches[index] = next;
    return next;
  }

  async deleteBranch(id: string): Promise<PedagogyMutationResult<{ id: string }>> {
    await this.ensureSeeded();
    const reason = branchDeleteBlockers({ branchId: id, contexts: this.contexts });
    if (reason) return { ok: false, reason };
    const index = this.branches.findIndex((entry) => entry.id === id);
    if (index < 0) return { ok: false, reason: "Branche introuvable." };
    this.branches.splice(index, 1);
    return { ok: true, value: { id } };
  }

  async createProfession(input: SchoolProfessionInput): Promise<SchoolProfessionRecord> {
    await this.ensureSeeded();
    const durationYears = Math.trunc(input.durationYears);
    if (durationYears < 1 || durationYears > 10) {
      throw new Error("La durée de formation doit être comprise entre 1 et 10 ans.");
    }
    const archivedAt = input.isArchived ? new Date().toISOString() : null;
    const record: SchoolProfessionRecord = {
      id: createId("school-profession"),
      adminCode: this.nextAdminCode("PRF"),
      label: input.label.trim(),
      durationYears,
      sortOrder: input.sortOrder ?? this.professions.length + 1,
      isActive: input.isActive ?? true,
      isArchived: archivedAt !== null,
      archivedAt,
    };
    this.professions.push(record);
    return record;
  }

  async updateProfession(
    id: string,
    patch: Partial<SchoolProfessionInput>,
  ): Promise<PedagogyMutationResult<SchoolProfessionRecord>> {
    await this.ensureSeeded();
    const index = this.professions.findIndex((entry) => entry.id === id);
    if (index < 0) return { ok: false, reason: "Profession introuvable." };
    const current = this.professions[index]!;

    if (patch.durationYears !== undefined) {
      const check = canReduceProfessionDuration({
        profession: current,
        nextDurationYears: Math.trunc(patch.durationYears),
        contexts: this.contexts,
        classes: this.classes,
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
    this.professions[index] = next;
    return { ok: true, value: next };
  }

  async deleteProfession(id: string): Promise<PedagogyMutationResult<{ id: string }>> {
    await this.ensureSeeded();
    const reason = professionDeleteBlockers({
      professionId: id,
      contexts: this.contexts,
      classes: this.classes,
    });
    if (reason) return { ok: false, reason };
    const index = this.professions.findIndex((entry) => entry.id === id);
    if (index < 0) return { ok: false, reason: "Profession introuvable." };
    this.professions.splice(index, 1);
    return { ok: true, value: { id } };
  }

  async createContext(
    input: PedagogicalContextInput,
  ): Promise<PedagogyMutationResult<PedagogicalContextRecord>> {
    await this.ensureSeeded();
    const profession = this.professions.find((entry) => entry.id === input.professionId);
    if (!profession) return { ok: false, reason: "Profession introuvable." };
    const trainingYear = Math.trunc(input.trainingYear);
    if (trainingYear < 1 || trainingYear > profession.durationYears) {
      return {
        ok: false,
        reason: `L'année de formation doit être entre 1 et ${profession.durationYears}.`,
      };
    }
    if (!this.branches.some((entry) => entry.id === input.branchId)) {
      return { ok: false, reason: "Branche introuvable." };
    }
    const duplicate = this.contexts.find(
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
      adminCode: this.nextAdminCode("CTX"),
      professionId: input.professionId,
      trainingYear,
      branchId: input.branchId,
      isActive: input.isActive ?? true,
      isArchived: archivedAt !== null,
      archivedAt,
    };
    this.contexts.push(record);
    return { ok: true, value: record };
  }

  async updateContext(
    id: string,
    patch: Partial<Pick<PedagogicalContextInput, "isActive" | "isArchived">>,
  ): Promise<PedagogicalContextRecord | null> {
    await this.ensureSeeded();
    const index = this.contexts.findIndex((entry) => entry.id === id);
    if (index < 0) return null;
    const current = this.contexts[index]!;
    let archivedAt = current.archivedAt;
    if (patch.isArchived === true) archivedAt = current.archivedAt ?? new Date().toISOString();
    else if (patch.isArchived === false) archivedAt = null;
    const next: PedagogicalContextRecord = {
      ...current,
      isActive: patch.isActive ?? current.isActive,
      isArchived: archivedAt !== null,
      archivedAt,
    };
    this.contexts[index] = next;
    return next;
  }

  async deleteContext(id: string): Promise<PedagogyMutationResult<{ id: string }>> {
    await this.ensureSeeded();
    const index = this.contexts.findIndex((entry) => entry.id === id);
    if (index < 0) return { ok: false, reason: "Contexte pédagogique introuvable." };
    const { contextDeleteBlockers } = await import("../../features/school-catalog/ctx-guards.ts");
    const { getMemoryPedagogicalPathStore, getMemoryAnnualCourseNotesStore } = await import(
      "./memory-pedagogical-path-store.ts"
    );
    const { getMemoryAnnualCourseStore } = await import("./memory-annual-course-store.ts");
    const hasPath = (await getMemoryPedagogicalPathStore().getPathByContextId(id)) !== null;
    const noteCount = await getMemoryAnnualCourseNotesStore().countByContextId(id);
    const courses = await getMemoryAnnualCourseStore().listCoursesByContextId(id);
    const blocker = contextDeleteBlockers({
      hasPedagogicalPath: hasPath,
      hasAnnualNotes: noteCount > 0,
      hasAnnualCourse: courses.length > 0,
    });
    if (blocker) return { ok: false, reason: blocker };
    this.contexts.splice(index, 1);
    return { ok: true, value: { id } };
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
