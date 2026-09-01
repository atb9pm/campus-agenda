import type { PrototypeAgendaItem } from "../agenda/demo-items.ts";
import type { CourseDaySlot } from "../calendar/types.ts";
import type { Subject } from "../../types/classroom.ts";

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

export function groupItemsBySubject(
  items: PrototypeAgendaItem[],
  subjects: Subject[],
): SubjectAgendaGroup[] {
  const subjectById = new Map(subjects.map((subject) => [subject.id, subject]));
  const grouped = new Map<string, PrototypeAgendaItem[]>();

  for (const item of items) {
    if (!subjectById.has(item.subjectId)) {
      subjectById.set(item.subjectId, {
        id: item.subjectId,
        classroomId: item.classroomId,
        name: item.subjectId,
      });
    }
    const bucket = grouped.get(item.subjectId) ?? [];
    bucket.push(item);
    grouped.set(item.subjectId, bucket);
  }

  const ordered = [...subjects];
  for (const subject of subjectById.values()) {
    if (!ordered.some((entry) => entry.id === subject.id)) ordered.push(subject);
  }

  return ordered
    .map((subject) => ({
      subject,
      items: grouped.get(subject.id) ?? [],
    }))
    .filter((group) => group.items.length > 0);
}
