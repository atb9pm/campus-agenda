export {
  confirmationMatches,
  emptyTeacherDeleteCounts,
  LAST_ADMIN_DELETE_REASON,
  missingConfirmationReason,
  TEACHER_DELETE_IRREVERSIBLE,
  TEACHER_DELETE_WILL_KEEP,
  TEACHER_DELETE_WILL_REMOVE,
  TEACHER_NOT_FOUND_REASON,
  wrongConfirmationReason,
  type TeacherDeleteCounts,
  type TeacherDeletePlan,
  type TeacherDeletePreview,
  type TeacherDeleteTarget,
} from "./types.ts";
export { previewFromTeacherPlan } from "./preview.ts";
export { buildTeacherDeletePlan, type TeacherDeleteSnapshotDeps } from "./snapshot.ts";
export { buildTeacherDeleteStatements, SQL_TEACHER_DELETE_ROLLBACK_PROBE } from "./sql-statements.ts";
export {
  deleteTeacherPermanently,
  previewTeacherDelete,
  type TeacherDeleteServiceResult,
} from "./service.ts";
export { loadTeacherDeleteDeps } from "./deps.ts";
