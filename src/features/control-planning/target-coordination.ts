import { confirmationRequiredForExistingTests } from "../evaluations/coordination.ts";
import type { ControlPlacementOption, ControlPlanningCard } from "./types.ts";

/**
 * Coordination = même SchoolClass (classroom runtime) + même date.
 * Ne jamais agréger les contrôles de plusieurs classes sélectionnées.
 */
export function classDayControlsForPlacementOption(
  classDayControls: readonly ControlPlanningCard[],
  option: Pick<ControlPlacementOption, "classroomId">,
): ControlPlanningCard[] {
  const classroomId = option.classroomId?.trim() || "";
  if (!classroomId) return [];
  return classDayControls.filter((card) => card.classroomId === classroomId);
}

export function confirmationRequiredForPlacementOption(
  classDayControls: readonly ControlPlanningCard[],
  option: Pick<ControlPlacementOption, "classroomId">,
): boolean {
  return confirmationRequiredForExistingTests(
    classDayControlsForPlacementOption(classDayControls, option).length,
  );
}
