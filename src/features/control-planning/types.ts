import type { PrototypeAgendaItem } from "../agenda/demo-items.ts";
import type { SchoolWeekEntry } from "../school-year/types.ts";

export const CONTROL_PLANNING_MODES = ["mine", "class-all"] as const;

export type ControlPlanningMode = (typeof CONTROL_PLANNING_MODES)[number];

export interface ControlPlanningClass {
  id: string;
  name: string;
}

export interface ControlPlanningCard {
  agendaItemId: number;
  classroomId: string;
  classroomName: string;
  subjectId: string;
  branchLabel: string;
  title: string;
  teacherId: string;
  teacherName: string;
  isOwn: boolean;
  schoolWeekNumber: number;
  dayIndex: number;
  date: string | null;
}

export interface ControlPlacementOption {
  annualCourseId: string;
  courseSessionKey: string;
  date: string;
  schoolWeekNumber: number;
  dayIndex: number;
  branchLabel: string;
  sessionLabel?: string;
}

export interface ControlPlanningDay {
  dayIndex: number;
  weekdayLabel: string;
  date: string | null;
  controls: ControlPlanningCard[];
  placementOptions: ControlPlacementOption[];
  canPlan: boolean;
  noCourseHint: string | null;
  classDayControls: ControlPlanningCard[];
  confirmationRequired: boolean;
}

export interface ControlPlanningWeekView {
  number: number;
  kind: "A" | "B";
  monday: string;
  days: ControlPlanningDay[];
}

export interface ControlPlanningAlert {
  kind: "busy-day" | "free-day" | "teacher-load";
  message: string;
}

export interface ControlPlanningYearOption {
  id: string;
  label: string;
  status: "active" | "archived";
}

export interface ControlPlanningView {
  schoolYearId: string;
  schoolYearLabel: string;
  yearStatus: "active" | "archived";
  mode: ControlPlanningMode;
  classroomId: string | null;
  classes: ControlPlanningClass[];
  years: ControlPlanningYearOption[];
  summary: {
    controlCount: number;
    classCount: number;
  };
  week: ControlPlanningWeekView | null;
  weeks: Array<{ number: number; kind: "A" | "B" }>;
  alerts: ControlPlanningAlert[];
  teacherLoadThisWeek: number;
  teacherWeekControls: ControlPlanningCard[];
  canCreate: boolean;
  guidedPlanningReason: string | null;
}

export interface ControlPlanningCatalog {
  classrooms: Array<{ id: string; name: string }>;
  subjects: Array<{ id: string; name: string }>;
  teachers: Array<{ id: string; displayName: string; initials: string }>;
}

export interface BuildControlPlanningInput {
  teacherId: string;
  items: PrototypeAgendaItem[];
  catalog: ControlPlanningCatalog;
  accessibleClasses: ControlPlanningClass[];
  weeks: SchoolWeekEntry[];
  schoolYearId: string;
  schoolYearLabel: string;
  years: ControlPlanningYearOption[];
  classroomId: string | null;
  requestedMode: string | null;
  schoolWeekNumber: number | null;
  todayIso: string;
  includeUnscopedYearItems: boolean;
  yearStatus: "active" | "archived";
  placementOptions: ControlPlacementOption[];
  canCreate: boolean;
  guidedPlanningReason: string | null;
}
