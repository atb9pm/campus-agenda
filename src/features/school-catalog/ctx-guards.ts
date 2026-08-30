export const CTX_IN_USE_DELETE_REASON =
  "Ce contexte pédagogique est déjà utilisé. Il ne peut plus être supprimé définitivement. Archivez-le.";

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
