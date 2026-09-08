import type { StudentAccessRecord } from "../../lib/persistence/student-access-types.ts";
import type { StudentSession } from "../../lib/persistence/types.ts";
import type { SchoolClassRecord } from "../school-catalog/types.ts";
import type { SchoolYearRecord } from "../school-year/types.ts";

export interface StudentSessionRevalidateDeps {
  getAccessById(accessId: string): Promise<StudentAccessRecord | null>;
  getSchoolClassById(schoolClassId: string): Promise<SchoolClassRecord | null>;
  getActiveSchoolYear(): Promise<SchoolYearRecord | null>;
  findClassroomBySchoolClassId(schoolClassId: string): Promise<{ id: string } | null>;
}

export async function revalidateStructuredStudentSession(
  session: StudentSession,
  deps: StudentSessionRevalidateDeps,
): Promise<StudentSession | null> {
  if (
    typeof session.accessVersion !== "number" ||
    !Number.isInteger(session.accessVersion) ||
    !session.schoolClassId ||
    !session.schoolYearId
  ) {
    return null;
  }

  const access = await deps.getAccessById(session.accessId);
  if (!access || access.revokedAt) return null;
  if (access.accessVersion !== session.accessVersion) return null;
  if (access.schoolClassId !== session.schoolClassId) return null;
  if (access.classroomId !== session.classroomId) return null;

  const schoolClass = await deps.getSchoolClassById(session.schoolClassId);
  if (!schoolClass || schoolClass.isArchived || !schoolClass.isActive) return null;
  if (schoolClass.schoolYearId !== session.schoolYearId) return null;

  const activeYear = await deps.getActiveSchoolYear();
  if (!activeYear || activeYear.status !== "active" || activeYear.id !== session.schoolYearId) {
    return null;
  }

  const classroom = await deps.findClassroomBySchoolClassId(schoolClass.id);
  if (!classroom || classroom.id !== session.classroomId) return null;

  return session;
}
