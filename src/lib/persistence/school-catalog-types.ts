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

export interface SchoolCatalogStore {
  listClasses(): Promise<SchoolClassRecord[]>;
  listBranches(): Promise<SchoolBranchRecord[]>;
  createClass(input: SchoolClassInput): Promise<SchoolClassRecord>;
  updateClass(id: string, patch: Partial<SchoolClassInput>): Promise<SchoolClassRecord | null>;
  createBranch(input: SchoolBranchInput): Promise<SchoolBranchRecord>;
  updateBranch(id: string, patch: Partial<SchoolBranchInput>): Promise<SchoolBranchRecord | null>;
  deleteBranch(id: string): Promise<PedagogyMutationResult<{ id: string }>>;

  listProfessions(): Promise<SchoolProfessionRecord[]>;
  createProfession(input: SchoolProfessionInput): Promise<SchoolProfessionRecord>;
  updateProfession(
    id: string,
    patch: Partial<SchoolProfessionInput>,
  ): Promise<PedagogyMutationResult<SchoolProfessionRecord>>;
  deleteProfession(id: string): Promise<PedagogyMutationResult<{ id: string }>>;

  listContexts(): Promise<PedagogicalContextRecord[]>;
  createContext(input: PedagogicalContextInput): Promise<PedagogyMutationResult<PedagogicalContextRecord>>;
  updateContext(
    id: string,
    patch: Partial<Pick<PedagogicalContextInput, "isActive" | "isArchived">>,
  ): Promise<PedagogicalContextRecord | null>;
  deleteContext(id: string): Promise<PedagogyMutationResult<{ id: string }>>;

  ensureSeeded(): Promise<void>;
  /** Backfill prudent schoolYearId depuis schoolYearLabel (correspondance unique). */
  applySchoolYearBackfill(
    years: Array<{ id: string; label: string }>,
  ): Promise<number>;
}
