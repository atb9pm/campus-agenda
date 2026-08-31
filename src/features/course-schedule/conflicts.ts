import { periodsOverlap } from "./periods.ts";
import type { CourseScheduleSlot, CourseWeekKind } from "./types.ts";

/**
 * all vs A/B/all = conflit.
 * A vs A = conflit.
 * B vs B = conflit.
 * A vs B = autorisé.
 */
export function weekKindsConflict(left: CourseWeekKind, right: CourseWeekKind): boolean {
  if (left === "all" || right === "all") return true;
  return left === right;
}

export function slotsOverlapOnDay(
  left: Pick<CourseScheduleSlot, "dayOfWeek" | "periodStart" | "periodEnd" | "weekKind">,
  right: Pick<CourseScheduleSlot, "dayOfWeek" | "periodStart" | "periodEnd" | "weekKind">,
): boolean {
  if (left.dayOfWeek !== right.dayOfWeek) return false;
  if (!weekKindsConflict(left.weekKind, right.weekKind)) return false;
  return periodsOverlap(left.periodStart, left.periodEnd, right.periodStart, right.periodEnd);
}

export function findConflictingSlot(
  candidate: Pick<CourseScheduleSlot, "dayOfWeek" | "periodStart" | "periodEnd" | "weekKind" | "id">,
  existing: CourseScheduleSlot[],
): CourseScheduleSlot | undefined {
  return existing.find(
    (entry) => entry.id !== candidate.id && slotsOverlapOnDay(candidate, entry),
  );
}
