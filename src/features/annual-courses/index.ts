export {
  ASSIGNMENT_EVENT_KINDS,
  ASSIGNMENT_ROLES,
  ASSIGNMENT_ROLE_LABELS,
  type AnnualCourse,
  type AnnualCourseInput,
  type AssignmentEventKind,
  type AssignmentRole,
  type CourseMutationErr,
  type CourseMutationOk,
  type CourseMutationResult,
  type TeacherCourseAssignment,
  type TeacherCourseAssignmentEvent,
  type TeacherCourseAssignmentInput,
  type TypeMismatchWarning,
} from "./types.ts";
export { validateAnnualCourseInput, validateAttributionReferential } from "./validation.ts";
export {
  assignmentsOverlap,
  endAssignment,
  evaluateTeachingTypeGuard,
  findActivePrimary,
  findDuplicateAssignment,
  findOverlappingPrimary,
  isAssignmentActiveAt,
  isAssignmentRole,
  listAssignmentCandidateTeachers,
  NO_COMPATIBLE_TEACHER_MESSAGE,
  preferredTeachersForBranch,
  teacherIsAssignable,
} from "./assignments.ts";
export { studentMayAccessCourseNotes, teacherCanAccessAnnualCourse, isVerifiedAdminTeacher } from "./access.ts";
export { decideAgendaPublishAccess } from "./agenda-access.ts";
export {
  decideAssignmentDialogSubmit,
  assignmentLifecycle,
  assignmentDisplayStatus,
  assignmentDisplayLabel,
  lifecycleLabel,
  isClassEligibleForAssignment,
  assignmentRoleForFirstTeacher,
  effectiveAtForEndAssignment,
} from "./admin-assign-ui.ts";
export {
  TEACHER_ASSIGNMENT_EMPTY_ACTIVE_MESSAGE,
  TEACHER_ASSIGNMENT_HISTORY_CHECKBOX_LABEL,
  activeSchoolYearIdForAssignments,
  formatTeacherAssignmentOverviewLine,
  isOperationalTeacherCourseAssignment,
  listTeacherAssignmentOverviewRows,
  teacherVisibleInAssignmentOverview,
  type TeacherAssignmentOverviewRow,
  type TeacherAssignmentOverviewTeacher,
} from "./operational-assignment.ts";
export { parseAssignmentDate, validateAssignmentPeriod, requireOverrideReason } from "./dates.ts";
export {
  ANNUAL_COURSE_AGENDA_DELETE_REASON,
  ANNUAL_COURSE_SCHEDULE_DELETE_REASON,
  ANNUAL_COURSE_USED_DELETE_REASON,
  annualCourseDeleteBlockers,
  contextDeleteBlockers,
} from "./ctx-guards.ts";
export {
  MEMBERSHIP_IS_LEGACY_FALLBACK,
  TEACHER_SETUP_IS_NOT_AUTHORIZATION,
  ASSIGNMENT_VALID_TO_IS_INCLUSIVE,
} from "./compatibility.ts";
export { resolveAnnualCourseForPublication, findCatalogContextForClassBranch } from "./resolve.ts";
export { resolveSchoolClass } from "../school-catalog/class-resolve.ts";
export {
  replaceTeacherOnAnnualCourse,
  buildTemporaryReplacement,
} from "./replace.ts";
export {
  createAnnualCourse,
  ensureAnnualCourse,
  archiveAnnualCourse,
  deleteAnnualCourse,
  assignTeacherToCourse,
  replaceTeacherDefinitively,
  assignTemporaryReplacement,
  endTeacherAssignment,
  teacherMayAccessCourse,
  contextMayBeDeleted,
  activeAssignmentsAt,
  type AnnualCourseServiceDeps,
} from "./service.ts";
