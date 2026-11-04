import type { PrototypeAgendaItem } from "../agenda/demo-items.ts";
import type { SchoolWeekKind } from "../calendar/types.ts";
import type { TeacherCourseWorkspaceEntry } from "../teacher-workspace/types.ts";

export type CourseWeekSuffix = "A" | "B";

/** Semaine d’ouverture du carnet depuis un badge de Ma semaine. */
export interface CourseOpeningWeek {
  number: number;
  kind: SchoolWeekKind | null;
}

export type CourseOpeningWeekResult =
  | { ok: true; schoolWeekNumber: number }
  | { ok: false; reason: string };

export function courseOpeningWeekMissingReason(weekSuffix: CourseWeekSuffix): string {
  return `Aucune semaine ${weekSuffix} n’est disponible dans cette année scolaire. Ma semaine reste inchangée.`;
}

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

/**
 * Semaine du carnet à partir du rythme du badge et du calendrier scolaire officiel.
 * Les semaines absentes (vacances) ne sont pas dans `schoolWeeks` : on ne fait pas « numéro + 1 ».
 * Sans suffixe A/B, la semaine consultée est conservée.
 * Sinon : la semaine consultée si elle a le bon rythme, puis la prochaine semaine de ce rythme,
 * puis la dernière semaine antérieure de ce rythme. Jamais une autre année.
 */
export function resolveCourseOpeningWeek(
  schoolWeeks: readonly CourseOpeningWeek[],
  selectedSchoolWeekNumber: number,
  weekSuffix: CourseWeekSuffix | null | undefined,
): CourseOpeningWeekResult {
  if (weekSuffix !== "A" && weekSuffix !== "B") {
    return { ok: true, schoolWeekNumber: selectedSchoolWeekNumber };
  }
  const ordered = [...schoolWeeks].sort((left, right) => left.number - right.number);
  const currentIndex = ordered.findIndex((week) => week.number === selectedSchoolWeekNumber);
  const current = currentIndex >= 0 ? ordered[currentIndex] : undefined;
  if (current?.kind === weekSuffix) {
    return { ok: true, schoolWeekNumber: current.number };
  }
  const afterCurrent = currentIndex >= 0
    ? ordered.slice(currentIndex + 1)
    : ordered.filter((week) => week.number > selectedSchoolWeekNumber);
  const later = afterCurrent.find((week) => week.kind === weekSuffix);
  if (later) return { ok: true, schoolWeekNumber: later.number };
  const beforeCurrent = currentIndex >= 0
    ? ordered.slice(0, currentIndex)
    : ordered.filter((week) => week.number < selectedSchoolWeekNumber);
  const earlier = [...beforeCurrent].reverse().find((week) => week.kind === weekSuffix);
  if (earlier) return { ok: true, schoolWeekNumber: earlier.number };
  return { ok: false, reason: courseOpeningWeekMissingReason(weekSuffix) };
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
    annualCourseId?: string | null;
    restrictToSubject: boolean;
  },
): PrototypeAgendaItem[] {
  return items.filter((item) => {
    if (item.classroomId !== options.classroomId) return false;
    if (!options.restrictToSubject) {
      return item.authorTeacherId === options.teacherId;
    }
    const annual = options.annualCourseId?.trim() || "";
    if (annual && item.annualCourseId === annual) return true;
    if (annual && item.annualCourseId && item.annualCourseId !== annual) return false;
    if (!(Boolean(options.subjectId) && item.subjectId === options.subjectId)) return false;
    return item.authorTeacherId === options.teacherId;
  });
}
