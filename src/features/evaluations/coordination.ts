import type { PrototypeAgendaItem } from "../agenda/demo-items.ts";
import type { ClassroomCatalog } from "../classes/queries.ts";
import { getSubjectById, getTeacherById } from "../classes/queries.ts";
import type { CourseDaySlot, SchoolWeek } from "../calendar/types.ts";
import { getCourseDaysForWeek, listAllCourseDays } from "../calendar/course-days.ts";

export const TEST_ALERT_THRESHOLD = 3;
export const STUDENT_UPCOMING_TESTS_LIMIT = 8;

export interface CourseDayRef {
  schoolWeekNumber: number;
  dayIndex: number;
}

export interface ExistingTestSummary {
  id: number;
  title: string;
  subjectName: string;
  teacherName: string;
}

export interface UpcomingTestEntry {
  item: PrototypeAgendaItem;
  slot: CourseDaySlot;
  subjectName: string;
  teacherName: string;
}

export interface ThirdTestAlert {
  triggered: boolean;
  existingTests: ExistingTestSummary[];
  courseDay: CourseDayRef;
}

export function matchesCourseDay(
  item: PrototypeAgendaItem,
  courseDay: CourseDayRef,
): boolean {
  return item.schoolWeekNumber === courseDay.schoolWeekNumber && item.day === courseDay.dayIndex;
}

export function listTestsOnCourseDay(
  items: PrototypeAgendaItem[],
  classroomId: string,
  courseDay: CourseDayRef,
  excludeItemId?: number,
): PrototypeAgendaItem[] {
  return items.filter(
    (item) =>
      item.classroomId === classroomId
      && item.type === "TEST"
      && matchesCourseDay(item, courseDay)
      && item.id !== excludeItemId,
  );
}

export function evaluateThirdTestAlert(
  items: PrototypeAgendaItem[],
  catalog: ClassroomCatalog,
  input: {
    classroomId: string;
    type: PrototypeAgendaItem["type"];
    courseDay: CourseDayRef;
    excludeItemId?: number;
  },
): ThirdTestAlert {
  const existing = listTestsOnCourseDay(
    items,
    input.classroomId,
    input.courseDay,
    input.excludeItemId,
  );

  const triggered = input.type === "TEST" && existing.length >= TEST_ALERT_THRESHOLD - 1;

  return {
    triggered,
    courseDay: input.courseDay,
    existingTests: existing.map((item) => ({
      id: item.id,
      title: item.title,
      subjectName: getSubjectById(catalog, item.subjectId)?.name ?? "Branche",
      teacherName: getTeacherById(catalog, item.authorTeacherId)?.displayName ?? "Enseignant",
    })),
  };
}

function slotTimestamp(slot: CourseDaySlot): number {
  return slot.date.getTime();
}

export function listUpcomingTestsForClass(
  items: PrototypeAgendaItem[],
  catalog: ClassroomCatalog,
  classroomId: string,
  fromSlot: CourseDaySlot,
  weeks: SchoolWeek[],
  limit = STUDENT_UPCOMING_TESTS_LIMIT,
): UpcomingTestEntry[] {
  const fromTime = slotTimestamp(fromSlot);
  const courseDays = listAllCourseDays(weeks);
  const slotByKey = new Map(
    courseDays.map((slot) => [`${slot.schoolWeekNumber}-${slot.dayIndex}`, slot] as const),
  );

  const entries: UpcomingTestEntry[] = [];

  for (const item of items) {
    if (item.classroomId !== classroomId || item.type !== "TEST") continue;
    const slot = slotByKey.get(`${item.schoolWeekNumber}-${item.day}`);
    if (!slot || slotTimestamp(slot) < fromTime) continue;

    entries.push({
      item,
      slot,
      subjectName: getSubjectById(catalog, item.subjectId)?.name ?? "Branche",
      teacherName: getTeacherById(catalog, item.authorTeacherId)?.displayName ?? "Enseignant",
    });
  }

  return entries
    .sort((left, right) => slotTimestamp(left.slot) - slotTimestamp(right.slot) || left.item.id - right.item.id)
    .slice(0, limit);
}

export function listUpcomingTestsForTeacher(
  items: PrototypeAgendaItem[],
  catalog: ClassroomCatalog,
  teacherId: string,
  fromDate: Date,
  weeks: SchoolWeek[],
): UpcomingTestEntry[] {
  const fromTime = fromDate.getTime();
  const entries: UpcomingTestEntry[] = [];

  for (const week of weeks) {
    for (const slot of getCourseDaysForWeek(week)) {
      if (slotTimestamp(slot) < fromTime) continue;

      for (const item of items) {
        if (item.authorTeacherId !== teacherId || item.type !== "TEST") continue;
        if (!matchesCourseDay(item, { schoolWeekNumber: slot.schoolWeekNumber, dayIndex: slot.dayIndex })) {
          continue;
        }

        entries.push({
          item,
          slot,
          subjectName: getSubjectById(catalog, item.subjectId)?.name ?? "Branche",
          teacherName: getTeacherById(catalog, item.authorTeacherId)?.displayName ?? "Enseignant",
        });
      }
    }
  }

  return entries.sort(
    (left, right) => slotTimestamp(left.slot) - slotTimestamp(right.slot) || left.item.id - right.item.id,
  );
}

export function listClassTestsForSchoolWeek(
  items: PrototypeAgendaItem[],
  catalog: ClassroomCatalog,
  classroomId: string,
  schoolWeekNumber: number,
  weeks: SchoolWeek[],
): UpcomingTestEntry[] {
  const week = weeks.find((entry) => entry.number === schoolWeekNumber) ?? weeks[0];
  if (!week) return [];

  const entries: UpcomingTestEntry[] = [];

  for (const slot of getCourseDaysForWeek(week)) {
    for (const item of listTestsOnCourseDay(items, classroomId, {
      schoolWeekNumber: slot.schoolWeekNumber,
      dayIndex: slot.dayIndex,
    })) {
      entries.push({
        item,
        slot,
        subjectName: getSubjectById(catalog, item.subjectId)?.name ?? "Branche",
        teacherName: getTeacherById(catalog, item.authorTeacherId)?.displayName ?? "Enseignant",
      });
    }
  }

  return entries.sort(
    (left, right) => left.slot.dayIndex - right.slot.dayIndex || left.item.title.localeCompare(right.item.title, "fr"),
  );
}

export function courseDaysWithMultipleTests(
  items: PrototypeAgendaItem[],
  classroomId: string,
  schoolWeekNumber: number,
): CourseDayRef[] {
  const counts = new Map<string, number>();

  for (const item of items) {
    if (item.classroomId !== classroomId || item.type !== "TEST" || item.schoolWeekNumber !== schoolWeekNumber) {
      continue;
    }
    const key = `${item.schoolWeekNumber}-${item.day}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .map(([key]) => {
      const [schoolWeekNumber, dayIndex] = key.split("-").map(Number);
      return { schoolWeekNumber, dayIndex };
    });
}
