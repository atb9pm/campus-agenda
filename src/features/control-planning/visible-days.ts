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
  existingControlDayIndexes: readonly number[];
}): number[] {
  const weekSessions = options.sessions.filter(
    (session) => session.schoolWeekNumber === options.schoolWeekNumber,
  );
  const visible = new Set<number>();

  if (options.classroomId) {
    if (options.selectedSchoolClassId) {
      const classSessions = weekSessions.filter(
        (session) => session.classId === options.selectedSchoolClassId,
      );
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
  } else {
    for (const session of weekSessions) {
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

export function emptyControlPlanningWeekMessage(options: {
  classroomId: string | null;
  mode: ControlPlanningMode;
  structured: boolean;
}): string {
  if (options.classroomId && !options.structured) {
    return "Cette classe n’est pas reliée à l’horaire structuré.";
  }
  if (!options.classroomId) {
    return "Aucun de vos cours n’est prévu cette semaine.";
  }
  if (options.mode === "class-all") {
    return "Aucun cours n’est prévu pour cette classe cette semaine.";
  }
  return "Vous n’avez aucun cours avec cette classe cette semaine.";
}
