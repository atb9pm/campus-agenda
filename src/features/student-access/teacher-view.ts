import type { StudentAccessStore } from "../../lib/persistence/student-access-types.ts";
import type { TeacherClassAccessView } from "../../types/student-access.ts";
import { unsealStudentAccessCode } from "./seal.ts";

export type { TeacherClassAccessStatus, TeacherClassAccessView } from "../../types/student-access.ts";

export async function teacherClassAccessViews(
  accesses: StudentAccessStore,
  allowedSchoolClassIds: readonly string[],
): Promise<Record<string, TeacherClassAccessView>> {
  const allowed = [...new Set(allowedSchoolClassIds.filter(Boolean))];
  const result: Record<string, TeacherClassAccessView> = {};
  for (const schoolClassId of allowed) {
    const record = await accesses.getBySchoolClassId(schoolClassId);
    if (!record) {
      result[schoolClassId] = { schoolClassId, code: null, status: "none" };
      continue;
    }
    if (record.revokedAt) {
      result[schoolClassId] = { schoolClassId, code: null, status: "revoked" };
      continue;
    }
    const code = await unsealStudentAccessCode(record.accessCodeCiphertext);
    result[schoolClassId] = {
      schoolClassId,
      code,
      status: code ? "active" : "needs_admin",
    };
  }
  return result;
}
