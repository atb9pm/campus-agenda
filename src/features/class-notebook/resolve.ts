import type { ClassroomCatalog } from "../classes/queries.ts";
import { getClassroomById, getSubjectsForTeacherInClassroom } from "../classes/queries.ts";
import type { TeacherClassSetup, WeekdayIndex } from "../teacher-setup/types.ts";

/** Conversion ISO TeacherSetup (1=lundi … 5=vendredi) → index Agenda (0=lundi … 4=vendredi). */
export function weekdayToCourseDayIndex(dayOfWeek: WeekdayIndex): 0 | 1 | 2 | 3 | 4 {
  return (dayOfWeek - 1) as 0 | 1 | 2 | 3 | 4;
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
