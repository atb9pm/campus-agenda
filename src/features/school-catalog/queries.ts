import type { SchoolBranchRecord, SchoolClassRecord } from "./types.ts";

export function sortSchoolClasses(classes: SchoolClassRecord[]): SchoolClassRecord[] {
  return [...classes].sort((left, right) => {
    if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
    return left.code.localeCompare(right.code, "fr-CH");
  });
}

export function sortSchoolBranches(branches: SchoolBranchRecord[]): SchoolBranchRecord[] {
  return [...branches].sort((left, right) => {
    if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
    return left.label.localeCompare(right.label, "fr-CH");
  });
}

export function listActiveSchoolClasses(classes: SchoolClassRecord[]): SchoolClassRecord[] {
  return sortSchoolClasses(classes.filter((entry) => entry.isActive && !entry.isArchived));
}

export function listActiveSchoolBranches(branches: SchoolBranchRecord[]): SchoolBranchRecord[] {
  return sortSchoolBranches(branches.filter((entry) => entry.isActive && !entry.isArchived));
}

export function normalizeClassCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}
