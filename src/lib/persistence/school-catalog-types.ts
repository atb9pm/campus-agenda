import type { SchoolBranchInput, SchoolBranchRecord, SchoolClassInput, SchoolClassRecord } from "../../features/school-catalog/types.ts";

export interface SchoolCatalogStore {
  listClasses(): Promise<SchoolClassRecord[]>;
  listBranches(): Promise<SchoolBranchRecord[]>;
  createClass(input: SchoolClassInput): Promise<SchoolClassRecord>;
  updateClass(id: string, patch: Partial<SchoolClassInput>): Promise<SchoolClassRecord | null>;
  createBranch(input: SchoolBranchInput): Promise<SchoolBranchRecord>;
  updateBranch(id: string, patch: Partial<SchoolBranchInput>): Promise<SchoolBranchRecord | null>;
  ensureSeeded(): Promise<void>;
}
