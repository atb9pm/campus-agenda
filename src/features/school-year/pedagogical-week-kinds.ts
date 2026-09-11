import type { SchoolWeekEntry } from "./types.ts";
import { weekKindForNumber } from "./week-plan-logic.ts";

/**
 * Type A/B d’une semaine de cours : numéro pédagogique impair → A, pair → B.
 * Jamais le numéro ISO de la semaine civile.
 */
export function pedagogicalWeekKind(weekNumber: number): "A" | "B" {
  return weekKindForNumber(weekNumber);
}

export function weeksNeedKindInitialization(
  weeks: ReadonlyArray<Pick<SchoolWeekEntry, "kind">>,
): boolean {
  return weeks.some((week) => week.kind !== "A" && week.kind !== "B");
}

/** Remplit uniquement les `kind` nuls. Ne touche pas aux A/B déjà enregistrés. */
export function applyDefaultPedagogicalWeekKinds(
  weeks: ReadonlyArray<SchoolWeekEntry>,
): SchoolWeekEntry[] {
  return weeks.map((week) => ({
    ...week,
    kind: week.kind === "A" || week.kind === "B" ? week.kind : pedagogicalWeekKind(week.number),
  }));
}

/**
 * Réimport du calendrier officiel : si le lundi de référence est inchangé,
 * conserver le type A/B existant (corrections manuelles). Sinon, appliquer
 * impair = A / pair = B.
 */
export function preserveExistingPedagogicalWeekKinds(
  generated: ReadonlyArray<SchoolWeekEntry>,
  existing: ReadonlyArray<SchoolWeekEntry>,
): SchoolWeekEntry[] {
  const existingByMonday = new Map(existing.map((week) => [week.monday, week]));
  return generated.map((week) => {
    const previous = existingByMonday.get(week.monday);
    if (previous?.kind === "A" || previous?.kind === "B") {
      return { ...week, kind: previous.kind };
    }
    return {
      ...week,
      kind: week.kind === "A" || week.kind === "B" ? week.kind : pedagogicalWeekKind(week.number),
    };
  });
}

export function schoolWeeksHaveLocalChanges(
  original: ReadonlyArray<SchoolWeekEntry>,
  draft: ReadonlyArray<SchoolWeekEntry>,
): boolean {
  if (original.length !== draft.length) return true;
  return draft.some((week, index) => {
    const previous = original[index];
    return !previous || previous.kind !== week.kind || previous.monday !== week.monday;
  });
}
