import type { PedagogyMutationResult } from "./profession-types.ts";
import type { SchoolClassRecord } from "./types.ts";

export type ClassLifecycleStatus = "active" | "inactive" | "archived";

export function classLifecycleStatus(
  entry: Pick<SchoolClassRecord, "isActive" | "isArchived">,
): ClassLifecycleStatus {
  if (entry.isArchived) return "archived";
  if (entry.isActive) return "active";
  return "inactive";
}

export function classLifecycleLabel(status: ClassLifecycleStatus): string {
  if (status === "archived") return "Archivée";
  if (status === "active") return "Active";
  return "Désactivée";
}

export function classCardClassName(status: ClassLifecycleStatus): string {
  if (status === "archived") return "admin-teacher-card is-archived";
  if (status === "inactive") return "admin-teacher-card is-inactive";
  return "admin-teacher-card is-active";
}

/**
 * Archive / désarchive / (dés)active de façon cohérente.
 * Désarchiver ne réactive jamais automatiquement.
 */
export function applyClassLifecyclePatch(
  current: Pick<SchoolClassRecord, "isActive" | "isArchived" | "archivedAt">,
  patch: { isActive?: boolean; isArchived?: boolean },
  now = new Date().toISOString(),
): PedagogyMutationResult<{
  isActive: boolean;
  isArchived: boolean;
  archivedAt: string | null;
}> {
  if (current.isArchived && patch.isArchived === false && patch.isActive === true) {
    return {
      ok: false,
      reason: "Désarchivez d'abord la classe avant de la réactiver.",
    };
  }

  let isArchived = current.isArchived;
  let isActive = current.isActive;
  let archivedAt = current.archivedAt;

  if (patch.isArchived === true) {
    isArchived = true;
    isActive = false;
    if (!current.isArchived) archivedAt = now;
  } else if (patch.isArchived === false) {
    isArchived = false;
    archivedAt = null;
  }

  if (patch.isActive !== undefined) {
    if (isArchived && patch.isActive) {
      return {
        ok: false,
        reason: "Désarchivez d'abord la classe avant de la réactiver.",
      };
    }
    if (!isArchived) isActive = patch.isActive;
  }

  if (isArchived) {
    isActive = false;
  }

  return { ok: true, value: { isActive, isArchived, archivedAt } };
}
