import { isTeachablePeriod, rangeCrossesLunch } from "./periods.ts";
import {
  COURSE_WEEK_KINDS,
  type CourseScheduleSlotInput,
  type CourseWeekKind,
  type CourseWeekday,
  type ScheduleMutationResult,
} from "./types.ts";

export function isCourseWeekday(value: unknown): value is CourseWeekday {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5;
}

export function isCourseWeekKind(value: unknown): value is CourseWeekKind {
  return (COURSE_WEEK_KINDS as readonly string[]).includes(String(value));
}

export function validateCourseScheduleSlotInput(
  input: CourseScheduleSlotInput,
): ScheduleMutationResult<CourseScheduleSlotInput> {
  if (!input.annualCourseId.trim()) {
    return { ok: false, reason: "Le cours annuel est obligatoire.", status: 400 };
  }
  if (!isCourseWeekday(input.dayOfWeek)) {
    return { ok: false, reason: "Le jour doit être un jour de cours (lundi à vendredi).", status: 400 };
  }
  if (!isTeachablePeriod(input.periodStart) || !isTeachablePeriod(input.periodEnd)) {
    return {
      ok: false,
      reason: "La période 5 est la pause de midi et ne peut pas recevoir de cours. Périodes utilisables : 1–4 et 6–10.",
      status: 400,
      code: "LUNCH_PERIOD",
    };
  }
  if (input.periodEnd < input.periodStart) {
    return { ok: false, reason: "La période de fin doit être supérieure ou égale à la période de début.", status: 400 };
  }
  if (rangeCrossesLunch(input.periodStart, input.periodEnd)) {
    return {
      ok: false,
      reason: "Un créneau ne peut pas traverser la pause de midi. Utilisez deux créneaux distincts (ex. P4 puis P6).",
      status: 400,
      code: "CROSSES_LUNCH",
    };
  }
  if (!(COURSE_WEEK_KINDS as readonly string[]).includes(input.weekKind)) {
    return { ok: false, reason: "Le rythme doit être Toutes les semaines, Semaine A ou Semaine B.", status: 400 };
  }
  return { ok: true, value: input };
}
