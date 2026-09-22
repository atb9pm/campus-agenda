import type { AnnualCourse } from "../annual-courses/types.ts";
import type { PedagogicalContextRecord } from "../school-catalog/profession-types.ts";
import type { SchoolBranchRecord } from "../school-catalog/types.ts";
import { contextBranchForCourse } from "./reconcile.ts";
import { annualCourseIdFromRuntimeSubjectId, looksLikeRuntimeSubjectId } from "./ids.ts";

/** Affiché uniquement si le libellé maître est introuvable. Jamais un ID technique. */
export const UNDEFINED_BRANCH_LABEL = "Branche non définie";

export interface AgendaBranchSubjectHint {
  id: string;
  name: string;
  annualCourseId?: string | null;
}

export interface AgendaBranchLabelCatalog {
  subjects?: readonly AgendaBranchSubjectHint[];
  courses: readonly AnnualCourse[];
  contexts: readonly PedagogicalContextRecord[];
  branches: readonly SchoolBranchRecord[];
}

export function displayBranchLabel(name: string | null | undefined): string {
  const trimmed = name?.trim() ?? "";
  if (!trimmed || looksLikeRuntimeSubjectId(trimmed)) return UNDEFINED_BRANCH_LABEL;
  return trimmed;
}

/**
 * Libellé maître de la branche liée au subject / cours annuel.
 * Priorité : SchoolBranch.label via AnnualCourse → context → branche.
 * Repli : nom runtime s’il n’est pas un ID. Sinon « Branche non définie ».
 */
export function resolveAgendaBranchLabel(
  options: {
    subjectId: string;
    annualCourseId?: string | null;
  } & AgendaBranchLabelCatalog,
): string {
  const subject = options.subjects?.find((entry) => entry.id === options.subjectId);
  const courseId =
    options.annualCourseId?.trim()
    || subject?.annualCourseId?.trim()
    || annualCourseIdFromRuntimeSubjectId(options.subjectId);

  if (courseId) {
    const course = options.courses.find((entry) => entry.id === courseId);
    if (course) {
      const linked = contextBranchForCourse({
        course,
        contexts: options.contexts,
        branches: options.branches,
      });
      const label = displayBranchLabel(linked?.branch.label);
      if (label !== UNDEFINED_BRANCH_LABEL) return label;
    }
  }

  return displayBranchLabel(subject?.name);
}

export function buildAgendaSubjectLabelMap(
  subjectIds: readonly string[],
  catalog: AgendaBranchLabelCatalog,
  annualCourseIdBySubjectId: ReadonlyMap<string, string | null> = new Map(),
): Map<string, string> {
  const labels = new Map<string, string>();
  for (const subjectId of subjectIds) {
    if (!subjectId || labels.has(subjectId)) continue;
    labels.set(
      subjectId,
      resolveAgendaBranchLabel({
        subjectId,
        annualCourseId: annualCourseIdBySubjectId.get(subjectId) ?? null,
        ...catalog,
      }),
    );
  }
  return labels;
}

export function listResolvedAgendaSubjects(options: {
  classroomId: string;
  items: ReadonlyArray<{ subjectId: string; annualCourseId?: string | null }>;
  runtimeSubjects: readonly AgendaBranchSubjectHint[];
  courses: readonly AnnualCourse[];
  contexts: readonly PedagogicalContextRecord[];
  branches: readonly SchoolBranchRecord[];
}): Array<{ id: string; name: string; classroomId: string; annualCourseId: string | null }> {
  const ids = new Set<string>();
  const courseBySubject = new Map<string, string | null>();
  for (const subject of options.runtimeSubjects) {
    if (!subject.id) continue;
    ids.add(subject.id);
    if (subject.annualCourseId?.trim()) courseBySubject.set(subject.id, subject.annualCourseId.trim());
  }
  for (const item of options.items) {
    if (!item.subjectId) continue;
    ids.add(item.subjectId);
    if (item.annualCourseId?.trim()) courseBySubject.set(item.subjectId, item.annualCourseId.trim());
  }

  return [...ids].map((id) => {
    const runtime = options.runtimeSubjects.find((entry) => entry.id === id);
    const annualCourseId = courseBySubject.get(id) ?? runtime?.annualCourseId?.trim() ?? null;
    return {
      id,
      classroomId: options.classroomId,
      annualCourseId,
      name: resolveAgendaBranchLabel({
        subjectId: id,
        annualCourseId,
        subjects: options.runtimeSubjects,
        courses: options.courses,
        contexts: options.contexts,
        branches: options.branches,
      }),
    };
  });
}
