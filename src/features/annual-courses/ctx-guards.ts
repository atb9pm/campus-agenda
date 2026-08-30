export {
  CTX_IN_USE_DELETE_REASON,
  contextDeleteBlockers,
} from "../school-catalog/ctx-guards.ts";

export function annualCourseDeleteBlockers(options: {
  assignmentCount: number;
  noteCount: number;
  hasLinkedPublications?: boolean;
}): string | null {
  if (
    options.assignmentCount === 0 &&
    options.noteCount === 0 &&
    !options.hasLinkedPublications
  ) {
    return null;
  }
  return (
    "Ce cours annuel a déjà été utilisé. Il ne peut plus être supprimé définitivement. Archivez-le."
  );
}
