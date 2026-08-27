import type { ClassroomCatalog } from "../classes/queries.ts";
import { getClassroomById, getSubjectsForTeacherInClassroom } from "../classes/queries.ts";
import type { TeacherClassSetup, WeekdayIndex } from "../teacher-setup/types.ts";

/** Jour de cours TMA accepté par l'API (0 = lundi, 3 = jeudi). */
export function weekdayToCourseDayIndex(dayOfWeek: WeekdayIndex): 0 | 3 {
  return dayOfWeek === 4 ? 3 : 0;
}

export function resolveCatalogClassroomId(
  classSetup: TeacherClassSetup,
  catalog: ClassroomCatalog,
): string | null {
  if (getClassroomById(catalog, classSetup.id)) {
    return classSetup.id;
  }

  const normalizedName = classSetup.name.trim().toUpperCase();
  if (!normalizedName) return null;

  const match = catalog.classrooms.find(
    (classroom) => classroom.name.trim().toUpperCase() === normalizedName,
  );
  return match?.id ?? null;
}

export function resolveDefaultSubjectId(
  catalog: ClassroomCatalog,
  teacherId: string,
  classroomId: string,
  branchNames: string[],
): string | null {
  const subjects = getSubjectsForTeacherInClassroom(catalog, teacherId, classroomId);
  if (!subjects.length) return null;

  if (branchNames.length) {
    const normalizedBranch = branchNames[0].trim().toLowerCase();
    const matched = subjects.find((subject) => subject.name.trim().toLowerCase() === normalizedBranch);
    if (matched) return matched.id;
  }

  return subjects[0]?.id ?? null;
}

export function weekNotesKey(classSetupId: string, schoolWeekNumber: number): string {
  return `${classSetupId}:${schoolWeekNumber}`;
}
