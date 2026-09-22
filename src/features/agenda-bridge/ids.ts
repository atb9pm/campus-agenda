/** Identifiant déterministe du classroom runtime d'une SchoolClass. */
export function runtimeClassroomIdForSchoolClass(schoolClassId: string): string {
  return `classroom-school-${schoolClassId}`;
}

const RUNTIME_SUBJECT_PREFIX = "subject-course-";

/** Identifiant déterministe du subject runtime d'un AnnualCourse. */
export function runtimeSubjectIdForAnnualCourse(annualCourseId: string): string {
  return `${RUNTIME_SUBJECT_PREFIX}${annualCourseId}`;
}

export function looksLikeRuntimeSubjectId(value: string): boolean {
  return value.trim().startsWith(RUNTIME_SUBJECT_PREFIX);
}

export function annualCourseIdFromRuntimeSubjectId(subjectId: string): string | null {
  const trimmed = subjectId.trim();
  if (!trimmed.startsWith(RUNTIME_SUBJECT_PREFIX)) return null;
  const courseId = trimmed.slice(RUNTIME_SUBJECT_PREFIX.length).trim();
  return courseId || null;
}
