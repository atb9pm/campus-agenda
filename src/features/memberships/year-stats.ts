import type { PrototypeAgendaItem } from "../agenda/demo-items.ts";
import type { AgendaItemType } from "../../types/agenda.ts";
import { AGENDA_ITEM_TYPES } from "../../types/agenda.ts";

export interface SubjectYearCount {
  subjectId: string;
  count: number;
}

export interface WeekTestCount {
  schoolWeekNumber: number;
  count: number;
}

export interface ClassYearStats {
  classroomId: string;
  schoolYearId: string;
  totalItems: number;
  byType: Record<AgendaItemType, number>;
  bySubject: SubjectYearCount[];
  testsByWeek: WeekTestCount[];
}

export function computeClassYearStats(
  items: PrototypeAgendaItem[],
  classroomId: string,
  schoolYearId: string,
): ClassYearStats {
  const scoped = items.filter(
    (item) => item.classroomId === classroomId && item.schoolYearId === schoolYearId,
  );

  const byType = Object.fromEntries(AGENDA_ITEM_TYPES.map((type) => [type, 0])) as Record<AgendaItemType, number>;
  const subjectCounts = new Map<string, number>();
  const testWeekCounts = new Map<number, number>();

  for (const item of scoped) {
    byType[item.type] += 1;
    subjectCounts.set(item.subjectId, (subjectCounts.get(item.subjectId) ?? 0) + 1);
    if (item.type === "TEST") {
      testWeekCounts.set(item.schoolWeekNumber, (testWeekCounts.get(item.schoolWeekNumber) ?? 0) + 1);
    }
  }

  return {
    classroomId,
    schoolYearId,
    totalItems: scoped.length,
    byType,
    bySubject: [...subjectCounts.entries()]
      .map(([subjectId, count]) => ({ subjectId, count }))
      .sort((left, right) => right.count - left.count),
    testsByWeek: [...testWeekCounts.entries()]
      .map(([schoolWeekNumber, count]) => ({ schoolWeekNumber, count }))
      .sort((left, right) => left.schoolWeekNumber - right.schoolWeekNumber),
  };
}
