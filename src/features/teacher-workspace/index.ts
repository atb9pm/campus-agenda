export {
  TEACHER_COURSES_EMPTY_MESSAGE,
  WORKSPACE_ASSIGNMENT_ROLE_LABELS,
  type TeacherCourseClassGroup,
  type TeacherCourseWorkspaceEntry,
  type TeacherCourseWorkspaceResult,
} from "./types.ts";
export {
  assignedBranchNames,
  assignedSchoolClassIdsFromTeacherCourses,
  buildTeacherCourseWorkspace,
  displaySetupsFromAssignedCourses,
  formatTeacherCourseClassMeta,
  groupTeacherCoursesByClass,
  removeSetupPreferenceForCourse,
  resolveWorkspaceSchoolYearId,
  toDisplayClassSetup,
  upsertSetupPreferenceForCourse,
  type BuildTeacherCourseWorkspaceInput,
} from "./queries.ts";
export { matchSetupPreference, workspaceEntryClassMeta } from "./setup-match.ts";
export {
  listTeacherCourses,
  schoolYearIdFromSearchParams,
  sessionTeacherIdForCoursesApi,
  type TeacherCourseWorkspaceDeps,
} from "./service.ts";
