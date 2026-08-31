import { isAssignmentActiveAt } from "../annual-courses/assignments.ts";
import { ASSIGNMENT_ROLE_LABELS, type AnnualCourse, type TeacherCourseAssignment } from "../annual-courses/types.ts";
import { classDisplayProfessionLabel, classDisplayTrainingYearLabel } from "../school-catalog/class-display.ts";
import type { PedagogicalContextRecord, SchoolProfessionRecord } from "../school-catalog/profession-types.ts";
import type { SchoolBranchRecord, SchoolClassRecord } from "../school-catalog/types.ts";
import type { TeacherAccountRecord } from "../teacher-accounts/types.ts";
import { attendanceDaysForWeek } from "./class-attendance.ts";
import { ALL_DAY_PERIODS, formatPeriodRange, LUNCH_PERIOD } from "./periods.ts";
import { filterSlotsForScheduleView } from "./operational.ts";
import {
  COURSE_WEEKDAY_LABELS,
  COURSE_WEEK_KIND_LABELS,
  type AttendanceRole,
  type ClassAttendanceDay,
  type CourseScheduleSlot,
  type CourseWeekday,
  type CourseWeekKind,
} from "./types.ts";

export const NO_TEACHER_ASSIGNED_LABEL = "Aucun enseignant attribué";

export interface ScheduleTeacherDisplay {
  teacherId: string;
  displayName: string;
  roleLabel: string;
}

export function teachersForAnnualCourse(
  assignments: TeacherCourseAssignment[],
  teachers: Array<Pick<TeacherAccountRecord, "id" | "displayName">>,
  annualCourseId: string,
  at = new Date().toISOString(),
): ScheduleTeacherDisplay[] {
  const active = assignments.filter(
    (entry) => entry.annualCourseId === annualCourseId && isAssignmentActiveAt(entry, at),
  );
  const order = { PRIMARY: 0, CO_TEACHER: 1, REPLACEMENT: 2 };
  return [...active]
    .sort((left, right) => order[left.role] - order[right.role])
    .map((assignment) => {
      const teacher = teachers.find((entry) => entry.id === assignment.teacherId);
      return {
        teacherId: assignment.teacherId,
        displayName: teacher?.displayName ?? assignment.teacherId,
        roleLabel: ASSIGNMENT_ROLE_LABELS[assignment.role],
      };
    });
}

export function formatTeachersLine(teachers: ScheduleTeacherDisplay[]): string {
  if (!teachers.length) return NO_TEACHER_ASSIGNED_LABEL;
  return teachers.map((entry) => `${entry.displayName} — ${entry.roleLabel.toLowerCase()}`).join(", ");
}

export function usedWeekdays(slots: CourseScheduleSlot[]): CourseWeekday[] {
  const days = new Set<CourseWeekday>();
  for (const slot of slots) days.add(slot.dayOfWeek);
  return ([1, 2, 3, 4, 5] as const).filter((day) => days.has(day));
}

export function slotAppliesToWeekView(slot: CourseScheduleSlot, view: CourseWeekKind | "all"): boolean {
  if (view === "all") return true;
  return slot.weekKind === "all" || slot.weekKind === view;
}

export interface ClassScheduleBlock {
  periodStart: number;
  periodEnd: number;
  kind: "course" | "lunch";
  slots: CourseScheduleSlot[];
}

/** Fusionne les créneaux adjacents d’un même cours + rythme. P5 toujours insérée. */
export function buildClassDayBlocks(slots: CourseScheduleSlot[], dayOfWeek: CourseWeekday): ClassScheduleBlock[] {
  const daySlots = slots
    .filter((entry) => entry.dayOfWeek === dayOfWeek)
    .sort((left, right) => left.periodStart - right.periodStart || left.periodEnd - right.periodEnd);

  const occupied = new Map<number, CourseScheduleSlot[]>();
  for (const slot of daySlots) {
    for (let period = slot.periodStart; period <= slot.periodEnd; period += 1) {
      if (period === LUNCH_PERIOD) continue;
      const list = occupied.get(period) ?? [];
      list.push(slot);
      occupied.set(period, list);
    }
  }

  const blocks: ClassScheduleBlock[] = [];
  let index = 0;
  while (index < ALL_DAY_PERIODS.length) {
    const period = ALL_DAY_PERIODS[index]!;
    if (period === LUNCH_PERIOD) {
      blocks.push({ periodStart: LUNCH_PERIOD, periodEnd: LUNCH_PERIOD, kind: "lunch", slots: [] });
      index += 1;
      continue;
    }
    const here = occupied.get(period) ?? [];
    if (here.length === 0) {
      index += 1;
      continue;
    }
    let end = period;
    while (end + 1 !== LUNCH_PERIOD && occupied.has(end + 1) && sameOccupants(here, occupied.get(end + 1)!)) {
      end += 1;
    }
    blocks.push({ periodStart: period, periodEnd: end, kind: "course", slots: uniqueSlots(here) });
    index = ALL_DAY_PERIODS.indexOf(end as (typeof ALL_DAY_PERIODS)[number]) + 1;
  }
  return blocks;
}

function sameOccupants(left: CourseScheduleSlot[], right: CourseScheduleSlot[]): boolean {
  if (left.length !== right.length) return false;
  const leftIds = left.map((entry) => entry.id).sort().join(",");
  const rightIds = right.map((entry) => entry.id).sort().join(",");
  return leftIds === rightIds;
}

function uniqueSlots(slots: CourseScheduleSlot[]): CourseScheduleSlot[] {
  const seen = new Set<string>();
  return slots.filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
}

export interface ClassSchedulePreview {
  classId: string;
  classCode: string;
  classSubtitle: string;
  days: Array<{
    dayOfWeek: CourseWeekday;
    dayLabel: string;
    blocks: ClassScheduleBlock[];
  }>;
}

export function buildClassSchedulePreview(options: {
  schoolClass: SchoolClassRecord;
  profession?: SchoolProfessionRecord | null;
  slots: CourseScheduleSlot[];
  courses?: Array<Pick<AnnualCourse, "id" | "isArchived">>;
  yearStatus?: string | null;
}): ClassSchedulePreview {
  const slots =
    options.courses
      ? filterSlotsForScheduleView({
          slots: options.slots,
          courses: options.courses,
          yearStatus: options.yearStatus,
        })
      : options.slots;
  const days = usedWeekdays(slots).map((dayOfWeek) => ({
    dayOfWeek,
    dayLabel: COURSE_WEEKDAY_LABELS[dayOfWeek],
    blocks: buildClassDayBlocks(slots, dayOfWeek),
  }));
  const training = classDisplayTrainingYearLabel(options.schoolClass.trainingYear);
  return {
    classId: options.schoolClass.id,
    classCode: options.schoolClass.code,
    classSubtitle: `${classDisplayProfessionLabel(options.schoolClass, options.profession)} — ${training}`,
    days,
  };
}

export interface GlobalGridCell {
  classId: string;
  entries: Array<{
    slotId: string;
    annualCourseId: string;
    branchLabel: string;
    weekKind: CourseWeekKind;
    weekKindLabel: string;
  }>;
}

export interface GlobalDayGrid {
  dayOfWeek: CourseWeekday;
  dayLabel: string;
  weekKind: CourseWeekKind;
  classColumns: Array<{ classId: string; classCode: string }>;
  rows: Array<{
    period: number;
    kind: "course" | "lunch";
    label: string;
    cells: GlobalGridCell[];
  }>;
}

export function buildGlobalDayGrid(options: {
  dayOfWeek: CourseWeekday;
  weekKind: CourseWeekKind;
  slots: CourseScheduleSlot[];
  courses: AnnualCourse[];
  classes: SchoolClassRecord[];
  contexts: PedagogicalContextRecord[];
  branches: SchoolBranchRecord[];
  yearStatus?: string | null;
}): GlobalDayGrid {
  const viewSlots = filterSlotsForScheduleView({
    slots: options.slots,
    courses: options.courses,
    yearStatus: options.yearStatus,
  });
  const applicable = viewSlots.filter(
    (slot) => slot.dayOfWeek === options.dayOfWeek && slotAppliesToWeekView(slot, options.weekKind),
  );
  const courseById = new Map(options.courses.map((course) => [course.id, course]));
  const classColumns = [...options.classes].sort(
    (left, right) => left.sortOrder - right.sortOrder || left.code.localeCompare(right.code, "fr-CH"),
  );

  const contextById = new Map(options.contexts.map((entry) => [entry.id, entry]));
  const branchById = new Map(options.branches.map((entry) => [entry.id, entry]));

  const rows = ALL_DAY_PERIODS.map((period) => {
    if (period === LUNCH_PERIOD) {
      return {
        period,
        kind: "lunch" as const,
        label: "🍴 Pause de midi",
        cells: classColumns.map((column) => ({ classId: column.id, entries: [] })),
      };
    }
    const cells = classColumns.map((column) => {
      const entries = applicable
        .filter((slot) => {
          const course = courseById.get(slot.annualCourseId);
          return course?.classId === column.id && slot.periodStart <= period && period <= slot.periodEnd;
        })
        .map((slot) => {
          const course = courseById.get(slot.annualCourseId)!;
          const context = contextById.get(course.contextId);
          const branch = context ? branchById.get(context.branchId) : undefined;
          return {
            slotId: slot.id,
            annualCourseId: slot.annualCourseId,
            branchLabel: branch?.label ?? "Branche",
            weekKind: slot.weekKind,
            weekKindLabel: COURSE_WEEK_KIND_LABELS[slot.weekKind],
          };
        });
      return { classId: column.id, entries };
    });
    return { period, kind: "course" as const, label: formatPeriodRange(period, period), cells };
  });

  return {
    dayOfWeek: options.dayOfWeek,
    dayLabel: COURSE_WEEKDAY_LABELS[options.dayOfWeek],
    weekKind: options.weekKind,
    classColumns: classColumns.map((entry) => ({ classId: entry.id, classCode: entry.code })),
    rows,
  };
}

export interface AttendanceWeekDayPreview {
  dayOfWeek: CourseWeekday;
  dayLabel: string;
  role: AttendanceRole | null;
  roleLabel: string | null;
  blocks: ClassScheduleBlock[];
  empty: boolean;
}

export interface AttendanceWeekPreview {
  weekKind: Exclude<CourseWeekKind, "all">;
  days: AttendanceWeekDayPreview[];
}

export function buildAttendanceWeekPreview(options: {
  days: ClassAttendanceDay[];
  slots: CourseScheduleSlot[];
  weekKind: Exclude<CourseWeekKind, "all">;
  courses?: Array<Pick<AnnualCourse, "id" | "isArchived">>;
  yearStatus?: string | null;
}): AttendanceWeekPreview {
  const slots =
    options.courses
      ? filterSlotsForScheduleView({
          slots: options.slots,
          courses: options.courses,
          yearStatus: options.yearStatus,
        })
      : options.slots;
  const attendance = attendanceDaysForWeek(options.days, options.weekKind);
  const applicable = slots.filter((slot) => slotAppliesToWeekView(slot, options.weekKind));
  const sourceDays =
    options.days.length > 0
      ? attendance.map((day) => ({
          dayOfWeek: day.dayOfWeek,
          role: day.role,
          roleLabel: day.role === "PRIMARY" ? "jour principal" : "jour complémentaire",
        }))
      : usedWeekdays(applicable).map((dayOfWeek) => ({
          dayOfWeek,
          role: null,
          roleLabel: null,
        }));
  return {
    weekKind: options.weekKind,
    days: sourceDays.map((day) => {
      const blocks = buildClassDayBlocks(
        applicable.filter((slot) => slot.dayOfWeek === day.dayOfWeek),
        day.dayOfWeek,
      );
      return {
        dayOfWeek: day.dayOfWeek,
        dayLabel: COURSE_WEEKDAY_LABELS[day.dayOfWeek],
        role: day.role,
        roleLabel: day.roleLabel,
        blocks,
        empty: !blocks.some((block) => block.kind === "course"),
      };
    }),
  };
}
