import type { SchoolWeek } from "../calendar/types.ts";
import type {
  NotebookWeekCountPreference,
  TeacherClassSetup,
  TeacherDisplayPreferences,
  TeacherSetupConfig,
  WeekdayIndex,
} from "./types.ts";
import { DEFAULT_NOTEBOOK_WEEK_COUNT, WEEKDAY_LABELS, WEEKDAY_SHORT_LABELS } from "./types.ts";

export function sortClassesByWeekday(classes: TeacherClassSetup[]): TeacherClassSetup[] {
  return [...classes].sort((left, right) => {
    if (left.dayOfWeek !== right.dayOfWeek) {
      return left.dayOfWeek - right.dayOfWeek;
    }
    return left.name.localeCompare(right.name, "fr-CH");
  });
}

export function groupClassesByWeekday(
  classes: TeacherClassSetup[],
): Array<{ dayOfWeek: WeekdayIndex; label: string; classes: TeacherClassSetup[] }> {
  const sorted = sortClassesByWeekday(classes);
  const groups = new Map<WeekdayIndex, TeacherClassSetup[]>();

  for (const entry of sorted) {
    const bucket = groups.get(entry.dayOfWeek) ?? [];
    bucket.push(entry);
    groups.set(entry.dayOfWeek, bucket);
  }

  return [...groups.entries()].map(([dayOfWeek, dayClasses]) => ({
    dayOfWeek,
    label: WEEKDAY_LABELS[dayOfWeek],
    classes: dayClasses,
  }));
}

export function formatWeekdayLabel(dayOfWeek: WeekdayIndex, short = false): string {
  return short ? WEEKDAY_SHORT_LABELS[dayOfWeek] : WEEKDAY_LABELS[dayOfWeek];
}

export function parseBranchInput(raw: string): string[] {
  return raw
    .split(/[,;\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function formatBranchInput(branchNames: string[]): string {
  return branchNames.join(", ");
}

export function countConfiguredClasses(config: TeacherSetupConfig): number {
  return config.classes.filter((entry) => entry.name.trim()).length;
}

export interface SchoolWeekPlanRow {
  number: number;
  kind: "A" | "B" | null;
  mondayLabel: string;
  courseDaysLabel: string;
}

export function buildSchoolWeekPlanRows(weeks: SchoolWeek[]): SchoolWeekPlanRow[] {
  return weeks.map((week) => {
    const mondayLabel = new Intl.DateTimeFormat("fr-CH", {
      weekday: "short",
      day: "numeric",
      month: "short",
    })
      .format(week.monday)
      .replace(".", "");

    const courseDaysLabel =
      week.kind === "A" ? "Lundi" : week.kind === "B" ? "Lundi + Jeudi" : "Jours de cours";

    return {
      number: week.number,
      kind: week.kind,
      mondayLabel,
      courseDaysLabel,
    };
  });
}

export function normalizeTeacherSetup(config: TeacherSetupConfig): TeacherSetupConfig {
  const display = normalizeDisplayPreferences(config.display);
  return {
    version: 1,
    classes: config.classes.map((entry) => ({
      ...entry,
      name: entry.name.trim(),
      branchNames: entry.branchNames.map((branch) => branch.trim()).filter(Boolean),
      dayOfWeek: clampWeekday(entry.dayOfWeek),
    })),
    ...(display ? { display } : {}),
  };
}

export function clampNotebookWeekCount(value: number): NotebookWeekCountPreference {
  if (!Number.isFinite(value)) return DEFAULT_NOTEBOOK_WEEK_COUNT;
  if (value <= 1) return 1;
  if (value >= 4) return 4;
  return Math.round(value) as NotebookWeekCountPreference;
}

function normalizeDisplayPreferences(raw: unknown): TeacherDisplayPreferences | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const candidate = (raw as { notebookWeekCount?: unknown }).notebookWeekCount;
  if (typeof candidate !== "number") return undefined;
  return { notebookWeekCount: clampNotebookWeekCount(candidate) };
}

export function notebookWeekCountPreference(
  config: TeacherSetupConfig | null | undefined,
): NotebookWeekCountPreference {
  return config?.display?.notebookWeekCount ?? DEFAULT_NOTEBOOK_WEEK_COUNT;
}

export function withNotebookWeekCount(
  config: TeacherSetupConfig,
  count: number,
): TeacherSetupConfig {
  return {
    ...config,
    display: { ...config.display, notebookWeekCount: clampNotebookWeekCount(count) },
  };
}

function clampWeekday(value: number): WeekdayIndex {
  if (value >= 1 && value <= 5) return value as WeekdayIndex;
  return 1;
}
