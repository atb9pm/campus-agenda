/**
 * Sélection client des chips classes. `null` = Toutes mes classes.
 * Jamais de sélection vide.
 */
export function toggleControlPlanningClassroomSelection(
  current: readonly string[] | null,
  assignedIds: readonly string[],
  classroomId: string,
): string[] | null {
  if (!assignedIds.includes(classroomId)) return current === null ? null : [...current];
  if (current === null) {
    return [classroomId];
  }
  if (current.includes(classroomId)) {
    if (current.length <= 1) return [...current];
    return current.filter((id) => id !== classroomId);
  }
  return [...current, classroomId];
}

export function parseControlPlanningClassroomIds(options: {
  classroomIds?: string | string[] | null;
  classroomId?: string | null;
}): string[] {
  const collected: string[] = [];
  const fromList = options.classroomIds;
  if (Array.isArray(fromList)) {
    for (const value of fromList) pushIds(collected, value);
  } else if (typeof fromList === "string") {
    pushIds(collected, fromList);
  }
  if (options.classroomId) pushIds(collected, options.classroomId);
  return [...new Set(collected)];
}

function pushIds(target: string[], raw: string) {
  for (const part of raw.split(",")) {
    const id = part.trim();
    if (id) target.push(id);
  }
}

export function resolveAssignedClassroomSelection(options: {
  requestedIds: readonly string[];
  assignedIds: readonly string[];
}): { ok: true; selectedIds: string[]; allSelected: boolean } | { ok: false; reason: string } {
  const assigned = [...new Set(options.assignedIds)];
  const requested = [...new Set(options.requestedIds)];
  if (requested.length === 0) {
    return { ok: true, selectedIds: assigned, allSelected: true };
  }
  const unknown = requested.find((id) => !assigned.includes(id));
  if (unknown) {
    return { ok: false, reason: "Cette classe ne vous est pas attribuée." };
  }
  return {
    ok: true,
    selectedIds: requested,
    allSelected: assigned.length > 0 && requested.length === assigned.length && assigned.every((id) => requested.includes(id)),
  };
}
