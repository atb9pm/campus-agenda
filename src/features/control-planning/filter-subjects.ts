import type { AnnualCourse } from "../annual-courses/types.ts";
import { contextBranchForCourse } from "../agenda-bridge/index.ts";
import type { PedagogicalContextRecord } from "../school-catalog/profession-types.ts";
import type { SchoolBranchRecord } from "../school-catalog/types.ts";
import type { ControlPlanningFilterSubject } from "./types.ts";

/**
 * Matières du filtre Contrôles : AnnualCourse des classes sélectionnées,
 * toutes affectations confondues. Déduplication par branchId, pas par libellé.
 */
export function listControlPlanningFilterSubjects(options: {
  schoolClassIds: readonly string[];
  courses: readonly AnnualCourse[];
  contexts: readonly PedagogicalContextRecord[];
  branches: readonly SchoolBranchRecord[];
}): ControlPlanningFilterSubject[] {
  const classIds = new Set(options.schoolClassIds.filter((id) => id.trim()));
  if (classIds.size === 0) return [];

  const byBranchId = new Map<string, { id: string; label: string; sortOrder: number }>();
  for (const course of options.courses) {
    if (course.isArchived) continue;
    if (!classIds.has(course.classId)) continue;
    const info = contextBranchForCourse({
      course,
      contexts: options.contexts,
      branches: options.branches,
    });
    if (!info) continue;
    if (byBranchId.has(info.branch.id)) continue;
    byBranchId.set(info.branch.id, {
      id: info.branch.id,
      label: info.branch.label,
      sortOrder: info.branch.sortOrder,
    });
  }

  return [...byBranchId.values()]
    .sort((left, right) => {
      if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
      return left.label.localeCompare(right.label, "fr");
    })
    .map((entry) => ({ id: entry.id, label: entry.label }));
}

/** Si la matière n’existe plus pour les classes affichées → Toutes les matières. */
export function resolveControlPlanningSubjectFilter(
  selectedId: string | null | undefined,
  available: readonly ControlPlanningFilterSubject[],
): string | null {
  const id = selectedId?.trim() || null;
  if (!id) return null;
  return available.some((entry) => entry.id === id) ? id : null;
}

export function controlMatchesSubjectFilter(
  entry: { branchId?: string | null; annualCourseId?: string | null; branchLabel?: string | null },
  subjectId: string | null,
  available: readonly ControlPlanningFilterSubject[],
): boolean {
  if (!subjectId) return true;
  if (entry.branchId) return entry.branchId === subjectId;
  const subject = available.find((item) => item.id === subjectId);
  if (!subject) return false;
  return (entry.branchLabel ?? "").trim() === subject.label;
}
