import type { StudentAccessRecord } from "../../lib/persistence/student-access-types.ts";
import type { TeacherClassAccessView } from "../../types/student-access.ts";
import { compactClassCodeKey } from "./code.ts";

export type AssignedTeacherClass = {
  schoolClassId: string;
  classCode?: string;
};

export function normalizeAssignedTeacherClasses(
  assignedClasses: readonly string[] | readonly AssignedTeacherClass[],
): AssignedTeacherClass[] {
  const seen = new Set<string>();
  const result: AssignedTeacherClass[] = [];
  for (const entry of assignedClasses) {
    const schoolClassId = typeof entry === "string" ? entry : entry.schoolClassId;
    if (!schoolClassId || seen.has(schoolClassId)) continue;
    seen.add(schoolClassId);
    result.push({
      schoolClassId,
      classCode: typeof entry === "string" ? undefined : entry.classCode,
    });
  }
  return result;
}

export function findStudentAccessForAssignedClass(
  records: readonly StudentAccessRecord[],
  assigned: AssignedTeacherClass,
): StudentAccessRecord | undefined {
  const byId = records.find((row) => row.schoolClassId === assigned.schoolClassId);
  if (byId) return byId;

  const key = compactClassCodeKey(assigned.classCode ?? "");
  if (!key) return undefined;
  const matches = records.filter((row) => compactClassCodeKey(row.label) === key);
  if (matches.length === 1) return matches[0];
  const live = matches.filter((row) => !row.revokedAt);
  return live.length === 1 ? live[0] : undefined;
}

export function teacherAccessViewForClass(
  views: Record<string, TeacherClassAccessView>,
  classId: string,
  classCode: string,
): TeacherClassAccessView | undefined {
  const direct = views[classId];
  if (direct) return direct;
  const key = compactClassCodeKey(classCode);
  if (!key) return undefined;
  return Object.values(views).find((view) => compactClassCodeKey(view.classCode) === key);
}
