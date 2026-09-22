export {
  annualCourseIdFromRuntimeSubjectId,
  looksLikeRuntimeSubjectId,
  runtimeClassroomIdForSchoolClass,
  runtimeSubjectIdForAnnualCourse,
} from "./ids.ts";
export {
  UNDEFINED_BRANCH_LABEL,
  buildAgendaSubjectLabelMap,
  displayBranchLabel,
  listResolvedAgendaSubjects,
  resolveAgendaBranchLabel,
  type AgendaBranchLabelCatalog,
  type AgendaBranchSubjectHint,
} from "./branch-label.ts";
export {
  classroomNameMatchesSchoolClass,
  findUniqueAdoptableClassroom,
  findUniqueAdoptableSubject,
  schoolClassesMatchingClassroomName,
  subjectNameMatchesBranchLabel,
} from "./match.ts";
export {
  STRUCTURED_SUBJECT_UNLINKED_REASON,
  UNSAFE_AGENDA_BRIDGE_REASON,
  candidateAnnualCourseIdsForSubject,
  contextBranchForCourse,
  ensureRuntimeClassroomForSchoolClass,
  ensureRuntimeSubjectForAnnualCourse,
  inspectClassroomAgendaBinding,
  loadClassroomAgendaBinding,
  reconcileStructuredClassrooms,
  resolveStructuredAgendaTarget,
  resolveStructuredSchoolClassForClassroom,
  type AgendaBridgeErr,
  type AgendaBridgeOk,
  type AgendaBridgeResult,
  type ClassroomAgendaBinding,
  type StructuredAgendaTarget,
} from "./reconcile.ts";
export {
  assignmentInstantForSessionDate,
  evaluateTeacherAgendaPublishAccess,
  teacherHasStructuredClassroomReadAccess,
  teacherHasStructuredPublishAccess,
} from "./access.ts";
