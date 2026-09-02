import {
  assignmentInstantForSessionDate,
  teacherHasStructuredPublishAccess,
} from "../agenda-bridge/index.ts";
import type { TeacherCourseAssignment } from "../annual-courses/types.ts";
import { formatCourseSessionPeriods } from "../course-sessions/format.ts";
import type { CourseSession } from "../course-sessions/types.ts";
import type { ControlPlacementOption } from "./types.ts";

export function listControlPlacementOptions(options: {
  sessions: CourseSession[];
  assignments: TeacherCourseAssignment[];
  teacherId: string;
  schoolWeekNumber: number;
  branchByCourseId: ReadonlyMap<string, string>;
  yearStatus: "active" | "archived" | "draft";
  classroomSelected: boolean;
  structured: boolean;
}): ControlPlacementOption[] {
  if (!options.classroomSelected || !options.structured || options.yearStatus !== "active") {
    return [];
  }

  const placements: ControlPlacementOption[] = [];
  for (const session of options.sessions) {
    if (session.schoolWeekNumber !== options.schoolWeekNumber) continue;
    const at = assignmentInstantForSessionDate(session.date);
    if (
      !teacherHasStructuredPublishAccess({
        teacherId: options.teacherId,
        annualCourseId: session.annualCourseId,
        assignments: options.assignments,
        at,
      })
    ) {
      continue;
    }
    const periods = formatCourseSessionPeriods(session.segments);
    placements.push({
      annualCourseId: session.annualCourseId,
      courseSessionKey: session.key,
      date: session.date,
      schoolWeekNumber: session.schoolWeekNumber,
      dayIndex: session.dayOfWeek - 1,
      branchLabel: options.branchByCourseId.get(session.annualCourseId)?.trim() || "Branche",
      sessionLabel: periods || undefined,
    });
  }

  return placements.sort((left, right) => {
    const day = left.dayIndex - right.dayIndex;
    if (day !== 0) return day;
    const branch = left.branchLabel.localeCompare(right.branchLabel, "fr");
    if (branch !== 0) return branch;
    return left.courseSessionKey.localeCompare(right.courseSessionKey);
  });
}
