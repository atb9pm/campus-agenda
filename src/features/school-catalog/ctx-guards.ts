export const CTX_IN_USE_DELETE_REASON =
  "Ce contexte pédagogique est déjà utilisé. Il ne peut plus être supprimé définitivement. Archivez-le.";

export const CTX_CREATE_ARCHIVED_PROFESSION_REASON =
  "Impossible de créer une affectation pour une profession archivée.";
export const CTX_CREATE_INACTIVE_PROFESSION_REASON =
  "Impossible de créer une affectation pour une profession désactivée.";
export const CTX_CREATE_ARCHIVED_BRANCH_REASON =
  "Impossible de créer une affectation avec une branche archivée.";
export const CTX_CREATE_INACTIVE_BRANCH_REASON =
  "Impossible de créer une affectation avec une branche désactivée.";

export const CTX_RESTORE_ARCHIVED_PROFESSION_REASON =
  "Impossible de restaurer une affectation pour une profession archivée.";
export const CTX_RESTORE_INACTIVE_PROFESSION_REASON =
  "Impossible de restaurer une affectation pour une profession désactivée.";
export const CTX_RESTORE_ARCHIVED_BRANCH_REASON =
  "Impossible de restaurer une affectation avec une branche archivée.";
export const CTX_RESTORE_INACTIVE_BRANCH_REASON =
  "Impossible de restaurer une affectation avec une branche désactivée.";

type LifecycleParent = { isActive: boolean; isArchived: boolean };

export function contextCreateParentBlocker(
  profession: LifecycleParent | null | undefined,
  branch: LifecycleParent | null | undefined,
): string | null {
  if (!profession) return "Profession introuvable.";
  if (profession.isArchived) return CTX_CREATE_ARCHIVED_PROFESSION_REASON;
  if (!profession.isActive) return CTX_CREATE_INACTIVE_PROFESSION_REASON;
  if (!branch) return "Branche introuvable.";
  if (branch.isArchived) return CTX_CREATE_ARCHIVED_BRANCH_REASON;
  if (!branch.isActive) return CTX_CREATE_INACTIVE_BRANCH_REASON;
  return null;
}

export function contextRestoreParentBlocker(
  profession: LifecycleParent | null | undefined,
  branch: LifecycleParent | null | undefined,
): string | null {
  if (!profession) return "Profession introuvable.";
  if (profession.isArchived) return CTX_RESTORE_ARCHIVED_PROFESSION_REASON;
  if (!profession.isActive) return CTX_RESTORE_INACTIVE_PROFESSION_REASON;
  if (!branch) return "Branche introuvable.";
  if (branch.isArchived) return CTX_RESTORE_ARCHIVED_BRANCH_REASON;
  if (!branch.isActive) return CTX_RESTORE_INACTIVE_BRANCH_REASON;
  return null;
}

export function contextDeleteBlockers(options: {
  hasPedagogicalPath: boolean;
  hasAnnualNotes: boolean;
  hasAnnualCourse?: boolean;
}): string | null {
  if (!options.hasPedagogicalPath && !options.hasAnnualNotes && !options.hasAnnualCourse) {
    return null;
  }
  return CTX_IN_USE_DELETE_REASON;
}
