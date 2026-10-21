import type { PrototypeAgendaItem } from "../agenda/demo-items.ts";
import type { CourseDaySlot } from "../calendar/types.ts";
import type { Subject } from "../../types/classroom.ts";
import { displayBranchLabel } from "../agenda-bridge/branch-label.ts";
import {
  orderByDaySchedule,
  type StudentDayScheduleSlot,
} from "./course-day-order.ts";

export interface SubjectAgendaGroup {
  subject: Subject;
  items: PrototypeAgendaItem[];
}

export function filterItemsForCourseDay(
  items: PrototypeAgendaItem[],
  slot: CourseDaySlot,
): PrototypeAgendaItem[] {
  return items.filter(
    (item) => item.day === slot.dayIndex && item.schoolWeekNumber === slot.schoolWeekNumber,
  );
}

function publicationGroupKey(item: PrototypeAgendaItem): string {
  return item.annualCourseId?.trim() || item.subjectId;
}

function subjectForPublicationGroup(
  key: string,
  sample: PrototypeAgendaItem,
  subjects: Subject[],
): Subject {
  const byAnnual = subjects.find((subject) => subject.annualCourseId === key);
  if (byAnnual) return byAnnual;
  const byId = subjects.find((subject) => subject.id === sample.subjectId || subject.id === key);
  if (byId) return byId;
  return {
    id: key,
    classroomId: sample.classroomId,
    name: "",
    annualCourseId: sample.annualCourseId ?? null,
  };
}

export function groupItemsBySubject(
  items: PrototypeAgendaItem[],
  subjects: Subject[],
  options: {
    scheduleSlots?: readonly StudentDayScheduleSlot[];
    courseDay?: CourseDaySlot;
  } = {},
): SubjectAgendaGroup[] {
  const grouped = new Map<string, PrototypeAgendaItem[]>();
  const subjectByKey = new Map<string, Subject>();

  for (const item of items) {
    const key = publicationGroupKey(item);
    if (!subjectByKey.has(key)) {
      subjectByKey.set(key, subjectForPublicationGroup(key, item, subjects));
    }
    const bucket = grouped.get(key) ?? [];
    bucket.push(item);
    grouped.set(key, bucket);
  }

  const orderedKeys: string[] = [];
  for (const subject of subjects) {
    const key = subject.annualCourseId?.trim() || subject.id;
    if (grouped.has(key) && !orderedKeys.includes(key)) orderedKeys.push(key);
    if (grouped.has(subject.id) && !orderedKeys.includes(subject.id)) orderedKeys.push(subject.id);
  }
  for (const key of grouped.keys()) {
    if (!orderedKeys.includes(key)) orderedKeys.push(key);
  }

  const groups = orderedKeys
    .map((key) => {
      const subject = subjectByKey.get(key)!;
      return {
        subject: {
          ...subject,
          name: displayBranchLabel(subject.name),
        },
        items: grouped.get(key) ?? [],
      };
    })
    .filter((group) => group.items.length > 0);

  return orderByDaySchedule(groups, subjects, options.scheduleSlots, options.courseDay);
}
