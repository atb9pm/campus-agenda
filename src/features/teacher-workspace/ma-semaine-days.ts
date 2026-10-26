import type { SchoolWeekKind } from "../calendar/types.ts";
import type { TeacherClassSetup, WeekdayIndex } from "../teacher-setup/types.ts";
import { WEEKDAY_LABELS } from "../teacher-setup/types.ts";
import type { TeacherCourseMeetingDay, TeacherCourseWorkspaceEntry } from "./types.ts";

export interface MaSemaineDayClass {
  setup: TeacherClassSetup;
  courses: TeacherCourseWorkspaceEntry[];
}

export interface MaSemaineDayGroup {
  dayOfWeek: WeekdayIndex;
  label: string;
  classes: MaSemaineDayClass[];
}

export function meetingDayAppliesToWeek(
  weekKind: CourseWeekKindOfDay,
  selectedWeekKind: SchoolWeekKind | null,
): boolean {
  if (weekKind === "all") return true;
  if (selectedWeekKind == null) return true;
  return weekKind === selectedWeekKind;
}

type CourseWeekKindOfDay = TeacherCourseMeetingDay["weekKind"];

/** Jours officiels applicables à la semaine consultée. Tableau vide = cours absent cette semaine. */
export function officialDisplayDaysForCourse(
  meetingDays: readonly TeacherCourseMeetingDay[] | undefined,
  fallbackDay: WeekdayIndex,
  selectedWeekKind: SchoolWeekKind | null,
): WeekdayIndex[] {
  if (!meetingDays?.length) return [fallbackDay];
  const days = new Set<WeekdayIndex>();
  for (const day of meetingDays) {
    if (!meetingDayAppliesToWeek(day.weekKind, selectedWeekKind)) continue;
    days.add(day.dayOfWeek);
  }
  return [...days].sort((left, right) => left - right);
}

/**
 * « Ma semaine » : un cours va sous ses AnnualCourseMeetingDay.
 * Sans plan officiel, la préférence d’affichage (setup.dayOfWeek) reste le repli.
 */
export function groupMaSemaineByMeetingDays(
  setups: readonly TeacherClassSetup[],
  courses: readonly TeacherCourseWorkspaceEntry[],
  selectedWeekKind: SchoolWeekKind | null,
): MaSemaineDayGroup[] {
  const setupByClassId = new Map(setups.map((setup) => [setup.id, setup]));
  const coursesByDayAndClass = new Map<WeekdayIndex, Map<string, TeacherCourseWorkspaceEntry[]>>();

  for (const course of courses) {
    const setup = setupByClassId.get(course.classId);
    const fallbackDay = setup?.dayOfWeek ?? 1;
    const days = officialDisplayDaysForCourse(course.meetingDays, fallbackDay, selectedWeekKind);
    for (const dayOfWeek of days) {
      const byClass = coursesByDayAndClass.get(dayOfWeek) ?? new Map();
      const list = byClass.get(course.classId) ?? [];
      list.push(course);
      byClass.set(course.classId, list);
      coursesByDayAndClass.set(dayOfWeek, byClass);
    }
  }

  return ([1, 2, 3, 4, 5] as const)
    .filter((dayOfWeek) => (coursesByDayAndClass.get(dayOfWeek)?.size ?? 0) > 0)
    .map((dayOfWeek) => {
      const byClass = coursesByDayAndClass.get(dayOfWeek)!;
      const classes: MaSemaineDayClass[] = [];
      for (const setup of setups) {
        const dayCourses = byClass.get(setup.id);
        if (!dayCourses?.length) continue;
        classes.push({ setup, courses: dayCourses });
      }
      return {
        dayOfWeek,
        label: WEEKDAY_LABELS[dayOfWeek],
        classes,
      };
    })
    .filter((group) => group.classes.length > 0);
}
