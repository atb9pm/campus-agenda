import type { StudentAccessRecord, StudentAccessStore } from "../../lib/persistence/student-access-types.ts";
import type { TeacherClassAccessView } from "../../types/student-access.ts";
import {
  findStudentAccessForAssignedClass,
  normalizeAssignedTeacherClasses,
  type AssignedTeacherClass,
} from "./match.ts";
import { unsealStudentAccessCode } from "./seal.ts";

export type { TeacherClassAccessStatus, TeacherClassAccessView } from "../../types/student-access.ts";
export type { AssignedTeacherClass } from "./match.ts";

async function toTeacherView(
  assigned: AssignedTeacherClass,
  record: StudentAccessRecord | undefined,
): Promise<TeacherClassAccessView> {
  const schoolClassId = assigned.schoolClassId;
  const classCode = assigned.classCode?.trim() || record?.label || "";
  if (!record) {
    return { schoolClassId, classCode, code: null, status: "none" };
  }
  if (record.revokedAt) {
    return { schoolClassId, classCode, code: null, status: "revoked" };
  }
  const code = await unsealStudentAccessCode(record.accessCodeCiphertext);
  return {
    schoolClassId,
    classCode,
    code,
    status: code ? "active" : "needs_admin",
  };
}

export async function teacherClassAccessViews(
  accesses: StudentAccessStore,
  assignedClasses: readonly string[] | readonly AssignedTeacherClass[],
): Promise<Record<string, TeacherClassAccessView>> {
  const assigned = normalizeAssignedTeacherClasses(assignedClasses);
  const records = await accesses.listAll();
  const result: Record<string, TeacherClassAccessView> = {};
  for (const entry of assigned) {
    const record = findStudentAccessForAssignedClass(records, entry);
    result[entry.schoolClassId] = await toTeacherView(entry, record);
  }
  return result;
}
