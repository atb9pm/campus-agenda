import type { AgendaItemType } from "../../types/agenda.ts";
import type { ClassroomCatalog } from "../classes/queries.ts";
import { getSubjectById, getTeacherById } from "../classes/queries.ts";
import type { PrototypeAgendaItem } from "./demo-items.ts";

export const ALL_FILTER = "ALL" as const;

export interface SharedAgendaFilters {
  subjectName: string | typeof ALL_FILTER;
  type: AgendaItemType | typeof ALL_FILTER;
  teacherId: string | typeof ALL_FILTER;
  day: number | typeof ALL_FILTER;
  weekOffset: number;
  schoolWeekNumber?: number;
}

export function createDefaultSharedAgendaFilters(weekOffset = 0): SharedAgendaFilters {
  return {
    subjectName: ALL_FILTER,
    type: ALL_FILTER,
    teacherId: ALL_FILTER,
    day: ALL_FILTER,
    weekOffset,
  };
}

export function filterItemsForDisplayedWeek(
  items: PrototypeAgendaItem[],
  weekOffset: number,
): PrototypeAgendaItem[] {
  return items.filter((item) => (item.weekOffset ?? 0) === weekOffset);
}

export function filterItemsForSchoolWeek(
  items: PrototypeAgendaItem[],
  schoolWeekNumber: number,
): PrototypeAgendaItem[] {
  return items.filter((item) => item.schoolWeekNumber === schoolWeekNumber);
}

export function applySharedAgendaFilters(
  items: PrototypeAgendaItem[],
  catalog: ClassroomCatalog,
  filters: SharedAgendaFilters,
): PrototypeAgendaItem[] {
  const weekFiltered = filters.schoolWeekNumber !== undefined
    ? filterItemsForSchoolWeek(items, filters.schoolWeekNumber)
    : filterItemsForDisplayedWeek(items, filters.weekOffset);
  return weekFiltered.filter((item) => {
    if (filters.type !== ALL_FILTER && item.type !== filters.type) return false;
    if (filters.teacherId !== ALL_FILTER && item.authorTeacherId !== filters.teacherId) return false;
    if (filters.day !== ALL_FILTER && item.day !== filters.day) return false;
    if (filters.subjectName !== ALL_FILTER) {
      const subject = getSubjectById(catalog, item.subjectId);
      if (subject?.name !== filters.subjectName) return false;
    }
    return true;
  });
}

export interface WorkloadDayBreakdown {
  day: number;
  total: number;
  homework: number;
  test: number;
  information: number;
}

export interface WorkloadSubjectBreakdown {
  subjectId: string;
  subjectName: string;
  count: number;
}

export interface WorkloadTeacherBreakdown {
  teacherId: string;
  teacherName: string;
  count: number;
}

export type WorkloadLevel = "light" | "moderate" | "heavy";

export interface ClassWorkloadSummary {
  total: number;
  homework: number;
  test: number;
  information: number;
  level: WorkloadLevel;
  byDay: WorkloadDayBreakdown[];
  bySubject: WorkloadSubjectBreakdown[];
  byTeacher: WorkloadTeacherBreakdown[];
}

function resolveWorkloadLevel(total: number): WorkloadLevel {
  if (total <= 2) return "light";
  if (total <= 5) return "moderate";
  return "heavy";
}

export function buildClassWorkloadSummary(
  items: PrototypeAgendaItem[],
  catalog: ClassroomCatalog,
  classroomId: string,
  schoolWeekNumber: number,
): ClassWorkloadSummary {
  const classroomItems = filterItemsForSchoolWeek(
    items.filter((item) => item.classroomId === classroomId),
    schoolWeekNumber,
  );

  const byDay: WorkloadDayBreakdown[] = Array.from({ length: 5 }, (_, day) => ({
    day,
    total: 0,
    homework: 0,
    test: 0,
    information: 0,
  }));

  const subjectCounts = new Map<string, number>();
  const teacherCounts = new Map<string, number>();

  let homework = 0;
  let test = 0;
  let information = 0;

  for (const item of classroomItems) {
    const dayBucket = byDay[item.day];
    if (!dayBucket) continue;

    dayBucket.total += 1;
    if (item.type === "HOMEWORK") {
      dayBucket.homework += 1;
      homework += 1;
    } else if (item.type === "TEST") {
      dayBucket.test += 1;
      test += 1;
    } else {
      dayBucket.information += 1;
      information += 1;
    }

    subjectCounts.set(item.subjectId, (subjectCounts.get(item.subjectId) ?? 0) + 1);
    teacherCounts.set(item.authorTeacherId, (teacherCounts.get(item.authorTeacherId) ?? 0) + 1);
  }

  const bySubject = [...subjectCounts.entries()]
    .map(([subjectId, count]) => ({
      subjectId,
      subjectName: getSubjectById(catalog, subjectId)?.name ?? "Branche",
      count,
    }))
    .sort((left, right) => right.count - left.count || left.subjectName.localeCompare(right.subjectName, "fr"));

  const byTeacher = [...teacherCounts.entries()]
    .map(([teacherId, count]) => ({
      teacherId,
      teacherName: getTeacherById(catalog, teacherId)?.displayName ?? "Enseignant · démo",
      count,
    }))
    .sort((left, right) => right.count - left.count || left.teacherName.localeCompare(right.teacherName, "fr"));

  const total = classroomItems.length;

  return {
    total,
    homework,
    test,
    information,
    level: resolveWorkloadLevel(total),
    byDay,
    bySubject,
    byTeacher,
  };
}

export const WORKLOAD_LEVEL_LABELS: Record<WorkloadLevel, string> = {
  light: "Semaine légère",
  moderate: "Charge modérée",
  heavy: "Semaine dense",
};
