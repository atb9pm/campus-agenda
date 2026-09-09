import type { PrototypeAgendaItem } from "../agenda/demo-items.ts";
import type { TeacherCourseWorkspaceEntry } from "../teacher-workspace/types.ts";

/** Cours ouvert depuis Mes cours — jamais la première branche par défaut. */
export interface NotebookCourseContext {
  annualCourseId: string;
  classId: string;
  branchId: string;
  branchLabel: string;
}

export function notebookContextFromCourse(course: TeacherCourseWorkspaceEntry): NotebookCourseContext {
  return {
    annualCourseId: course.annualCourseId,
    classId: course.classId,
    branchId: course.branchId,
    branchLabel: course.branchLabel,
  };
}

export function openCourseInWeekTarget(
  course: TeacherCourseWorkspaceEntry,
  selectedSchoolWeekNumber: number,
): {
  section: "ma-semaine";
  classId: string;
  annualCourseId: string;
  branchId: string;
  branchLabel: string;
  schoolWeekNumber: number;
} {
  return {
    section: "ma-semaine",
    classId: course.classId,
    annualCourseId: course.annualCourseId,
    branchId: course.branchId,
    branchLabel: course.branchLabel,
    schoolWeekNumber: selectedSchoolWeekNumber,
  };
}

export function filterNotebookItemsForSubject(
  items: readonly PrototypeAgendaItem[],
  options: {
    classroomId: string;
    teacherId: string;
    subjectId: string | null;
    restrictToSubject: boolean;
  },
): PrototypeAgendaItem[] {
  return items.filter((item) => {
    if (item.classroomId !== options.classroomId) return false;
    if (item.authorTeacherId !== options.teacherId) return false;
    if (options.restrictToSubject && options.subjectId) {
      return item.subjectId === options.subjectId;
    }
    return true;
  });
}
