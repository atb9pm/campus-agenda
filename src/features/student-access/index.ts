export {
  STUDENT_ACCESS_ALPHABET,
  canonicalStudentAccessCode,
  compactClassCodeKey,
  generateStudentAccessCode,
  generateStudentAccessSecret,
  normalizeStudentAccessCode,
  parseStudentAccessCode,
  type ParsedStudentAccessCode,
} from "./code.ts";
export {
  findStudentAccessForAssignedClass,
  normalizeAssignedTeacherClasses,
  teacherAccessViewForClass,
  type AssignedTeacherClass,
} from "./match.ts";
export {
  authenticateStudentAccessCode,
  STUDENT_LOGIN_INVALID_REASON,
  type StudentLoginDeps,
  type StudentLoginResult,
} from "./authenticate.ts";
export {
  revalidateStructuredStudentSession,
  type StudentSessionRevalidateDeps,
} from "./revalidate.ts";
export {
  generateStudentAccess,
  listStudentAccessMetadata,
  revokeStudentAccess,
  type GenerateStudentAccessResult,
  type RevokeStudentAccessResult,
  type StudentAccessAdminDeps,
} from "./admin.ts";
export {
  resolveStudentAccessUiStatus,
  studentAccessAllowsAdminWrite,
  studentAccessMetadataFromRecord,
} from "./status.ts";
export {
  deterministicStudentAccessId,
  isPersistenceConstraintError,
  pickReusableStudentAccess,
} from "./reuse.ts";
export {
  isSealedStudentAccessCode,
  sealStudentAccessCode,
  unsealStudentAccessCode,
} from "./seal.ts";
export {
  teacherClassAccessViews,
  type AssignedTeacherClass as TeacherAssignedClass,
  type TeacherClassAccessStatus,
  type TeacherClassAccessView,
} from "./teacher-view.ts";
