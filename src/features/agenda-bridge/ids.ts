/** Identifiant déterministe du classroom runtime d'une SchoolClass. */
export function runtimeClassroomIdForSchoolClass(schoolClassId: string): string {
  return `classroom-school-${schoolClassId}`;
}

/** Identifiant déterministe du subject runtime d'un AnnualCourse. */
export function runtimeSubjectIdForAnnualCourse(annualCourseId: string): string {
  return `subject-course-${annualCourseId}`;
}
