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

/**
 * Filtre agenda élève, uniforme HOMEWORK / TEST / INFORMATION.
 * `undefined` = publié (données existantes). `false` = brouillon, jamais visible.
 * Un élément « À reclasser » (cours annuel, sans séance, provenance de transition
 * ou sentinelle semaine 0) n’est jamais visible, même si `studentVisible` est vrai.
 */
/**
 * Année explicite : ne garde que les publications de cette année.
 * Sans année, le chargement opérationnel actuel est conservé.
 */
export function agendaItemsForSchoolYear<T extends { schoolYearId?: string | null }>(
  items: readonly T[],
  schoolYearId?: string | null,
): T[] {
  const yearId = schoolYearId?.trim() ?? "";
  if (!yearId) return [...items];
  return items.filter((item) => item.schoolYearId === yearId);
}

export function isVisibleToStudent(
  item: Pick<
    PrototypeAgendaItem,
    "type" | "studentVisible" | "annualCourseId" | "courseSessionKey" | "sourceTransitionId" | "schoolWeekNumber"
  >,
): boolean {
  if (!isStudentVisible(item)) return false;
  const courseBound = Boolean(item.annualCourseId?.trim());
  const unplaced = !item.courseSessionKey?.trim();
  if (courseBound && unplaced && (item.sourceTransitionId?.trim() || item.schoolWeekNumber === 0)) {
    return false;
  }
  return true;
}
