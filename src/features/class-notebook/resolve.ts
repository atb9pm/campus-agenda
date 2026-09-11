import { runtimeClassroomIdForSchoolClass } from "../agenda-bridge/ids.ts";
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

  const schoolClassKey = schoolClassId?.trim() || "";
  if (schoolClassKey) {
    return runtimeClassroomIdForSchoolClass(schoolClassKey);
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

function uniqueSubjectMatch(
  subjects: readonly Pick<NotebookRuntimeSubject, "id">[],
): "none" | "ambiguous" | { id: string } {
  const ids = [...new Set(subjects.map((entry) => entry.id))];
  if (ids.length === 0) return "none";
  if (ids.length > 1) return "ambiguous";
  return { id: ids[0]! };
}

function candidateNotebookSubjects(options: {
  catalog: ClassroomCatalog;
  teacherId: string;
  classroomId: string;
  runtimeSubjects?: readonly NotebookRuntimeSubject[];
}): NotebookRuntimeSubject[] {
  const byId = new Map<string, NotebookRuntimeSubject>();
  for (const entry of options.runtimeSubjects ?? []) {
    if (entry.classroomId && entry.classroomId !== options.classroomId) continue;
    byId.set(entry.id, entry);
  }
  for (const subject of subjectsForClassroom(options.catalog, options.teacherId, options.classroomId)) {
    if (byId.has(subject.id)) continue;
    byId.set(subject.id, {
      id: subject.id,
      name: subject.name,
      classroomId: subject.classroomId,
      annualCourseId: subject.annualCourseId ?? null,
    });
  }
  return [...byId.values()];
}

export function notebookUnlinkedCourseReason(branchLabel: string): string {
  const label = branchLabel.trim() || "sélectionné";
  return `Le cours ${label} n’est pas relié à une matière de cette classe.`;
}

export function resolveNotebookSubjectId(options: {
  catalog: ClassroomCatalog;
  teacherId: string;
  classroomId: string;
  branchLabel?: string | null;
  annualCourseId?: string | null;
  runtimeSubjects?: readonly NotebookRuntimeSubject[];
  /** Ouverture depuis Mes cours : jamais le premier subject. */
  strict?: boolean;
}): string | null {
  const annual = options.annualCourseId?.trim() || "";
  const label = options.branchLabel?.trim() || "";
  const strict = options.strict === true || Boolean(annual);
  const candidates = candidateNotebookSubjects(options);

  if (annual) {
    const byAnnual = uniqueSubjectMatch(
      candidates.filter((entry) => entry.annualCourseId === annual),
    );
    if (byAnnual !== "none") {
      return byAnnual === "ambiguous" ? null : byAnnual.id;
    }
  }

  if (label) {
    const wanted = label.toLowerCase();
    const byLabel = uniqueSubjectMatch(
      candidates.filter((entry) => entry.name.trim().toLowerCase() === wanted),
    );
    if (byLabel !== "none") {
      return byLabel === "ambiguous" ? null : byLabel.id;
    }
  }

  if (strict) return null;

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
