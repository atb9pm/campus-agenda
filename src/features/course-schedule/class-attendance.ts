import { weekKindsConflict } from "./conflicts.ts";
import { isCourseWeekday } from "./validation.ts";
import {
  ATTENDANCE_ROLES,
  COURSE_WEEKDAY_LABELS,
  COURSE_WEEK_KIND_LABELS,
  COURSE_WEEK_KINDS,
  type AttendanceRole,
  type ClassAttendanceDay,
  type ClassAttendanceDayInput,
  type CourseScheduleSlot,
  type CourseWeekKind,
  type CourseWeekday,
  type ScheduleMutationResult,
} from "./types.ts";

export const ATTENDANCE_NOT_CONFIGURED_CODE = "ATTENDANCE_NOT_CONFIGURED";
export const ATTENDANCE_DAY_MISMATCH_CODE = "ATTENDANCE_DAY_MISMATCH";
export const ATTENDANCE_IN_USE_CODE = "ATTENDANCE_IN_USE";

export const ATTENDANCE_NOT_CONFIGURED_REASON =
  "Configurez d’abord les jours de cours de cette classe.";
export const ATTENDANCE_DAY_MISMATCH_REASON =
  "Ce jour ou ce rythme n’est pas compatible avec les jours de cours de cette classe.";
export const ATTENDANCE_IN_USE_REASON =
  "Le nouveau plan de présence rend certains cours incompatibles. Modifiez d’abord les créneaux concernés.";

/**
 * Un jour de présence est une DISPONIBILITÉ, pas un égal strict de weekKind.
 * all couvre all / A / B.
 * A ne couvre que A.
 * B ne couvre que B.
 * A + B le même jour couvrent également un créneau all.
 */
export function attendanceCoversScheduleSlot(
  days: Array<Pick<ClassAttendanceDay, "dayOfWeek" | "weekKind">>,
  slot: Pick<CourseScheduleSlot, "dayOfWeek" | "weekKind">,
): boolean {
  const onDay = days.filter((day) => day.dayOfWeek === slot.dayOfWeek);
  if (onDay.length === 0) return false;
  if (onDay.some((day) => day.weekKind === "all")) return true;
  if (slot.weekKind === "all") {
    return onDay.some((day) => day.weekKind === "A") && onDay.some((day) => day.weekKind === "B");
  }
  return onDay.some((day) => day.weekKind === slot.weekKind);
}

export function attendanceDaysForWeek(
  days: ClassAttendanceDay[],
  week: Exclude<CourseWeekKind, "all">,
): ClassAttendanceDay[] {
  return days
    .filter((day) => day.weekKind === "all" || day.weekKind === week)
    .sort((left, right) => left.dayOfWeek - right.dayOfWeek || left.role.localeCompare(right.role));
}

export function allowedSlotWeekKinds(
  days: Array<Pick<ClassAttendanceDay, "dayOfWeek" | "weekKind">>,
  dayOfWeek: CourseWeekday,
): CourseWeekKind[] {
  const kinds: CourseWeekKind[] = [];
  for (const kind of COURSE_WEEK_KINDS) {
    if (attendanceCoversScheduleSlot(days, { dayOfWeek, weekKind: kind })) kinds.push(kind);
  }
  return kinds;
}

export function uncoveredScheduleSlots(
  days: Array<Pick<ClassAttendanceDay, "dayOfWeek" | "weekKind">>,
  slots: Array<Pick<CourseScheduleSlot, "id" | "dayOfWeek" | "weekKind">>,
): Array<Pick<CourseScheduleSlot, "id" | "dayOfWeek" | "weekKind">> {
  return slots.filter((slot) => !attendanceCoversScheduleSlot(days, slot));
}

export function isAttendanceRole(value: unknown): value is AttendanceRole {
  return (ATTENDANCE_ROLES as readonly string[]).includes(String(value));
}

export function validateAttendancePlan(
  days: ClassAttendanceDayInput[],
): ScheduleMutationResult<ClassAttendanceDayInput[]> {
  if (days.length === 0) {
    return { ok: false, reason: "Le plan de présence doit contenir un jour principal.", status: 400 };
  }
  const primaries = days.filter((day) => day.role === "PRIMARY");
  if (primaries.length !== 1) {
    return { ok: false, reason: "Une classe doit avoir exactement un jour principal.", status: 400 };
  }
  const primary = primaries[0]!;
  if (primary.weekKind !== "all") {
    return {
      ok: false,
      reason: "Le jour principal doit être présent toutes les semaines.",
      status: 400,
    };
  }
  for (const day of days) {
    if (!isCourseWeekday(day.dayOfWeek)) {
      return { ok: false, reason: "Le jour doit être un jour de cours (lundi à vendredi).", status: 400 };
    }
    if (!(COURSE_WEEK_KINDS as readonly string[]).includes(day.weekKind)) {
      return { ok: false, reason: "Le rythme doit être Toutes les semaines, Semaine A ou Semaine B.", status: 400 };
    }
    if (!isAttendanceRole(day.role)) {
      return { ok: false, reason: "Le rôle doit être principal ou complémentaire.", status: 400 };
    }
  }
  for (let index = 0; index < days.length; index += 1) {
    const left = days[index]!;
    for (let other = index + 1; other < days.length; other += 1) {
      const right = days[other]!;
      if (left.dayOfWeek !== right.dayOfWeek) continue;
      if (left.weekKind === right.weekKind) {
        return { ok: false, reason: "Ce jour et ce rythme sont déjà présents dans le plan.", status: 409 };
      }
      if (weekKindsConflict(left.weekKind, right.weekKind) && (left.weekKind === "all" || right.weekKind === "all")) {
        return {
          ok: false,
          reason: "Un jour « Toutes les semaines » couvre déjà A et B. Retirez le rythme redondant.",
          status: 409,
        };
      }
    }
  }
  return { ok: true, value: days };
}

/**
 * Aide visuelle uniquement : si tous les créneaux existants tombent sur un seul jour,
 * on propose ce jour en PRIMARY / all. Aucune persistence.
 */
export function suggestAttendanceDraftFromSlots(
  slots: Array<Pick<CourseScheduleSlot, "dayOfWeek">>,
): ClassAttendanceDayInput[] | null {
  const days = [...new Set(slots.map((slot) => slot.dayOfWeek))];
  if (days.length !== 1) return null;
  return [{ dayOfWeek: days[0]!, weekKind: "all", role: "PRIMARY" }];
}

export function usedAttendanceWeekdays(
  slots: Array<Pick<CourseScheduleSlot, "dayOfWeek">>,
): CourseWeekday[] {
  const days = new Set<CourseWeekday>();
  for (const slot of slots) days.add(slot.dayOfWeek);
  return ([1, 2, 3, 4, 5] as const).filter((day) => days.has(day));
}

/** Jours présents à la fois en A et en B (simplifiables en « Toutes les semaines », sans blocage). */
export function daysPresentInAAndB(
  days: Array<Pick<ClassAttendanceDay, "dayOfWeek" | "weekKind">>,
): CourseWeekday[] {
  return ([1, 2, 3, 4, 5] as const).filter(
    (dayOfWeek) =>
      days.some((day) => day.dayOfWeek === dayOfWeek && day.weekKind === "A") &&
      days.some((day) => day.dayOfWeek === dayOfWeek && day.weekKind === "B") &&
      !days.some((day) => day.dayOfWeek === dayOfWeek && day.weekKind === "all"),
  );
}

export interface AttendanceSlotDayOption {
  dayOfWeek: CourseWeekday;
  role: AttendanceRole;
  label: string;
  weekKinds: CourseWeekKind[];
}

export function attendanceOptionsForSlotForm(days: ClassAttendanceDay[]): AttendanceSlotDayOption[] {
  const byDay = new Map<CourseWeekday, ClassAttendanceDay[]>();
  for (const day of days) {
    const list = byDay.get(day.dayOfWeek) ?? [];
    list.push(day);
    byDay.set(day.dayOfWeek, list);
  }
  return [...byDay.entries()]
    .sort(([left], [right]) => left - right)
    .map(([dayOfWeek, list]) => {
      const role = list.some((day) => day.role === "PRIMARY") ? "PRIMARY" : "ADDITIONAL";
      const weekKinds = allowedSlotWeekKinds(days, dayOfWeek);
      const extra =
        role === "ADDITIONAL" && weekKinds.length === 1 && weekKinds[0] !== "all"
          ? ` ${weekKinds[0]}`
          : "";
      return {
        dayOfWeek,
        role,
        label:
          role === "PRIMARY"
            ? `${COURSE_WEEKDAY_LABELS[dayOfWeek]} — principal`
            : `${COURSE_WEEKDAY_LABELS[dayOfWeek]} — complémentaire${extra}`,
        weekKinds,
      };
    });
}

export function formatSlotDayBadge(
  slot: Pick<CourseScheduleSlot, "dayOfWeek" | "weekKind">,
  days: ClassAttendanceDay[],
): string {
  const weekday = COURSE_WEEKDAY_LABELS[slot.dayOfWeek];
  const rawWeek = COURSE_WEEK_KIND_LABELS[slot.weekKind];
  const raw = `${weekday} · ${rawWeek}`;
  if (days.length === 0) return raw;
  const onDay = days.filter((day) => day.dayOfWeek === slot.dayOfWeek);
  if (onDay.length === 0) return raw;
  const role = onDay.some((day) => day.role === "PRIMARY")
    ? "PRIMARY"
    : onDay.find((day) => day.weekKind === "all" || day.weekKind === slot.weekKind)?.role;
  if (!role) return raw;
  if (role === "PRIMARY") {
    return slot.weekKind === "all" ? `${weekday} · principal` : `${weekday} · principal · ${slot.weekKind}`;
  }
  if (slot.weekKind === "all") return `${weekday} · complémentaire`;
  return `${weekday} · complémentaire ${slot.weekKind}`;
}
