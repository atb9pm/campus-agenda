export interface SchoolClassRecord {
  id: string;
  code: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
  schoolYearLabel: string | null;
  /** Profession rattachée (null = à configurer / legacy). */
  professionId: string | null;
  /** Année de formation 1..N (null = à configurer / legacy). */
  trainingYear: number | null;
}

export interface SchoolBranchRecord {
  id: string;
  code: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
  /** Code administratif immuable, ex. BR-0001. */
  adminCode: string;
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
  professionId?: string | null;
  trainingYear?: number | null;
}

export interface SchoolBranchInput {
  code: string;
  label: string;
  sortOrder?: number;
  isActive?: boolean;
  isArchived?: boolean;
}
