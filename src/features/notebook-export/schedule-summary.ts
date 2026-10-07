import { COURSE_WEEKDAY_LABELS, type CourseScheduleSlot } from "../course-schedule/types.ts";
import { formatCourseSessionPeriods } from "../course-sessions/format.ts";

function rhythmLabel(weekKind: CourseScheduleSlot["weekKind"]): string {
  if (weekKind === "all") return "toutes les semaines";
  if (weekKind === "A") return "semaines A";
  return "semaines B";
}

export function formatCourseScheduleSummary(slots: readonly CourseScheduleSlot[]): string {
  const lines = slots
    .slice()
    .sort(
      (left, right) =>
        left.dayOfWeek - right.dayOfWeek ||
        left.periodStart - right.periodStart ||
        left.weekKind.localeCompare(right.weekKind),
    )
    .map((slot) => {
      const periods = formatCourseSessionPeriods([
        { periodStart: slot.periodStart, periodEnd: slot.periodEnd },
      ]);
      return [COURSE_WEEKDAY_LABELS[slot.dayOfWeek], rhythmLabel(slot.weekKind), periods].filter(Boolean).join(" · ");
    });
  return [...new Set(lines)].join(" ; ") || "Horaire non renseigné";
}
