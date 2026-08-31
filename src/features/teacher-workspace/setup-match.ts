import { normalizeClassCode } from "../school-catalog/queries.ts";
import type { TeacherClassSetup, TeacherSetupConfig } from "../teacher-setup/types.ts";
import type { TeacherCourseWorkspaceEntry } from "./types.ts";

function normalizeBranchLabel(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

function uniqueOrNone<T>(matches: T[]): T | null {
  if (matches.length === 1) return matches[0]!;
  return null;
}

/**
 * Correspondance prudente d’une préférence d’affichage legacy.
 * Ne choisit jamais le premier doublon. N’accorde jamais un droit d’accès.
 */
export function matchSetupPreference(
  entry: TeacherCourseWorkspaceEntry,
  setup: TeacherSetupConfig | null | undefined,
): TeacherClassSetup | null {
  if (!setup?.classes.length) return null;

  const byStableId = setup.classes.filter(
    (candidate) =>
      candidate.id === entry.classId ||
      candidate.id === entry.annualCourseId ||
      candidate.id === entry.assignmentId,
  );
  const uniqueId = uniqueOrNone(byStableId);
  if (uniqueId) return uniqueId;
  if (byStableId.length > 1) {
    const byBranch = disambiguateByBranch(entry, byStableId);
    if (byBranch) return byBranch;
    return null;
  }

  const wantedCode = normalizeClassCode(entry.classCode);
  const byCode = setup.classes.filter(
    (candidate) => normalizeClassCode(candidate.name) === wantedCode,
  );
  const uniqueCode = uniqueOrNone(byCode);
  if (uniqueCode) return uniqueCode;
  if (byCode.length > 1) {
    return disambiguateByBranch(entry, byCode);
  }
  return null;
}

function disambiguateByBranch(
  entry: TeacherCourseWorkspaceEntry,
  candidates: TeacherClassSetup[],
): TeacherClassSetup | null {
  const wanted = normalizeBranchLabel(entry.branchLabel);
  const matches = candidates.filter((candidate) =>
    candidate.branchNames.some((name) => normalizeBranchLabel(name) === wanted),
  );
  return uniqueOrNone(matches);
}

export function workspaceEntryClassMeta(entry: TeacherCourseWorkspaceEntry): string {
  const parts: string[] = [];
  if (entry.trainingYear === 1) parts.push("1re année");
  else if (entry.trainingYear !== null) parts.push(`${entry.trainingYear}e année`);
  if (entry.parallelCode) parts.push(`Groupe ${entry.parallelCode}`);
  return parts.join(" · ");
}
