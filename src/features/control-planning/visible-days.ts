import {
  assignmentInstantForSessionDate,
  teacherHasStructuredPublishAccess,
} from "../agenda-bridge/access.ts";
import type { TeacherCourseAssignment } from "../annual-courses/types.ts";
import type { CourseSession } from "../course-sessions/types.ts";
import type { ControlPlanningMode } from "./types.ts";

const SCHOOL_DAY_INDEXES = [0, 1, 2, 3, 4] as const;

export function courseSessionDayIndex(session: Pick<CourseSession, "dayOfWeek">): number {
  return session.dayOfWeek - 1;
}

export function teacherOwnsCourseSession(options: {
  teacherId: string;
  session: CourseSession;
  assignments: readonly TeacherCourseAssignment[];
}): boolean {
  return teacherHasStructuredPublishAccess({
    teacherId: options.teacherId,
    annualCourseId: options.session.annualCourseId,
    assignments: options.assignments as TeacherCourseAssignment[],
    at: assignmentInstantForSessionDate(options.session.date),
  });
}

function resolvedSchoolClassIds(options: {
  selectedSchoolClassId: string | null;
  selectedSchoolClassIds?: readonly string[] | null;
}): string[] {
  if (options.selectedSchoolClassIds && options.selectedSchoolClassIds.length > 0) {
    return [...new Set(options.selectedSchoolClassIds)];
  }
  if (options.selectedSchoolClassId) return [options.selectedSchoolClassId];
  return [];
}

function collectVisibleDayIndexes(options: {
  mode: ControlPlanningMode;
  teacherId: string;
  sessions: readonly CourseSession[];
  assignments: readonly TeacherCourseAssignment[];
  selectedSchoolClassIds: readonly string[];
  existingControlDayIndexes: readonly number[];
  teacherWide: boolean;
}): number[] {
  const visible = new Set<number>();

  if (options.teacherWide) {
    for (const session of options.sessions) {
      if (
        teacherOwnsCourseSession({
          teacherId: options.teacherId,
          session,
          assignments: options.assignments,
        })
      ) {
        visible.add(courseSessionDayIndex(session));
      }
    }
  } else if (options.selectedSchoolClassIds.length > 0) {
    const classIds = new Set(options.selectedSchoolClassIds);
    const classSessions = options.sessions.filter((session) => classIds.has(session.classId));
    if (options.mode === "class-all") {
      for (const session of classSessions) visible.add(courseSessionDayIndex(session));
    } else {
      for (const session of classSessions) {
        if (
          teacherOwnsCourseSession({
            teacherId: options.teacherId,
            session,
            assignments: options.assignments,
          })
        ) {
          visible.add(courseSessionDayIndex(session));
        }
      }
    }
  }

  for (const dayIndex of options.existingControlDayIndexes) {
    if (
      Number.isInteger(dayIndex) &&
      dayIndex >= SCHOOL_DAY_INDEXES[0] &&
      dayIndex <= SCHOOL_DAY_INDEXES[SCHOOL_DAY_INDEXES.length - 1]
    ) {
      visible.add(dayIndex);
    }
  }

  return [...visible].sort((left, right) => left - right);
}

/**
 * Jours affichés pour une semaine : CourseSession de la vue
 * + jours qui ont déjà un contrôle (filet legacy, sans autoriser une publication).
 */
export function listVisibleControlPlanningDayIndexes(options: {
  mode: ControlPlanningMode;
  classroomId: string | null;
  schoolWeekNumber: number;
  teacherId: string;
  sessions: readonly CourseSession[];
  assignments: readonly TeacherCourseAssignment[];
  selectedSchoolClassId: string | null;
  selectedSchoolClassIds?: readonly string[] | null;
  existingControlDayIndexes: readonly number[];
}): number[] {
  const weekSessions = options.sessions.filter(
    (session) => session.schoolWeekNumber === options.schoolWeekNumber,
  );
  const selectedSchoolClassIds = resolvedSchoolClassIds(options);
  const teacherWide = !options.classroomId && selectedSchoolClassIds.length === 0;
  return collectVisibleDayIndexes({
    mode: options.mode,
    teacherId: options.teacherId,
    sessions: weekSessions,
    assignments: options.assignments,
    selectedSchoolClassIds,
    existingControlDayIndexes: options.existingControlDayIndexes,
    teacherWide,
  });
}

/** Union des jours pertinents sur un ensemble de semaines (vue semestre). */
export function listVisibleControlPlanningDayIndexesForWeeks(options: {
  mode: ControlPlanningMode;
  teacherId: string;
  sessions: readonly CourseSession[];
  assignments: readonly TeacherCourseAssignment[];
  selectedSchoolClassIds: readonly string[];
  existingControlDayIndexes: readonly number[];
  weekNumbers: readonly number[];
}): number[] {
  const weekSet = new Set(options.weekNumbers);
  const scopedSessions = options.sessions.filter((session) => weekSet.has(session.schoolWeekNumber));
  const days = collectVisibleDayIndexes({
    mode: options.mode,
    teacherId: options.teacherId,
    sessions: scopedSessions,
    assignments: options.assignments,
    selectedSchoolClassIds: options.selectedSchoolClassIds,
    existingControlDayIndexes: options.existingControlDayIndexes,
    teacherWide: options.selectedSchoolClassIds.length === 0,
  });
  return days;
}

export const DEFAULT_SEMESTER_DAY_INDEXES = [...SCHOOL_DAY_INDEXES];

export function emptyControlPlanningWeekMessage(options: {
  classroomId: string | null;
  mode: ControlPlanningMode;
  structured: boolean;
  selectedCount?: number;
}): string {
  if (options.classroomId && !options.structured) {
    return "Cette classe n’est pas reliée à l’horaire structuré.";
  }
  const selectedCount = options.selectedCount ?? (options.classroomId ? 1 : 0);
  if (selectedCount > 1) {
    if (options.mode === "class-all") {
      return "Aucun cours n’est prévu pour ces classes cette semaine.";
    }
    return "Vous n’avez aucun cours avec ces classes cette semaine.";
  }
  if (!options.classroomId) {
    return "Aucun de vos cours n’est prévu cette semaine.";
  }
  if (options.mode === "class-all") {
    return "Aucun cours n’est prévu pour cette classe cette semaine.";
  }
  return "Vous n’avez aucun cours avec cette classe cette semaine.";
}
