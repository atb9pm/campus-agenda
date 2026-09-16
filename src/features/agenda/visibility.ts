import type { AgendaItemType } from "../../types/agenda.ts";
import type { PrototypeAgendaItem } from "./demo-items.ts";

/**
 * Visibilité élève d’un item d’agenda.
 * - `undefined` / absent = publié (données existantes, reprise de backup sans colonne).
 * - `false` = brouillon enseignant, invisible côté élève.
 */
export function isStudentVisible(item: Pick<PrototypeAgendaItem, "studentVisible">): boolean {
  return item.studentVisible !== false;
}

/** Contrôles et publications Mes cours (clic explicite) restent visibles. Le Carnet et la reprise d’année partent en brouillon. */
export function defaultStudentVisibleForCreate(input: {
  type: AgendaItemType;
  annualCourseId?: string | null;
  courseSessionKey?: string | null;
  studentVisible?: boolean;
}): boolean {
  if (typeof input.studentVisible === "boolean") return input.studentVisible;
  if (input.type === "TEST") return true;
  if (input.annualCourseId?.trim() && input.courseSessionKey?.trim()) return true;
  return false;
}

/** Filtre agenda élève : les contrôles restent toujours visibles ; le reste suit le brouillon. */
export function isVisibleToStudent(
  item: Pick<PrototypeAgendaItem, "type" | "studentVisible">,
): boolean {
  if (item.type === "TEST") return true;
  return isStudentVisible(item);
}
