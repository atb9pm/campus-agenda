import type { SchoolBranchRecord, SchoolClassRecord } from "./types.ts";

/** Liste officielle initiale demandée pour la Configuration enseignant. */
export const DEFAULT_SCHOOL_CLASS_CODES = [
  "MA1",
  "MA2",
  "MA3A",
  "MA3B",
  "MACAM2",
  "MACAM4",
  "MA4",
] as const;

export const DEFAULT_SCHOOL_BRANCH_LABELS = [
  "Moteur",
  "Électricité",
  "Transmission",
  "Châssis",
] as const;

export function buildDefaultSchoolClasses(): SchoolClassRecord[] {
  return DEFAULT_SCHOOL_CLASS_CODES.map((code, index) => ({
    id: `school-class-${code.toLowerCase()}`,
    code,
    label: code,
    sortOrder: index + 1,
    isActive: true,
    schoolYearId: null,
    schoolYearLabel: "2026-2027",
    professionId: null,
    trainingYear: null,
  }));
}

export function buildDefaultSchoolBranches(): SchoolBranchRecord[] {
  return DEFAULT_SCHOOL_BRANCH_LABELS.map((label, index) => {
    const code = label
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_");
    return {
      id: `school-branch-${code.toLowerCase()}`,
      code,
      label,
      sortOrder: index + 1,
      isActive: true,
      adminCode: `BR-${String(index + 1).padStart(4, "0")}`,
      isArchived: false,
      archivedAt: null,
    };
  });
}
