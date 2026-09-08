import { isUsablePasswordHash, verifyPassword } from "../../lib/auth/password.ts";
import type { StudentAccessRecord } from "../../lib/persistence/student-access-types.ts";
import type { StudentSession } from "../../lib/persistence/types.ts";
import type { SchoolClassRecord } from "../school-catalog/types.ts";
import type { SchoolYearRecord } from "../school-year/types.ts";
import { normalizeClassCode } from "../school-catalog/queries.ts";
import { parseStudentAccessCode } from "./code.ts";

export const STUDENT_LOGIN_INVALID_REASON = "Code d'accès invalide.";

export interface StudentLoginClassroom {
  id: string;
  name: string;
  schoolClassId?: string | null;
}

export interface StudentLoginDeps {
  getActiveSchoolYear(): Promise<SchoolYearRecord | null>;
  listClasses(): Promise<SchoolClassRecord[]>;
  getAccessBySchoolClassId(schoolClassId: string): Promise<StudentAccessRecord | null>;
  findClassroomBySchoolClassId(schoolClassId: string): Promise<StudentLoginClassroom | null>;
}

export type StudentLoginResult =
  | { ok: true; session: StudentSession; classroomName: string }
  | { ok: false; reason: string };

export async function authenticateStudentAccessCode(
  rawCode: string,
  deps: StudentLoginDeps,
): Promise<StudentLoginResult> {
  const parsed = parseStudentAccessCode(rawCode);
  if (!parsed) return { ok: false, reason: STUDENT_LOGIN_INVALID_REASON };

  const activeYear = await deps.getActiveSchoolYear();
  if (!activeYear || activeYear.status !== "active") {
    return { ok: false, reason: STUDENT_LOGIN_INVALID_REASON };
  }

  const classes = await deps.listClasses();
  const schoolClass = classes.find(
    (entry) =>
      entry.schoolYearId === activeYear.id &&
      normalizeClassCode(entry.code) === normalizeClassCode(parsed.prefix) &&
      entry.isActive &&
      !entry.isArchived,
  );
  if (!schoolClass) return { ok: false, reason: STUDENT_LOGIN_INVALID_REASON };

  const access = await deps.getAccessBySchoolClassId(schoolClass.id);
  if (!access || access.revokedAt) {
    return { ok: false, reason: STUDENT_LOGIN_INVALID_REASON };
  }
  if (!isUsablePasswordHash(access.accessCodeHash)) {
    return { ok: false, reason: STUDENT_LOGIN_INVALID_REASON };
  }
  const matches = await verifyPassword(parsed.canonical, access.accessCodeHash);
  if (!matches) return { ok: false, reason: STUDENT_LOGIN_INVALID_REASON };

  const classroom = await deps.findClassroomBySchoolClassId(schoolClass.id);
  if (!classroom || classroom.id !== access.classroomId) {
    return { ok: false, reason: STUDENT_LOGIN_INVALID_REASON };
  }

  return {
    ok: true,
    session: {
      kind: "student",
      accessId: access.id,
      accessVersion: access.accessVersion,
      classroomId: classroom.id,
      schoolClassId: schoolClass.id,
      schoolYearId: activeYear.id,
      label: schoolClass.code,
      issuedAt: Date.now(),
    },
    classroomName: classroom.name,
  };
}
