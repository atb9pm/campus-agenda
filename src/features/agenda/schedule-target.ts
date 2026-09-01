import type { SchoolWeekEntry } from "../school-year/types.ts";
import type { ClassAttendanceDay, CourseScheduleSlot } from "../course-schedule/types.ts";
import {
  attendanceCoversAgendaDay,
  isoWeekdayFromAgendaDayIndex,
  scheduleSlotAllowsAgendaDay,
} from "../calendar/attendance-course-days.ts";

export type AgendaScheduleTargetResult =
  | { ok: true; week: SchoolWeekEntry; source: "structured" | "legacy-tma" }
  | { ok: false; reason: string };

/**
 * LEGACY ADAPTER — ancien modèle TMA (lundi toutes les semaines, jeudi en B).
 * Utilisé uniquement lorsqu'aucun ClassAttendanceDay / CourseScheduleSlot
 * structuré ne peut être résolu pour la publication.
 */
export function legacyTmaPublicationDayAllowed(weekKind: "A" | "B", dayIndex: number): boolean {
  if (dayIndex === 0) return true;
  return weekKind === "B" && dayIndex === 3;
}

/**
 * Validation commune POST/PATCH : la semaine doit exister dans l'année scolaire
 * et le jour doit correspondre à un créneau réel (structured) ou au fallback TMA.
 *
 * `resolvedStructuredCourse` : un AnnualCourse fiable a été identifié.
 * Dans ce cas le fallback TMA est interdit, même sans CourseScheduleSlot.
 */
export function validateAgendaScheduleTarget(options: {
  schoolWeekNumber: number;
  dayIndex: number;
  weeks: SchoolWeekEntry[];
  attendanceDays?: Array<Pick<ClassAttendanceDay, "dayOfWeek" | "weekKind" | "role">> | null;
  slots?: CourseScheduleSlot[] | null;
  resolvedStructuredCourse?: boolean;
}): AgendaScheduleTargetResult {
  if (!Number.isInteger(options.schoolWeekNumber)) {
    return { ok: false, reason: "Semaine scolaire invalide." };
  }
  const week = options.weeks.find((entry) => entry.number === options.schoolWeekNumber);
  if (!week) {
    return { ok: false, reason: "Cette semaine n'existe pas dans l'année scolaire." };
  }
  if (isoWeekdayFromAgendaDayIndex(options.dayIndex) === null) {
    return { ok: false, reason: "Jour de cours invalide." };
  }

  const hasAttendance = Boolean(options.attendanceDays && options.attendanceDays.length > 0);
  const slots = options.slots ?? [];
  const hasCompatibleSlot = scheduleSlotAllowsAgendaDay(slots, week.kind, options.dayIndex);

  if (options.resolvedStructuredCourse) {
    if (hasAttendance && !attendanceCoversAgendaDay(options.attendanceDays!, week.kind, options.dayIndex)) {
      return { ok: false, reason: "La classe n'est pas présente ce jour-là." };
    }
    if (!hasCompatibleSlot) {
      return { ok: false, reason: "Aucun créneau d'horaire pour cette branche ce jour-là." };
    }
    return { ok: true, week, source: "structured" };
  }

  if (hasAttendance || slots.length > 0) {
    if (hasAttendance && !attendanceCoversAgendaDay(options.attendanceDays!, week.kind, options.dayIndex)) {
      return { ok: false, reason: "La classe n'est pas présente ce jour-là." };
    }
    if (slots.length > 0 && !hasCompatibleSlot) {
      return { ok: false, reason: "Aucun créneau d'horaire pour cette branche ce jour-là." };
    }
    return { ok: true, week, source: "structured" };
  }

  if (!legacyTmaPublicationDayAllowed(week.kind, options.dayIndex)) {
    return { ok: false, reason: "Jour de cours invalide." };
  }
  return { ok: true, week, source: "legacy-tma" };
}
