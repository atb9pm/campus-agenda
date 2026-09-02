import type { TeacherCourseAssignment } from "../annual-courses/types.ts";
import type { CourseSession } from "../course-sessions/types.ts";
import type { ControlPlanningCard, ControlPlanningMode, ControlPlacementOption } from "./types.ts";
import { SCHOOL_WEEKDAY_LABELS } from "../school-days/index.ts";

export const CONTROL_PLANNING_LAYOUTS = ["semester", "week"] as const;
export type ControlPlanningLayout = (typeof CONTROL_PLANNING_LAYOUTS)[number];

export const CONTROL_PLANNING_PERIOD_IDS = ["semester-1", "semester-2"] as const;
export type ControlPlanningPeriodId = (typeof CONTROL_PLANNING_PERIOD_IDS)[number];

export interface ControlPlanningPeriod {
  id: ControlPlanningPeriodId;
  label: string;
  weeks: Array<{ number: number; kind: "A" | "B"; monday: string }>;
}

export interface ControlPlanningSemesterDay {
  dayIndex: number;
  weekdayLabel: string;
  date: string | null;
  controls: ControlPlanningCard[];
  placementOptions: ControlPlacementOption[];
  classDayControls: ControlPlanningCard[];
  hasCourse: boolean;
  canPlan: boolean;
  confirmationRequired: boolean;
}

export interface ControlPlanningSemesterWeek {
  number: number;
  kind: "A" | "B";
  monday: string;
  hasCourse: boolean;
  days: ControlPlanningSemesterDay[];
}

export interface ControlPlanningPeriodView {
  id: ControlPlanningPeriodId;
  label: string;
  weeks: ControlPlanningSemesterWeek[];
  visibleDayIndexes: number[];
}

export interface ControlPlanningSemesterSummary {
  controlCount: number;
  classCount: number;
  weekCount: number;
  busyDayCount: number;
}

export function parseControlPlanningLayout(value: string | null | undefined): ControlPlanningLayout | null {
  if (!value) return "semester";
  return (CONTROL_PLANNING_LAYOUTS as readonly string[]).includes(value)
    ? (value as ControlPlanningLayout)
    : null;
}

export function parseControlPlanningPeriodId(value: string | null | undefined): ControlPlanningPeriodId | null {
  if (!value) return null;
  return (CONTROL_PLANNING_PERIOD_IDS as readonly string[]).includes(value)
    ? (value as ControlPlanningPeriodId)
    : null;
}

export function weekdayLabelForIndex(dayIndex: number): string {
  return SCHOOL_WEEKDAY_LABELS[dayIndex] ?? `Jour ${dayIndex + 1}`;
}

export function sessionMatchesPlanningScope(options: {
  session: CourseSession;
  mode: ControlPlanningMode;
  teacherId: string;
  assignments: readonly TeacherCourseAssignment[];
  selectedSchoolClassIds: readonly string[];
  ownsSession: (session: CourseSession) => boolean;
}): boolean {
  if (
    options.selectedSchoolClassIds.length > 0 &&
    !options.selectedSchoolClassIds.includes(options.session.classId)
  ) {
    return false;
  }
  if (options.mode === "class-all") return true;
  return options.ownsSession(options.session);
}
