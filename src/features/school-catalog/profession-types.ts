export interface SchoolProfessionRecord {
  id: string;
  /** Code administratif immuable, ex. PRF-0001. */
  adminCode: string;
  label: string;
  /**
   * Abréviation métier pour générer les codes de classe (MMA, MA).
   * Distincte de `adminCode` (PRF-0001). Null = legacy à configurer.
   */
  classCodePrefix: string | null;
  durationYears: number;
  sortOrder: number;
  isActive: boolean;
  isArchived: boolean;
  archivedAt: string | null;
}

export interface SchoolProfessionInput {
  label: string;
  durationYears: number;
  classCodePrefix?: string | null;
  sortOrder?: number;
  isActive?: boolean;
  isArchived?: boolean;
}

/** Contexte pédagogique stable : profession + année de formation + branche. */
export interface PedagogicalContextRecord {
  id: string;
  /** Code administratif immuable, ex. CTX-0001. */
  adminCode: string;
  professionId: string;
  trainingYear: number;
  branchId: string;
  isActive: boolean;
  isArchived: boolean;
  archivedAt: string | null;
}

export interface PedagogicalContextInput {
  professionId: string;
  trainingYear: number;
  branchId: string;
  isActive?: boolean;
  isArchived?: boolean;
}

export type PedagogyMutationOk<T> = { ok: true; value: T };
export type PedagogyMutationErr = { ok: false; reason: string };
export type PedagogyMutationResult<T> = PedagogyMutationOk<T> | PedagogyMutationErr;
