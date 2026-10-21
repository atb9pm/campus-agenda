import type { ControlPlanningCard } from "./types.ts";

export function hasControlSessionLink(
  card: Pick<ControlPlanningCard, "annualCourseId" | "courseSessionKey">,
): boolean {
  return Boolean(card.annualCourseId?.trim() && card.courseSessionKey?.trim());
}

/** Modifier / supprimer : auteur + année/classe opérable (`canCreate`). Le lien de séance n’est pas requis. */
export function canManageOwnStructuredControlCard(
  card: Pick<ControlPlanningCard, "isOwn">,
  canCreate: boolean,
): boolean {
  return Boolean(canCreate && card.isOwn);
}

/** Déplacer vers une autre séance : uniquement un contrôle déjà rattaché à un cours et une séance. */
export function isMovableStructuredControlCard(
  card: Pick<ControlPlanningCard, "isOwn" | "annualCourseId" | "courseSessionKey">,
  canCreate: boolean,
): boolean {
  return canManageOwnStructuredControlCard(card, canCreate) && hasControlSessionLink(card);
}

/** Contrôle de l’auteur sans cours/séance : proposer un rattachement explicite, jamais déduit du titre. */
export function needsControlSessionAttachment(
  card: Pick<ControlPlanningCard, "isOwn" | "annualCourseId" | "courseSessionKey">,
): boolean {
  return Boolean(card.isOwn && !hasControlSessionLink(card));
}

export const CONTROL_UNLINKED_SESSION_HINT =
  "Ce contrôle n’est pas rattaché à une séance. Vous pouvez le modifier, le supprimer, ou le rattacher explicitement à une séance.";

export const CONTROL_UNLINKED_READONLY_HINT =
  "Ce contrôle n’est pas rattaché à une séance. Les actions sont indisponibles (année ou classe en lecture seule).";

export const CONTROL_SESSION_ATTACH_ACTION = "Rattacher à une séance";
