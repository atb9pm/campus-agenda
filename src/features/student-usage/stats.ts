import { addIsoDays, isoDatesFrom } from "./time.ts";

export const STUDENT_USAGE_PERIODS = [7, 30, 90] as const;
export type StudentUsagePeriod = (typeof STUDENT_USAGE_PERIODS)[number];

/** Fenêtre lue pour comparer la période la plus longue à la précédente. */
export const STUDENT_USAGE_LOOKBACK_DAYS = 180;

export const STUDENT_USAGE_RETENTION_MONTHS = 24;

export const STUDENT_USAGE_DISCLAIMER =
  "Ces statistiques représentent des consultations quotidiennes estimées par navigateur. Elles ne permettent pas d’identifier les élèves ni de déterminer leur nombre exact.";

export interface StudentUsageDayCount {
  date: string;
  schoolYearId: string;
  schoolClassId: string;
  count: number;
}

export interface StudentUsageClassInfo {
  id: string;
  code: string;
  isArchived: boolean;
  schoolYearLabel: string | null;
}

export interface StudentUsageSeriesPoint {
  date: string;
  count: number;
}

export interface StudentUsageClassRow {
  schoolClassId: string;
  label: string;
  archived: boolean;
  count: number;
}

export interface StudentUsageDashboard {
  today: string;
  period: StudentUsagePeriod;
  schoolClassId: string | null;
  cards: {
    today: number;
    last7: number;
    average: number;
    activeClasses: number;
  };
  series: StudentUsageSeriesPoint[];
  comparison: {
    current: number;
    previous: number;
    /** Absent quand la période précédente est à zéro : un pourcentage n'aurait pas de sens. */
    percent: number | null;
  };
  classes: StudentUsageClassRow[];
  /** Classes ayant au moins une consultation dans la fenêtre de lecture, pour le filtre. */
  classOptions: StudentUsageClassRow[];
  retentionMonths: number;
  disclaimer: string;
}

export function isStudentUsagePeriod(value: unknown): value is StudentUsagePeriod {
  return value === 7 || value === 30 || value === 90;
}

export function usageWindow(todayIso: string, days: number): { start: string; end: string } {
  return { start: addIsoDays(todayIso, -(days - 1)), end: todayIso };
}

/** Premier jour exclu : les compteurs plus anciens que 24 mois civils. */
export function studentUsageRetentionCutoff(todayIso: string): string {
  const [year, month, day] = todayIso.split("-").map(Number);
  const utc = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1 - STUDENT_USAGE_RETENTION_MONTHS, day ?? 1));
  return utc.toISOString().slice(0, 10);
}

function sumInWindow(
  rows: readonly StudentUsageDayCount[],
  start: string,
  end: string,
  schoolClassId: string | null,
): number {
  let total = 0;
  for (const row of rows) {
    if (row.date < start || row.date > end) continue;
    if (schoolClassId && row.schoolClassId !== schoolClassId) continue;
    total += row.count;
  }
  return total;
}

export function studentUsageClassLabel(info: StudentUsageClassInfo | undefined, duplicateCode: boolean): string {
  if (!info) return "Classe retirée";
  const year = duplicateCode && info.schoolYearLabel ? ` · ${info.schoolYearLabel}` : "";
  return `${info.code}${year}`;
}

export function buildStudentUsageDashboard(input: {
  rows: readonly StudentUsageDayCount[];
  today: string;
  period: StudentUsagePeriod;
  schoolClassId: string | null;
  classes: readonly StudentUsageClassInfo[];
}): StudentUsageDashboard {
  const periodWindow = usageWindow(input.today, input.period);
  const previousWindow = usageWindow(addIsoDays(periodWindow.start, -1), input.period);
  const filter = input.schoolClassId;
  const last7 = usageWindow(input.today, 7);

  const current = sumInWindow(input.rows, periodWindow.start, periodWindow.end, filter);
  const previous = sumInWindow(input.rows, previousWindow.start, previousWindow.end, filter);
  const percent = previous > 0 ? Math.round(((current - previous) / previous) * 1000) / 10 : null;

  const byDate = new Map<string, number>();
  const periodClassCounts = new Map<string, number>();
  const optionClassIds = new Set<string>();
  const active = new Set<string>();
  for (const row of input.rows) {
    if (row.date >= previousWindow.start && row.date <= input.today) optionClassIds.add(row.schoolClassId);
    if (row.date < periodWindow.start || row.date > periodWindow.end) continue;
    if (filter && row.schoolClassId !== filter) continue;
    byDate.set(row.date, (byDate.get(row.date) ?? 0) + row.count);
    periodClassCounts.set(row.schoolClassId, (periodClassCounts.get(row.schoolClassId) ?? 0) + row.count);
    if (row.count > 0) active.add(row.schoolClassId);
  }

  const classById = new Map(input.classes.map((entry) => [entry.id, entry]));
  const codeCounts = new Map<string, number>();
  for (const id of optionClassIds) {
    const code = classById.get(id)?.code;
    if (code) codeCounts.set(code, (codeCounts.get(code) ?? 0) + 1);
  }
  const labelFor = (schoolClassId: string) => {
    const info = classById.get(schoolClassId);
    const duplicate = info ? (codeCounts.get(info.code) ?? 0) > 1 : false;
    return studentUsageClassLabel(info, duplicate);
  };

  const toRow = (schoolClassId: string, count: number): StudentUsageClassRow => ({
    schoolClassId,
    label: labelFor(schoolClassId),
    archived: classById.get(schoolClassId)?.isArchived ?? false,
    count,
  });

  const classes = [...periodClassCounts.entries()]
    .filter(([, count]) => count > 0)
    .map(([schoolClassId, count]) => toRow(schoolClassId, count))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, "fr"));

  const classOptions = [...optionClassIds]
    .map((schoolClassId) => toRow(schoolClassId, periodClassCounts.get(schoolClassId) ?? 0))
    .sort((left, right) => left.label.localeCompare(right.label, "fr"));

  return {
    today: input.today,
    period: input.period,
    schoolClassId: filter,
    cards: {
      today: sumInWindow(input.rows, input.today, input.today, filter),
      last7: sumInWindow(input.rows, last7.start, last7.end, filter),
      average: Math.round((current / input.period) * 10) / 10,
      activeClasses: active.size,
    },
    series: isoDatesFrom(periodWindow.start, periodWindow.end).map((date) => ({
      date,
      count: byDate.get(date) ?? 0,
    })),
    comparison: { current, previous, percent },
    classes,
    classOptions,
    retentionMonths: STUDENT_USAGE_RETENTION_MONTHS,
    disclaimer: STUDENT_USAGE_DISCLAIMER,
  };
}
