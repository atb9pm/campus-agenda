import type { AnnualCourse } from "../annual-courses/types.ts";
import { attendanceDaysForWeek } from "./class-attendance.ts";
import { LUNCH_PERIOD } from "./periods.ts";
import { buildClassDayBlocks, type ClassScheduleBlock } from "./preview.ts";
import {
  COURSE_WEEKDAY_LABELS,
  COURSE_WEEK_KIND_LONG_LABELS,
  type AttendanceRole,
  type ClassAttendanceDay,
  type CourseScheduleSlot,
  type CourseWeekKind,
  type CourseWeekday,
} from "./types.ts";

export type AttendanceCoverage = "all" | "A" | "B" | "A+B";

/** Ordre d’affichage du rythme d’un jour complémentaire : A, B, puis Toutes. */
export const ADDITIONAL_RHYTHM_CHOICES = ["A", "B", "all"] as const satisfies readonly CourseWeekKind[];

export interface RhythmSummaryDay {
  dayOfWeek: CourseWeekday;
  dayLabel: string;
}

export interface AttendanceRhythmSummary {
  weekA: RhythmSummaryDay[];
  weekB: RhythmSummaryDay[];
  weekALine: string;
  weekBLine: string;
}

export interface ScheduleTemplateDay {
  dayOfWeek: CourseWeekday;
  dayLabel: string;
  role: AttendanceRole | null;
  coverage: AttendanceCoverage;
  coverageLabel: string;
  roleLabel: string | null;
  blocks: ClassScheduleBlock[];
}

export interface ClassScheduleTemplate {
  days: ScheduleTemplateDay[];
}

export interface GroupedAnnualCourseSlots<TCourse extends Pick<AnnualCourse, "id">> {
  course: TCourse;
  slots: CourseScheduleSlot[];
}

/**
 * Un AnnualCourse peut posséder plusieurs CourseScheduleSlot le même jour.
 * Ces slots représentent des segments horaires.
 * Ils ne doivent pas être assimilés automatiquement à des séances pédagogiques distinctes.
 */
export function groupSlotsByAnnualCourse<TCourse extends Pick<AnnualCourse, "id">>(
  courses: TCourse[],
  slots: CourseScheduleSlot[],
): Array<GroupedAnnualCourseSlots<TCourse>> {
  return courses.map((course) => ({
    course,
    slots: slots
      .filter((slot) => slot.annualCourseId === course.id)
      .sort((left, right) => left.dayOfWeek - right.dayOfWeek || left.periodStart - right.periodStart),
  }));
}

export function attendanceCoverageForDay(
  days: Array<Pick<ClassAttendanceDay, "weekKind">>,
): AttendanceCoverage {
  const kinds = new Set(days.map((day) => day.weekKind));
  if (kinds.has("all")) return "all";
  if (kinds.has("A") && kinds.has("B")) return "A+B";
  if (kinds.has("A")) return "A";
  return "B";
}

export function coverageLabel(coverage: AttendanceCoverage): string {
  if (coverage === "all") return "Toutes les semaines";
  if (coverage === "A+B") return "Semaines A et B";
  if (coverage === "A") return "Semaine A";
  return "Semaine B";
}

export function formatRhythmSummaryLine(days: RhythmSummaryDay[]): string {
  if (days.length === 0) return "—";
  return days.map((day) => day.dayLabel).join(" + ");
}

export function buildAttendanceRhythmSummary(
  days: Array<Pick<ClassAttendanceDay, "dayOfWeek" | "weekKind" | "role">>,
): AttendanceRhythmSummary {
  const asDays = days.map((day, index) => ({
    id: `tmp-${index}`,
    classId: "",
    dayOfWeek: day.dayOfWeek,
    weekKind: day.weekKind,
    role: day.role ?? "ADDITIONAL",
    createdAt: "",
    updatedAt: "",
  })) as ClassAttendanceDay[];
  const toSummary = (week: "A" | "B"): RhythmSummaryDay[] =>
    attendanceDaysForWeek(asDays, week).map((day) => ({
      dayOfWeek: day.dayOfWeek,
      dayLabel: COURSE_WEEKDAY_LABELS[day.dayOfWeek],
    }));
  const weekA = toSummary("A");
  const weekB = toSummary("B");
  return {
    weekA,
    weekB,
    weekALine: formatRhythmSummaryLine(weekA),
    weekBLine: formatRhythmSummaryLine(weekB),
  };
}

/** P5 uniquement s’il y a un cours le matin ET l’après-midi. */
export function compactLunchBlocks(blocks: ClassScheduleBlock[]): ClassScheduleBlock[] {
  const hasMorning = blocks.some((block) => block.kind === "course" && block.periodStart <= 4);
  const hasAfternoon = blocks.some((block) => block.kind === "course" && block.periodEnd >= 6);
  if (hasMorning && hasAfternoon) return blocks;
  return blocks.filter((block) => block.kind !== "lunch");
}

export function formatTemplatePeriod(start: number, end: number): string {
  if (start === LUNCH_PERIOD && end === LUNCH_PERIOD) return "P5";
  if (start === end) return `P${start}`;
  return `P${start}–P${end}`;
}

export function formatSlotRhythmLabel(slot: Pick<CourseScheduleSlot, "dayOfWeek" | "weekKind">): string {
  return `${COURSE_WEEKDAY_LABELS[slot.dayOfWeek]} · ${COURSE_WEEK_KIND_LONG_LABELS[slot.weekKind]}`;
}

export function slotRoleBadge(
  slot: Pick<CourseScheduleSlot, "dayOfWeek">,
  days: Array<Pick<ClassAttendanceDay, "dayOfWeek" | "role">>,
): "principal" | "complémentaire" | null {
  if (days.length === 0) return null;
  const onDay = days.filter((day) => day.dayOfWeek === slot.dayOfWeek);
  if (onDay.length === 0) return null;
  return onDay.some((day) => day.role === "PRIMARY") ? "principal" : "complémentaire";
}

export function formatAttendancePresenceDetail(
  day: Pick<ClassAttendanceDay, "role" | "weekKind">,
): string {
  if (day.role === "PRIMARY" || day.weekKind === "all") return "A + B · Toutes les semaines";
  if (day.weekKind === "A") return "A uniquement";
  return "B uniquement";
}

export function formatAttendanceCoverageDetail(coverage: AttendanceCoverage, role: AttendanceRole | null): string {
  if (role === "PRIMARY" || coverage === "all") return "A + B · Toutes les semaines";
  if (coverage === "A+B") return "A et B";
  if (coverage === "A") return "A uniquement";
  return "B uniquement";
}

/**
 * Trame réelle : un jour calendaire une seule fois, avec sa couverture all/A/B/A+B.
 * N’invente aucune donnée. P5 compactée (uniquement si matin + après-midi).
 */
export function buildClassScheduleTemplate(options: {
  days: ClassAttendanceDay[];
  slots: CourseScheduleSlot[];
}): ClassScheduleTemplate {
  if (options.days.length === 0) {
    const byDay = new Map<CourseWeekday, CourseScheduleSlot[]>();
    for (const slot of options.slots) {
      const list = byDay.get(slot.dayOfWeek) ?? [];
      list.push(slot);
      byDay.set(slot.dayOfWeek, list);
    }
    const days = ([1, 2, 3, 4, 5] as const).filter((day) => byDay.has(day));
    return {
      days: days.map((dayOfWeek) => {
        const daySlots = byDay.get(dayOfWeek) ?? [];
        const coverage = attendanceCoverageForDay(daySlots);
        return {
          dayOfWeek,
          dayLabel: COURSE_WEEKDAY_LABELS[dayOfWeek],
          role: null,
          coverage,
          coverageLabel: coverageLabel(coverage),
          roleLabel: null,
          blocks: compactLunchBlocks(buildClassDayBlocks(daySlots, dayOfWeek)),
        };
      }),
    };
  }

  const byDay = new Map<CourseWeekday, ClassAttendanceDay[]>();
  for (const day of options.days) {
    const list = byDay.get(day.dayOfWeek) ?? [];
    list.push(day);
    byDay.set(day.dayOfWeek, list);
  }
  const ordered = [...byDay.entries()].sort(([left], [right]) => left - right);
  return {
    days: ordered.map(([dayOfWeek, attendance]) => {
      const coverage = attendanceCoverageForDay(attendance);
      const role = attendance.some((day) => day.role === "PRIMARY") ? "PRIMARY" : "ADDITIONAL";
      const daySlots = options.slots.filter((slot) => slot.dayOfWeek === dayOfWeek);
      return {
        dayOfWeek,
        dayLabel: COURSE_WEEKDAY_LABELS[dayOfWeek],
        role,
        coverage,
        coverageLabel: coverageLabel(coverage),
        roleLabel: role === "PRIMARY" ? "Jour principal" : "Jour complémentaire",
        blocks: compactLunchBlocks(buildClassDayBlocks(daySlots, dayOfWeek)),
      };
    }),
  };
}

export function nextAdditionalDraftDay(
  primaryDay: CourseWeekday | "",
  additional: Array<{ dayOfWeek: CourseWeekday }>,
): { dayOfWeek: CourseWeekday; weekKind: "" } {
  const used = new Set<CourseWeekday>([
    ...(primaryDay ? [primaryDay] : []),
    ...additional.map((entry) => entry.dayOfWeek),
  ]);
  const free = ([1, 2, 3, 4, 5] as const).find((day) => !used.has(day));
  return { dayOfWeek: free ?? 4, weekKind: "" };
}

export function attendanceDraftIsComplete(draft: {
  primaryDay: CourseWeekday | "";
  additional: Array<{ weekKind: CourseWeekKind | "" }>;
}): boolean {
  if (!draft.primaryDay) return false;
  return draft.additional.every((entry) => entry.weekKind !== "");
}

export function attendanceInputsFromDraft(draft: {
  primaryDay: CourseWeekday | "";
  additional: Array<{ dayOfWeek: CourseWeekday; weekKind: CourseWeekKind | "" }>;
}): Array<{ dayOfWeek: CourseWeekday; weekKind: CourseWeekKind; role: AttendanceRole }> {
  if (!draft.primaryDay) return [];
  return [
    { dayOfWeek: draft.primaryDay, weekKind: "all", role: "PRIMARY" },
    ...draft.additional
      .filter((entry): entry is { dayOfWeek: CourseWeekday; weekKind: CourseWeekKind } => entry.weekKind !== "")
      .map((entry) => ({
        dayOfWeek: entry.dayOfWeek,
        weekKind: entry.weekKind,
        role: "ADDITIONAL" as const,
      })),
  ];
}
