import type { StudentAccessRecord } from "../../lib/persistence/student-access-types.ts";

export function deterministicStudentAccessId(schoolClassId: string): string {
  return `student-access-${schoolClassId}`;
}

/**
 * Réutilise une ligne existante plutôt que d'insérer (PK, UNIQUE(label) historique,
 * accès orphelin sans school_class_id invisible dans l'UI).
 */
export function pickReusableStudentAccess(
  records: readonly StudentAccessRecord[],
  input: { schoolClassId: string; classroomId: string; label: string },
): StudentAccessRecord | null {
  const byClass = records.find((row) => row.schoolClassId === input.schoolClassId);
  if (byClass) return byClass;
  const expectedId = deterministicStudentAccessId(input.schoolClassId);
  const byId = records.find((row) => row.id === expectedId);
  if (byId) return byId;
  const byClassroom = records.find(
    (row) =>
      row.classroomId === input.classroomId
      && (!row.schoolClassId || row.schoolClassId === input.schoolClassId),
  );
  if (byClassroom) return byClassroom;
  const wanted = input.label.trim().toLowerCase();
  return (
    records.find((row) => !row.schoolClassId && row.label.trim().toLowerCase() === wanted) ?? null
  );
}

export function isPersistenceConstraintError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /UNIQUE|CONSTRAINT|constraint failed|already exists/i.test(message);
}
