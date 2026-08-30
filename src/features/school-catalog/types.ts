export interface SchoolClassRecord {
  id: string;
  code: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
  schoolYearLabel: string | null;
}

export interface SchoolBranchRecord {
  id: string;
  code: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
  /** Dérivé de `archivedAt` : true si la branche est hors liste courante. */
  isArchived: boolean;
  archivedAt: string | null;
}

export interface SchoolClassInput {
  code: string;
  label: string;
  sortOrder?: number;
  isActive?: boolean;
  schoolYearLabel?: string | null;
}

export interface SchoolBranchInput {
  code: string;
  label: string;
  sortOrder?: number;
  isActive?: boolean;
  isArchived?: boolean;
}
