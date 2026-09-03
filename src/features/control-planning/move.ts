import type { ControlPlanningCard } from "./types.ts";

export function isMovableStructuredControlCard(
  card: Pick<ControlPlanningCard, "isOwn" | "annualCourseId" | "courseSessionKey">,
  canCreate: boolean,
): boolean {
  return Boolean(
    canCreate && card.isOwn && card.annualCourseId?.trim() && card.courseSessionKey?.trim(),
  );
}

/** Même critère que le déplacement : actions Modifier / Déplacer / Supprimer sur ses contrôles structurés. */
export const canManageOwnStructuredControlCard = isMovableStructuredControlCard;
