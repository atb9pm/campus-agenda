import type { StudentAccess } from "../../types/student-access.ts";
import type { ClassroomCatalog } from "../classes/queries.ts";
import { getClassroomById } from "../classes/queries.ts";

export function normalizeStudentAccessCode(code: string): string {
  return code.trim().toLowerCase();
}

export function resolveStudentAccess(
  catalog: ClassroomCatalog & { studentAccesses: StudentAccess[] },
  code: string,
): StudentAccess | undefined {
  const normalized = normalizeStudentAccessCode(code);
  return catalog.studentAccesses.find((access) => access.label.toLowerCase() === normalized);
}

export function findStudentAccessForClassroom(
  catalog: ClassroomCatalog & { studentAccesses: StudentAccess[] },
  classroomId: string,
): StudentAccess | undefined {
  return catalog.studentAccesses.find((access) => access.classroomId === classroomId);
}

export function studentAccessFromApiSession(session: {
  accessId?: string;
  label: string;
  classroomId: string;
}): StudentAccess {
  return {
    id: session.accessId ?? session.label,
    classroomId: session.classroomId,
    label: session.label,
  };
}

export function getStudentClassroom(
  catalog: ClassroomCatalog & { studentAccesses: StudentAccess[] },
  access: StudentAccess,
) {
  return getClassroomById(catalog, access.classroomId);
}

export function maskStudentIdentity(label: string): string {
  return label;
}
