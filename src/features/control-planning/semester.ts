import { isoDateForSchoolWeekDay } from "../school-days/index.ts";
import type { CourseSession } from "../course-sessions/types.ts";
import type { SchoolWeekEntry } from "../school-year/types.ts";
import type { TeacherCourseAssignment } from "../annual-courses/types.ts";
import type { ControlPlanningPeriod } from "./period-types.ts";
import type {
  ControlPlanningPeriodView,
  ControlPlanningSemesterDay,
  ControlPlanningSemesterSummary,
  ControlPlanningSemesterWeek,
} from "./period-types.ts";
import { weekdayLabelForIndex } from "./period-types.ts";
import {
  DEFAULT_SEMESTER_DAY_INDEXES,
  courseSessionDayIndex,
  listVisibleControlPlanningDayIndexesForWeeks,
  teacherOwnsCourseSession,
} from "./visible-days.ts";
import type {
  ControlPlacementOption,
  ControlPlanningCard,
  ControlPlanningMode,
} from "./types.ts";

export function buildControlPlanningSemesterView(options: {
  period: ControlPlanningPeriod;
  weeks: readonly SchoolWeekEntry[];
  cards: ControlPlanningCard[];
  classDayCards: ControlPlanningCard[];
  placementOptions: ControlPlacementOption[];
  sessions: readonly CourseSession[];
  assignments: readonly TeacherCourseAssignment[];
  teacherId: string;
  mode: ControlPlanningMode;
  selectedSchoolClassIds: readonly string[];
  canCreate: boolean;
}): ControlPlanningPeriodView {
  const weekNumbers = options.period.weeks.map((week) => week.number);
  const existingControlDayIndexes = options.cards
    .filter((card) => weekNumbers.includes(card.schoolWeekNumber))
    .map((card) => card.dayIndex);
  let visibleDayIndexes = listVisibleControlPlanningDayIndexesForWeeks({
    mode: options.mode,
    teacherId: options.teacherId,
    sessions: options.sessions,
    assignments: options.assignments,
    selectedSchoolClassIds: options.selectedSchoolClassIds,
    existingControlDayIndexes,
    weekNumbers,
  });
  if (visibleDayIndexes.length === 0) {
    visibleDayIndexes = [...DEFAULT_SEMESTER_DAY_INDEXES];
  }

  const classIds = new Set(options.selectedSchoolClassIds);
  const weeks: ControlPlanningSemesterWeek[] = options.period.weeks.map((week) => {
    const weekSessions = options.sessions.filter(
      (session) =>
        session.schoolWeekNumber === week.number &&
        (classIds.size === 0 || classIds.has(session.classId)),
    );
    const days: ControlPlanningSemesterDay[] = visibleDayIndexes.map((dayIndex) => {
      const date = isoDateForSchoolWeekDay(options.weeks, week.number, dayIndex);
      const daySessions = weekSessions.filter((session) => courseSessionDayIndex(session) === dayIndex);
      const teacherDaySessions = daySessions.filter((session) =>
        teacherOwnsCourseSession({
          teacherId: options.teacherId,
          session,
          assignments: options.assignments,
        }),
      );
      const hasCourse = options.mode === "class-all" ? daySessions.length > 0 : teacherDaySessions.length > 0;
      const controls = options.cards
        .filter((card) => card.schoolWeekNumber === week.number && card.dayIndex === dayIndex)
        .slice()
        .sort(sortSemesterCards);
      const classDayControls = options.classDayCards
        .filter((card) => card.schoolWeekNumber === week.number && card.dayIndex === dayIndex)
        .slice()
        .sort(sortSemesterCards);
      const placementOptions = options.placementOptions.filter(
        (option) => option.schoolWeekNumber === week.number && option.dayIndex === dayIndex,
      );
      return {
        dayIndex,
        weekdayLabel: weekdayLabelForIndex(dayIndex),
        date,
        controls,
        placementOptions,
        classDayControls,
        hasCourse,
        canPlan: options.canCreate && placementOptions.length > 0,
        confirmationRequired: false,
      };
    });
    return {
      number: week.number,
      kind: week.kind,
      monday: week.monday,
      hasCourse: weekSessions.length > 0,
      days,
    };
  });

  return {
    id: options.period.id,
    label: options.period.label,
    weeks,
    visibleDayIndexes,
  };
}

export function buildControlPlanningSemesterSummary(options: {
  semester: ControlPlanningPeriodView;
  selectedClassCount: number;
}): ControlPlanningSemesterSummary {
  const days = options.semester.weeks.flatMap((week) => week.days);
  const controlCount = days.reduce((sum, day) => sum + day.controls.length, 0);
  const busyDayCount = days.filter((day) => day.controls.length >= 2).length;
  const weekCount = options.semester.weeks.filter((week) =>
    week.days.some((day) => day.controls.length > 0),
  ).length;
  return {
    controlCount,
    classCount: options.selectedClassCount,
    weekCount,
    busyDayCount,
  };
}

function sortSemesterCards(left: ControlPlanningCard, right: ControlPlanningCard): number {
  const classCmp = left.classroomName.localeCompare(right.classroomName, "fr");
  if (classCmp !== 0) return classCmp;
  const branchCmp = left.branchLabel.localeCompare(right.branchLabel, "fr");
  if (branchCmp !== 0) return branchCmp;
  return left.title.localeCompare(right.title, "fr") || left.agendaItemId - right.agendaItemId;
}
