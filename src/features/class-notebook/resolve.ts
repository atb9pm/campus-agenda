import type { ClassroomCatalog } from "../classes/queries.ts";
import {
  getClassroomById,
  getSubjectsForClassroom,
  getSubjectsForTeacherInClassroom,
} from "../classes/queries.ts";
import { compactClassCodeKey } from "../student-access/code.ts";
import type { TeacherClassSetup, WeekdayIndex } from "../teacher-setup/types.ts";

export type NotebookRuntimeSubject = {
  id: string;
  name: string;
  classroomId?: string;
  annualCourseId?: string | null;
};

export type NotebookRuntimeClassroom = {
  id: string;
  name: string;
  schoolClassId?: string | null;
  subjects?: NotebookRuntimeSubject[];
};

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

export function resolveNotebookClassroomId(
  classSetup: Pick<TeacherClassSetup, "id" | "name">,
  runtimeClassrooms: readonly NotebookRuntimeClassroom[],
  catalog: ClassroomCatalog,
  schoolClassId?: string | null,
): string | null {
  const wantedClassId = schoolClassId?.trim() || classSetup.id;
  const bySchoolClass = runtimeClassrooms.find((entry) => entry.schoolClassId === wantedClassId);
  if (bySchoolClass) return bySchoolClass.id;

  const byId = runtimeClassrooms.find((entry) => entry.id === classSetup.id);
  if (byId) return byId.id;

  const key = compactClassCodeKey(classSetup.name);
  if (key) {
    const byName = runtimeClassrooms.find((entry) => compactClassCodeKey(entry.name) === key);
    if (byName) return byName.id;
  }

  return resolveCatalogClassroomId(classSetup as TeacherClassSetup, catalog);
}

function subjectsForClassroom(
  catalog: ClassroomCatalog,
  teacherId: string,
  classroomId: string,
) {
  const taught = getSubjectsForTeacherInClassroom(catalog, teacherId, classroomId);
  return taught.length ? taught : getSubjectsForClassroom(catalog, classroomId);
}

export function resolveNotebookSubjectId(options: {
  catalog: ClassroomCatalog;
  teacherId: string;
  classroomId: string;
  branchLabel?: string | null;
  annualCourseId?: string | null;
  runtimeSubjects?: readonly NotebookRuntimeSubject[];
}): string | null {
  const inClassroom = (options.runtimeSubjects ?? []).filter(
    (entry) => !entry.classroomId || entry.classroomId === options.classroomId,
  );
  const annual = options.annualCourseId?.trim() || "";
  if (annual) {
    const linked = inClassroom.find((entry) => entry.annualCourseId === annual);
    if (linked) return linked.id;
  }
  const label = options.branchLabel?.trim() || "";
  if (label) {
    const wanted = label.toLowerCase();
    const named = inClassroom.find((entry) => entry.name.trim().toLowerCase() === wanted);
    if (named) return named.id;
    const catalogSubjects = subjectsForClassroom(options.catalog, options.teacherId, options.classroomId);
    const catalogNamed = catalogSubjects.find((subject) => subject.name.trim().toLowerCase() === wanted);
    if (catalogNamed) return catalogNamed.id;
  }
  return resolveDefaultSubjectId(
    options.catalog,
    options.teacherId,
    options.classroomId,
    label ? [label] : [],
  );
}

export function weekNotesKey(classSetupId: string, schoolWeekNumber: number): string {
  return `${classSetupId}:${schoolWeekNumber}`;
}
