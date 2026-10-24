import type { PrototypeAgendaItem } from "../agenda/demo-items.ts";
import { isVisibleToStudent } from "../agenda/visibility.ts";
import { getItemsForClassroom } from "../teacher/queries.ts";

/** Libellé anonymisé affiché aux élèves — aucun nom d'enseignant réel. */
export const STUDENT_AUTHOR_LABEL = "Équipe pédagogique";

export function getStudentAgendaItems(
  items: PrototypeAgendaItem[],
  classroomId: string,
): PrototypeAgendaItem[] {
  return getItemsForClassroom(items, classroomId).filter(isVisibleToStudent);
}

/** Contenu élève d’un seul AnnualCourse — identité du cours, pas le libellé de branche. */
export function itemsForAnnualCourse<T extends { annualCourseId?: string | null }>(
  items: readonly T[],
  annualCourseId: string,
): T[] {
  const id = annualCourseId.trim();
  if (!id) return [];
  return items.filter((item) => (item.annualCourseId ?? "").trim() === id);
}

export function anonymizeAuthorForStudent(_authorTeacherId: string): string {
  return STUDENT_AUTHOR_LABEL;
}

export function canStudentModifyAgenda(): false {
  return false;
}

export interface StudentAgendaSummary {
  total: number;
  homework: number;
  test: number;
  information: number;
  branches: number;
}

export function buildStudentAgendaSummary(items: PrototypeAgendaItem[]): StudentAgendaSummary {
  let homework = 0;
  let test = 0;
  let information = 0;
  const branches = new Set<string>();

  for (const item of items) {
    branches.add(item.subjectId);
    if (item.type === "HOMEWORK") homework += 1;
    else if (item.type === "TEST") test += 1;
    else information += 1;
  }

  return {
    total: items.length,
    homework,
    test,
    information,
    branches: branches.size,
  };
}
