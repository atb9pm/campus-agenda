export {
  formatAdminCode,
  parseAdminCodeSequence,
  type AdminCodeKind,
} from "./admin-codes.ts";
export {
  buildDefaultSchoolBranches,
  buildDefaultSchoolClasses,
  DEFAULT_SCHOOL_BRANCH_LABELS,
  DEFAULT_SCHOOL_CLASS_CODES,
} from "./defaults.ts";
export {
  branchDeleteBlockers,
  canReduceProfessionDuration,
  evaluateAgendaBranchForClass,
  isBranchAllowedForClass,
  listBranchesForClass,
  listPlannedBranchesForClass,
  professionDeleteBlockers,
  trainingYearsForDuration,
  validateClassProfessionAttachment,
} from "./profession-rules.ts";
export type {
  PedagogicalContextInput,
  PedagogicalContextRecord,
  PedagogyMutationErr,
  PedagogyMutationOk,
  PedagogyMutationResult,
  SchoolProfessionInput,
  SchoolProfessionRecord,
} from "./profession-types.ts";
export {
  listActiveSchoolBranches,
  listActiveSchoolClasses,
  normalizeClassCode,
  sortSchoolBranches,
  sortSchoolClasses,
} from "./queries.ts";
export {
  findUniqueSchoolYearIdForLabel,
  listSelectableSchoolYearsForClassEdit,
  listSelectableSchoolYearsForNewClass,
  resolveClassSchoolYearAttachment,
  type SchoolYearRef,
} from "./school-year-attachment.ts";
export { validateAdminClassCreate } from "./admin-class.ts";
export { CTX_IN_USE_DELETE_REASON, contextDeleteBlockers } from "./ctx-guards.ts";
export type {
  SchoolBranchInput,
  SchoolBranchRecord,
  SchoolClassInput,
  SchoolClassRecord,
} from "./types.ts";
