import type { PrototypeAgendaItem } from "../agenda/demo-items.ts";
import type { ClassroomCatalog } from "../classes/queries.ts";
import { getSubjectById, getTeacherById } from "../classes/queries.ts";
import type { CourseDaySlot, SchoolWeek } from "../calendar/types.ts";
import { getCourseDaysForWeek } from "../calendar/course-days.ts";

export const TEST_ALERT_THRESHOLD = 3;
export const STUDENT_UPCOMING_TESTS_LIMIT = 8;
export const CONTROL_COORDINATION_CONFIRM_CODE = "CONTROL_COORDINATION_CONFIRM_REQUIRED";
export const CONTROL_COORDINATION_CONFIRM_REASON =
  "Deux contrôles sont déjà prévus dans cette classe ce jour-là. Confirmez pour publier malgré tout.";

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

export interface ControlCoordinationEntry {
  agendaItemId: number;
  title: string;
  branchLabel: string;
  teacherName: string;
  classroomId: string;
  classroomName: string;
  schoolWeekNumber: number;
  dayIndex: number;
  date: string | null;
}

export interface ControlCoordinationSummary {
  classDayControls: ControlCoordinationEntry[];
  classDayCount: number;
  teacherWeekControls: ControlCoordinationEntry[];
  teacherWeekCount: number;
  confirmationRequired: boolean;
}

export interface ControlCoordinationCatalog {
  classrooms: Array<{ id: string; name: string }>;
  subjects: Array<{ id: string; name: string }>;
  teachers: Array<{ id: string; displayName: string; initials?: string }>;
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

  const triggered = input.type === "TEST" && confirmationRequiredForExistingTests(existing.length);

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

/** Alerte au 3e contrôle : 2 existants déjà publiés. */
export function confirmationRequiredForExistingTests(existingTestCount: number): boolean {
  return existingTestCount >= TEST_ALERT_THRESHOLD - 1;
}

function lookupCatalogName(
  entries: Array<{ id: string; name?: string; displayName?: string }>,
  id: string,
  fallback: string,
): string {
  const match = entries.find((entry) => entry.id === id);
  if (!match) return fallback;
  if (match.displayName?.trim()) return match.displayName.trim();
  return match.name?.trim() || fallback;
}

function toCoordinationEntry(
  item: PrototypeAgendaItem,
  catalog: ControlCoordinationCatalog,
  date: string | null = null,
): ControlCoordinationEntry {
  return {
    agendaItemId: item.id,
    title: item.title.trim() || "Contrôle",
    branchLabel: lookupCatalogName(catalog.subjects, item.subjectId, "Branche"),
    teacherName: lookupCatalogName(catalog.teachers, item.authorTeacherId, "Enseignant"),
    classroomId: item.classroomId,
    classroomName: lookupCatalogName(catalog.classrooms, item.classroomId, "Classe"),
    schoolWeekNumber: item.schoolWeekNumber,
    dayIndex: item.day,
    date,
  };
}

function itemMatchesSchoolYear(
  item: Pick<PrototypeAgendaItem, "schoolYearId">,
  schoolYearId: string,
  includeUnscopedYearItems: boolean,
): boolean {
  const scoped = item.schoolYearId?.trim() || null;
  if (scoped === schoolYearId) return true;
  return includeUnscopedYearItems && scoped === null;
}

/**
 * Politique unique de coordination des TEST.
 * HOMEWORK / INFORMATION : jamais de confirmation.
 * confirmationRequired = au moins 2 contrôles déjà publiés pour la classe ce jour-là.
 */
export function evaluateControlCoordination(options: {
  type: PrototypeAgendaItem["type"];
  items: PrototypeAgendaItem[];
  classroomId: string;
  courseDay: CourseDayRef;
  teacherId: string;
  teacherWeekClassroomIds: readonly string[];
  schoolYearId: string;
  includeUnscopedYearItems: boolean;
  catalog: ControlCoordinationCatalog;
}): ControlCoordinationSummary {
  const empty: ControlCoordinationSummary = {
    classDayControls: [],
    classDayCount: 0,
    teacherWeekControls: [],
    teacherWeekCount: 0,
    confirmationRequired: false,
  };
  if (options.type !== "TEST") return empty;

  const yearFiltered = options.items.filter((item) =>
    itemMatchesSchoolYear(item, options.schoolYearId, options.includeUnscopedYearItems),
  );

  const classDayItems = listTestsOnCourseDay(yearFiltered, options.classroomId, options.courseDay);
  const weekClassrooms = new Set(options.teacherWeekClassroomIds);
  const teacherWeekItems = yearFiltered
    .filter(
      (item) =>
        item.type === "TEST" &&
        item.authorTeacherId === options.teacherId &&
        weekClassrooms.has(item.classroomId) &&
        item.schoolWeekNumber === options.courseDay.schoolWeekNumber,
    )
    .slice()
    .sort(
      (left, right) =>
        left.day - right.day ||
        left.classroomId.localeCompare(right.classroomId) ||
        left.id - right.id,
    );

  return {
    classDayControls: classDayItems.map((item) => toCoordinationEntry(item, options.catalog)),
    classDayCount: classDayItems.length,
    teacherWeekControls: teacherWeekItems.map((item) => toCoordinationEntry(item, options.catalog)),
    teacherWeekCount: teacherWeekItems.length,
    confirmationRequired: confirmationRequiredForExistingTests(classDayItems.length),
  };
}

export function gateControlCoordination(
  coordination: ControlCoordinationSummary,
  confirmCoordination: boolean,
): { ok: true } | { ok: false; code: typeof CONTROL_COORDINATION_CONFIRM_CODE; reason: string } {
  if (coordination.confirmationRequired && confirmCoordination !== true) {
    return {
      ok: false,
      code: CONTROL_COORDINATION_CONFIRM_CODE,
      reason: CONTROL_COORDINATION_CONFIRM_REASON,
    };
  }
  return { ok: true };
}

function slotTimestamp(slot: CourseDaySlot): number {
  return slot.date.getTime();
}

function slotFromWeekAndDay(week: SchoolWeek, dayIndex: number): CourseDaySlot {
  const date = new Date(week.monday);
  date.setDate(date.getDate() + dayIndex);
  return {
    schoolWeekNumber: week.number,
    weekKind: week.kind,
    date,
    dayIndex,
  };
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
  const entries: UpcomingTestEntry[] = [];

  for (const item of items) {
    if (item.classroomId !== classroomId || item.type !== "TEST") continue;
    const week = weeks.find((entry) => entry.number === item.schoolWeekNumber);
    if (!week || !Number.isInteger(item.day) || item.day < 0 || item.day > 4) continue;
    const slot = slotFromWeekAndDay(week, item.day);
    if (slotTimestamp(slot) < fromTime) continue;

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
