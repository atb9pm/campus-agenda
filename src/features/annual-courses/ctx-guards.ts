export {
  CTX_IN_USE_DELETE_REASON,
  contextDeleteBlockers,
} from "../school-catalog/ctx-guards.ts";

export const ANNUAL_COURSE_SCHEDULE_DELETE_REASON =
  "Ce cours annuel est utilisé dans l’horaire des classes. Supprimez d’abord ses créneaux horaires.";

export const ANNUAL_COURSE_USED_DELETE_REASON =
  "Ce cours annuel a déjà été utilisé. Il ne peut plus être supprimé définitivement. Archivez-le.";

export function annualCourseDeleteBlockers(options: {
  assignmentCount: number;
  noteCount: number;
  scheduleSlotCount?: number;
  hasLinkedPublications?: boolean;
}): string | null {
  if ((options.scheduleSlotCount ?? 0) > 0) {
    return ANNUAL_COURSE_SCHEDULE_DELETE_REASON;
  }
  if (
    options.assignmentCount === 0 &&
    options.noteCount === 0 &&
    !options.hasLinkedPublications
  ) {
    return null;
  }
  return ANNUAL_COURSE_USED_DELETE_REASON;
}
