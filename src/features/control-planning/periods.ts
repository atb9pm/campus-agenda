import type { SchoolWeekEntry } from "../school-year/types.ts";
import type { ControlPlanningPeriod, ControlPlanningPeriodId } from "./period-types.ts";

/** Projection visuelle uniquement : pas de persistence, pas de champ SchoolYear.semester. */
export function splitControlPlanningPeriods(weeks: readonly SchoolWeekEntry[]): ControlPlanningPeriod[] {
  const ordered = [...weeks].sort(
    (left, right) => left.monday.localeCompare(right.monday) || left.number - right.number,
  );
  if (ordered.length === 0) {
    return [
      { id: "semester-1", label: "Semestre 1", weeks: [] },
      { id: "semester-2", label: "Semestre 2", weeks: [] },
    ];
  }
  const firstCount = Math.ceil(ordered.length / 2);
  return [
    { id: "semester-1", label: "Semestre 1", weeks: ordered.slice(0, firstCount) },
    { id: "semester-2", label: "Semestre 2", weeks: ordered.slice(firstCount) },
  ];
}

export function resolveControlPlanningPeriodId(options: {
  weeks: readonly SchoolWeekEntry[];
  yearStatus: "active" | "archived";
  todayIso: string;
  requested?: string | null;
}): ControlPlanningPeriodId {
  const periods = splitControlPlanningPeriods(options.weeks);
  if (options.requested === "semester-1" || options.requested === "semester-2") {
    return options.requested;
  }
  if (options.yearStatus === "archived") return "semester-1";
  const second = periods.find((entry) => entry.id === "semester-2");
  if (!second || second.weeks.length === 0) return "semester-1";
  const current = options.weeks.find((week) => {
    const friday = addDaysIso(week.monday, 4);
    return friday != null && options.todayIso >= week.monday && options.todayIso <= friday;
  });
  if (current && second.weeks.some((week) => week.number === current.number)) {
    return "semester-2";
  }
  return "semester-1";
}

function addDaysIso(monday: string, days: number): string | null {
  const [year, month, day] = monday.split("-").map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day, 12);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
