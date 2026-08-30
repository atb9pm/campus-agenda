export interface SchoolClassRecord {
  id: string;
  code: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
  /**
   * Référence technique stable vers `school_years.id`.
   * Null = classe legacy / non encore rattachée. Distinct de `trainingYear`.
   */
  schoolYearId: string | null;
  /** Libellé conservé pour compatibilité / affichage (dérivé de l'année si ID présent). */
  schoolYearLabel: string | null;
  /** Profession rattachée (null = à configurer / legacy). */
  professionId: string | null;
  /** Année de formation 1..N (null = à configurer / legacy). Distinct de `schoolYearId`. */
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
  /**
   * TECHNICAL | GENERAL. Null = à configurer (legacy).
   * Ce n'est PAS un troisième type.
   */
  teachingType: "TECHNICAL" | "GENERAL" | null;
}

export interface SchoolClassInput {
  code: string;
  label: string;
  sortOrder?: number;
  isActive?: boolean;
  schoolYearId?: string | null;
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
  teachingType?: "TECHNICAL" | "GENERAL" | null;
}
