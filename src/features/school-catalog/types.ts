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
}
