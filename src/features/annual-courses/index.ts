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
export { validateAnnualCourseInput } from "./validation.ts";
export {
  assignmentsOverlap,
  endAssignment,
  evaluateTeachingTypeGuard,
  findActivePrimary,
  findDuplicateAssignment,
  isAssignmentActiveAt,
  isAssignmentRole,
  preferredTeachersForBranch,
  teacherIsAssignable,
} from "./assignments.ts";
export { studentMayAccessCourseNotes, teacherCanAccessAnnualCourse } from "./access.ts";
export { annualCourseDeleteBlockers, contextDeleteBlockers } from "./ctx-guards.ts";
export {
  MEMBERSHIP_IS_LEGACY_FALLBACK,
  TEACHER_SETUP_IS_NOT_AUTHORIZATION,
  ASSIGNMENT_VALID_TO_IS_INCLUSIVE,
} from "./compatibility.ts";
export { resolveAnnualCourseForPublication, findCatalogContextForClassBranch } from "./resolve.ts";
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
