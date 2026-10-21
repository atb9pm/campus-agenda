export {
  YEAR_TRANSITION_PREVIEW_REASONS,
  YEAR_TRANSITION_PREVIEW_REASON_EXPLANATIONS,
  YEAR_TRANSITION_PREVIEW_REASON_LABELS,
  YEAR_TRANSITION_PREVIEW_REASON_ORDER,
  YEAR_TRANSITION_PREVIEW_WARNINGS,
  type YearTransitionPreviewReason,
  type YearTransitionPreviewWarning,
} from "./reasons.ts";
export type {
  YearTransitionClassMapping,
  YearTransitionClassMappingSummary,
  YearTransitionPreviewEntry,
  YearTransitionPreviewInput,
  YearTransitionPreviewResult,
  YearTransitionProposedPlacement,
  YearTransitionSourceTemporal,
} from "./types.ts";
export {
  indexClassMappings,
  normalizeMappingClassId,
  resolveClassMapping,
  type MappingIndex,
  type ResolvedClassMapping,
} from "./class-mapping.ts";
export {
  YEAR_TRANSITION_PREVIEW_ENGINE_VERSION,
  yearTransitionPreviewFingerprint,
  yearTransitionPreviewFingerprintFromSnapshotJson,
  yearTransitionPreviewMaterialSnapshot,
  yearTransitionPreviewMaterialSnapshotJson,
} from "./fingerprint.ts";
export { buildYearTransitionPreview, YEAR_TRANSITION_AGENDA_COMPAT_HOUR } from "./preview.ts";
export { isPrivateNoteApplySkipReason, previewPrivateNotes } from "./private-notes.ts";
export type { PrivateNotePreviewEntry } from "./private-notes.ts";
export {
  resolveUniqueSourceCourseSession,
  resolveUniqueSourceCourseSessionFromKey,
} from "./session-anchor.ts";
export { YearTransitionPreviewJsonError, parsePersistedObjectJson } from "./persist-json.ts";
export {
  createPersistedYearTransitionPreview,
  type CreatePersistedYearTransitionPreviewOptions,
  type PersistedYearTransitionPreviewRecord,
} from "./persist.ts";
export type {
  PersistedYearTransitionPreview,
  PersistedYearTransitionPreviewEntry,
  YearTransitionPreviewListFilter,
  YearTransitionPreviewStore,
} from "./store.ts";
export { assembleLiveYearTransitionPreviewInput } from "./assemble.ts";
export type { AssembleLiveYearTransitionPreviewInputDeps } from "./assemble.ts";
export {
  TARGET_MEETING_DAY_PLAN_DUPLICATE,
  TARGET_MEETING_DAY_PLAN_DUPLICATE_REASON,
  TARGET_MEETING_DAY_PLAN_INVALID,
  TARGET_MEETING_DAY_PLAN_REQUIRED,
  TARGET_MEETING_DAY_PLAN_REQUIRED_REASON,
  YearTransitionPreviewContractError,
  canonicalizeTargetMeetingDayPlans,
  parseTargetMeetingDayPlans,
  requireTargetMeetingDayPlans,
  type YearTransitionTargetMeetingDayPlan,
} from "./target-meeting-days.ts";
export {
  extractClassMappingsFromSnapshotJson,
  YearTransitionSnapshotCorruptedError,
} from "./snapshot-mappings.ts";
export {
  bindPrivateNotesOwner,
  mappingIssueMessages,
  parseYearTransitionClassMappings,
  presentApplyOutcome,
  presentSchoolYearOption,
  presentTransitionClass,
  presentYearTransitionPreview,
  previewHasBlockingEntries,
  YEAR_TRANSITION_APPLY_FAILURE_LABELS,
  YEAR_TRANSITION_NOTE_REASON_EXPLANATIONS,
  YEAR_TRANSITION_NOTE_REASON_LABELS,
  YEAR_TRANSITION_TRANSFER_CAPABILITIES,
} from "./presentation.ts";
export type {
  YearTransitionCatalogLookups,
  YearTransitionClassOption,
  YearTransitionClassSummary,
  YearTransitionPresentedPreview,
  YearTransitionPresentedRow,
  YearTransitionYearOption,
} from "./presentation.ts";
export {
  applyAuthorizedYearTransition,
  createAuthorizedYearTransitionPreview,
  loadYearTransitionPrepareState,
  parseSelectedSourceClassIds,
  parseYearTransitionPreviewRequest,
} from "./prepare.ts";
export {
  classContinuationIdentity,
  isPendingTargetClassId,
  isPendingTargetCourseId,
  pendingTargetClassId,
  pendingTargetCourseId,
  resolveClassContinuations,
} from "./continuation-identity.ts";
export { applyPersistedYearTransition, expectedApplyResultForPreviewReason } from "./apply.ts";
export type { ApplyPersistedYearTransitionDeps } from "./apply.ts";
export {
  YEAR_TRANSITION_APPLY_BLOCKING_REASONS,
  YEAR_TRANSITION_APPLY_FAILURE_CODES,
  YEAR_TRANSITION_APPLY_RESULTS,
  YEAR_TRANSITION_APPLY_SUCCESS_CODES,
} from "./apply-types.ts";
export type {
  PersistedYearTransitionApply,
  PersistedYearTransitionApplyEntry,
  YearTransitionApplyAgendaInsert,
  YearTransitionApplyFailure,
  YearTransitionApplyFailureCode,
  YearTransitionApplyOutcome,
  YearTransitionApplyPlan,
  YearTransitionApplyResult,
  YearTransitionApplyStore,
  YearTransitionApplySuccess,
  YearTransitionApplySuccessCode,
} from "./apply-types.ts";
