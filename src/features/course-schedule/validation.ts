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

const ISO_CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoCalendarDate(value: string): boolean {
  const match = ISO_CALENDAR_DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day, 12);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function parseSlotValidityDate(
  value: string | null | undefined,
  fieldLabel: string,
): ScheduleMutationResult<string | null> {
  if (value == null || value.trim() === "") return { ok: true, value: null };
  const trimmed = value.trim();
  if (!isIsoCalendarDate(trimmed)) {
    return { ok: false, reason: `${fieldLabel} doit être au format AAAA-MM-JJ.`, status: 400 };
  }
  return { ok: true, value: trimmed };
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
  const validFrom = parseSlotValidityDate(input.validFrom, "La date de début de validité");
  if (!validFrom.ok) return validFrom;
  const validTo = parseSlotValidityDate(input.validTo, "La date de fin de validité");
  if (!validTo.ok) return validTo;
  if (validFrom.value && validTo.value && validFrom.value > validTo.value) {
    return {
      ok: false,
      reason: "La date de début de validité doit être antérieure ou égale à la date de fin.",
      status: 400,
    };
  }
  return { ok: true, value: { ...input, validFrom: validFrom.value, validTo: validTo.value } };
}
