import type { PrototypeAgendaItem } from "../agenda/demo-items.ts";
import { getItemsForClassroom } from "../teacher/queries.ts";

/** Libellé anonymisé affiché aux élèves — aucun nom d'enseignant réel. */
export const STUDENT_AUTHOR_LABEL = "Équipe pédagogique";

export function getStudentAgendaItems(
  items: PrototypeAgendaItem[],
  classroomId: string,
): PrototypeAgendaItem[] {
  return getItemsForClassroom(items, classroomId);
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
