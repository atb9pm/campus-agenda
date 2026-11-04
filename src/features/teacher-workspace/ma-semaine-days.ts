import type { SchoolWeekKind } from "../calendar/types.ts";
import type { TeacherClassSetup, WeekdayIndex } from "../teacher-setup/types.ts";
import { WEEKDAY_LABELS } from "../teacher-setup/types.ts";
import type {
  TeacherCourseMeetingDay,
  TeacherCourseScheduleSlotView,
  TeacherCourseWorkspaceEntry,
} from "./types.ts";

export interface MaSemainePlacedCourse extends TeacherCourseWorkspaceEntry {
  /**
   * `A` ou `B` quand le créneau est en alternance.
   * `null` : toutes les semaines, ou placement sans créneau.
   */
  weekSuffix: "A" | "B" | null;
}

export interface MaSemaineDayClass {
  setup: TeacherClassSetup;
  courses: MaSemainePlacedCourse[];
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

export function maSemaineBranchBadgeLabel(
  branchLabel: string,
  weekSuffix: "A" | "B" | null | undefined,
): string {
  return weekSuffix === "A" || weekSuffix === "B" ? `${branchLabel}-${weekSuffix}` : branchLabel;
}

function applicableOfficialDays(
  days: readonly TeacherCourseMeetingDay[],
  selectedWeekKind: SchoolWeekKind | null,
): WeekdayIndex[] {
  const unique = new Set<WeekdayIndex>();
  for (const day of days) {
    if (!meetingDayAppliesToWeek(day.weekKind, selectedWeekKind)) continue;
    unique.add(day.dayOfWeek);
  }
  return [...unique].sort((left, right) => left - right);
}

function isWeekday(value: number): value is WeekdayIndex {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5;
}

/**
 * Un créneau `all` couvre les deux rythmes : un seul badge, sans suffixe.
 * Sinon un badge par rythme présent (A puis B), quelle que soit la semaine consultée.
 * Plusieurs périodes le même jour et le même rythme ne produisent qu’un badge.
 */
function placementsFromScheduleSlots(
  slots: readonly TeacherCourseScheduleSlotView[],
): MaSemainePlacement[] {
  const byDay = new Map<WeekdayIndex, Set<TeacherCourseScheduleSlotView["weekKind"]>>();
  for (const slot of slots) {
    if (!isWeekday(slot.dayOfWeek)) continue;
    if (slot.weekKind !== "all" && slot.weekKind !== "A" && slot.weekKind !== "B") continue;
    const kinds = byDay.get(slot.dayOfWeek) ?? new Set();
    kinds.add(slot.weekKind);
    byDay.set(slot.dayOfWeek, kinds);
  }
  const placements: MaSemainePlacement[] = [];
  for (const dayOfWeek of [1, 2, 3, 4, 5] as const) {
    const kinds = byDay.get(dayOfWeek);
    if (!kinds?.size) continue;
    if (kinds.has("all")) {
      placements.push({ dayOfWeek, weekSuffix: null });
      continue;
    }
    if (kinds.has("A")) placements.push({ dayOfWeek, weekSuffix: "A" });
    if (kinds.has("B")) placements.push({ dayOfWeek, weekSuffix: "B" });
  }
  return placements;
}

interface MaSemainePlacement {
  dayOfWeek: WeekdayIndex;
  weekSuffix: "A" | "B" | null;
}

function placementsFromDays(days: readonly WeekdayIndex[]): MaSemainePlacement[] {
  return days.map((dayOfWeek) => ({ dayOfWeek, weekSuffix: null }));
}

/**
 * Hiérarchie « Ma semaine » :
 * 1. AnnualCourseMeetingDay s’il en existe au moins un (y compris si aucun n’est
 *    applicable à la semaine consultée → cours absent, pas de repli).
 * 2. Sinon créneaux d’horaire : A et B restent visibles ensemble, avec suffixe.
 * 3. Sinon ClassAttendanceDay de la classe (règle A/B de la semaine consultée).
 * 4. Sinon préférence personnelle `fallbackDay`.
 */
function placementsForCourse(
  meetingDays: readonly TeacherCourseMeetingDay[] | undefined,
  scheduleSlots: readonly TeacherCourseScheduleSlotView[] | undefined,
  classAttendanceDays: readonly TeacherCourseMeetingDay[] | undefined,
  fallbackDay: WeekdayIndex,
  selectedWeekKind: SchoolWeekKind | null,
): MaSemainePlacement[] {
  if (meetingDays?.length) return placementsFromDays(applicableOfficialDays(meetingDays, selectedWeekKind));
  if (scheduleSlots?.length) return placementsFromScheduleSlots(scheduleSlots);
  if (classAttendanceDays?.length) {
    return placementsFromDays(applicableOfficialDays(classAttendanceDays, selectedWeekKind));
  }
  return [{ dayOfWeek: fallbackDay, weekSuffix: null }];
}

/**
 * Jours d’affichage hors créneaux (MeetingDay, puis présence de classe, puis préférence).
 * Les créneaux sont appliqués par `groupMaSemaineByMeetingDays`.
 */
export function officialDisplayDaysForCourse(
  meetingDays: readonly TeacherCourseMeetingDay[] | undefined,
  classAttendanceDays: readonly TeacherCourseMeetingDay[] | undefined,
  fallbackDay: WeekdayIndex,
  selectedWeekKind: SchoolWeekKind | null,
): WeekdayIndex[] {
  return placementsForCourse(meetingDays, undefined, classAttendanceDays, fallbackDay, selectedWeekKind).map(
    (placement) => placement.dayOfWeek,
  );
}

/**
 * « Ma semaine » : MeetingDay de cours, sinon créneau d’horaire,
 * sinon AttendanceDay de classe, sinon préférence d’affichage (setup.dayOfWeek).
 */
export function groupMaSemaineByMeetingDays(
  setups: readonly TeacherClassSetup[],
  courses: readonly TeacherCourseWorkspaceEntry[],
  selectedWeekKind: SchoolWeekKind | null,
): MaSemaineDayGroup[] {
  const setupByClassId = new Map(setups.map((setup) => [setup.id, setup]));
  const coursesByDayAndClass = new Map<WeekdayIndex, Map<string, MaSemainePlacedCourse[]>>();

  for (const course of courses) {
    const setup = setupByClassId.get(course.classId);
    const fallbackDay = setup?.dayOfWeek ?? 1;
    const placements = placementsForCourse(
      course.meetingDays,
      course.scheduleSlots,
      course.classAttendanceDays,
      fallbackDay,
      selectedWeekKind,
    );
    for (const placement of placements) {
      const byClass = coursesByDayAndClass.get(placement.dayOfWeek) ?? new Map();
      const list = byClass.get(course.classId) ?? [];
      list.push({ ...course, weekSuffix: placement.weekSuffix });
      byClass.set(course.classId, list);
      coursesByDayAndClass.set(placement.dayOfWeek, byClass);
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
