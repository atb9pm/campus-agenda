import type { PrototypeAgendaItem } from "../agenda/demo-items.ts";
import { displayBranchLabel } from "../agenda-bridge/branch-label.ts";
import type { ClassroomCatalog } from "../classes/queries.ts";
import type { CourseDaySlot, SchoolWeek } from "../calendar/types.ts";
import { formatSchoolWeekOptionLabel } from "../calendar/course-days.ts";
import {
  calendarDateKey,
  calendarDaysBetween,
  listFutureTestsForClass,
  type UpcomingTestEntry,
} from "../evaluations/coordination.ts";
import type { Subject } from "../../types/classroom.ts";
import { groupItemsBySubject, type SubjectAgendaGroup } from "./course-day-view.ts";

export type ControlUrgency = "later" | "week" | "tomorrow" | "today";

export interface NextControlHeadline {
  urgency: ControlUrgency;
  kicker: string;
  dateLabel: string | null;
  warn: boolean;
}

export interface StudentCourseDaySection {
  subject: Subject;
  nextControls: UpcomingTestEntry[];
  publications: PrototypeAgendaItem[];
}

export interface ControlPlanningDay {
  dateKey: string;
  slot: CourseDaySlot;
  entries: UpcomingTestEntry[];
}

export interface ControlPlanningWeek {
  weekLabel: string;
  schoolWeekNumber: number;
  weekKind: SchoolWeek["kind"];
  days: ControlPlanningDay[];
}

const PUBLICATION_RANK: Record<PrototypeAgendaItem["type"], number> = {
  HOMEWORK: 0,
  INFORMATION: 1,
  TEST: 2,
};

export function compareStudentPublications(
  left: PrototypeAgendaItem,
  right: PrototypeAgendaItem,
): number {
  return PUBLICATION_RANK[left.type] - PUBLICATION_RANK[right.type];
}

export function nextControlsForSubject(
  futureTests: UpcomingTestEntry[],
  subjectId: string,
): UpcomingTestEntry[] {
  const forSubject = futureTests.filter((entry) => entry.item.subjectId === subjectId);
  if (!forSubject.length) return [];
  const nextDate = calendarDateKey(forSubject[0]!.slot.date);
  return forSubject.filter((entry) => calendarDateKey(entry.slot.date) === nextDate);
}

export function formatNextControlHeadline(
  daysUntil: number,
  dateLabel: string,
  count: number,
): NextControlHeadline {
  const plural = count > 1 ? "CONTRÔLES" : "CONTRÔLE";
  if (daysUntil <= 0) {
    return { urgency: "today", kicker: `${plural} AUJOURD’HUI`, dateLabel: null, warn: false };
  }
  if (daysUntil === 1) {
    return { urgency: "tomorrow", kicker: `⚠ ${plural} DEMAIN`, dateLabel: null, warn: true };
  }
  if (daysUntil <= 7) {
    return {
      urgency: "week",
      kicker: `⚠ ${plural} DANS ${daysUntil} JOURS`,
      dateLabel,
      warn: true,
    };
  }
  return { urgency: "later", kicker: `${plural} · ${dateLabel}`, dateLabel: null, warn: false };
}

export function nextControlHeadlineForEntries(
  entries: UpcomingTestEntry[],
  today: Date,
  dateLabel: string,
): NextControlHeadline | null {
  if (!entries.length) return null;
  return formatNextControlHeadline(
    calendarDaysBetween(today, entries[0]!.slot.date),
    dateLabel,
    entries.length,
  );
}

function sortPublications(items: PrototypeAgendaItem[]): PrototypeAgendaItem[] {
  return items.filter((item) => item.type !== "TEST").slice().sort(compareStudentPublications);
}

function subjectFromControls(
  subjectId: string,
  subjects: Subject[],
  controls: UpcomingTestEntry[],
): Subject {
  const listed = subjects.find((subject) => subject.id === subjectId);
  const fallbackName = displayBranchLabel(controls[0]?.subjectName);
  if (listed) {
    return { ...listed, name: displayBranchLabel(listed.name) || fallbackName };
  }
  return {
    id: subjectId,
    classroomId: controls[0]?.item.classroomId ?? "",
    name: fallbackName,
  };
}

export function buildStudentCourseDaySections(
  dayItems: PrototypeAgendaItem[],
  subjects: Subject[],
  futureTests: UpcomingTestEntry[],
  options: { includeNextControls?: boolean } = {},
): StudentCourseDaySection[] {
  const includeNextControls = options.includeNextControls !== false;
  const publications = sortPublications(dayItems);
  const groups: SubjectAgendaGroup[] = groupItemsBySubject(publications, subjects);
  const nextBySubject = new Map<string, UpcomingTestEntry[]>();

  if (includeNextControls) {
    for (const entry of futureTests) {
      const subjectId = entry.item.subjectId;
      if (nextBySubject.has(subjectId)) continue;
      const next = nextControlsForSubject(futureTests, subjectId);
      if (next.length) nextBySubject.set(subjectId, next);
    }
  }

  const sections = new Map<string, StudentCourseDaySection>();
  for (const group of groups) {
    sections.set(group.subject.id, {
      subject: group.subject,
      nextControls: includeNextControls ? nextBySubject.get(group.subject.id) ?? [] : [],
      publications: group.items.slice().sort(compareStudentPublications),
    });
  }

  if (includeNextControls) {
    for (const [subjectId, controls] of nextBySubject) {
      if (sections.has(subjectId)) continue;
      sections.set(subjectId, {
        subject: subjectFromControls(subjectId, subjects, controls),
        nextControls: controls,
        publications: [],
      });
    }
  }

  const orderedIds: string[] = [];
  for (const subject of subjects) {
    if (sections.has(subject.id)) orderedIds.push(subject.id);
  }
  for (const id of sections.keys()) {
    if (!orderedIds.includes(id)) orderedIds.push(id);
  }

  return orderedIds
    .map((id) => sections.get(id)!)
    .filter((section) => section.publications.length > 0 || section.nextControls.length > 0);
}

export const STUDENT_CONTROL_PREVIEW_LIMIT = 3;

export function previewUpcomingControls(
  futureTests: UpcomingTestEntry[],
  limit = STUDENT_CONTROL_PREVIEW_LIMIT,
): UpcomingTestEntry[] {
  return futureTests.slice(0, limit);
}

export function studentTodoSections(sections: StudentCourseDaySection[]): StudentCourseDaySection[] {
  return sections
    .map((section) => ({
      ...section,
      nextControls: [] as UpcomingTestEntry[],
      publications: section.publications.filter((item) => item.type !== "TEST"),
    }))
    .filter((section) => section.publications.length > 0);
}

export function studentHomeworkOnlySections(
  sections: StudentCourseDaySection[],
): StudentCourseDaySection[] {
  return sections
    .map((section) => ({
      ...section,
      nextControls: [] as UpcomingTestEntry[],
      publications: section.publications.filter((item) => item.type === "HOMEWORK"),
    }))
    .filter((section) => section.publications.length > 0);
}

export function formatCompactControlDate(date: Date): string {
  const day = new Intl.DateTimeFormat("fr-CH", { day: "numeric" }).format(date);
  const month = new Intl.DateTimeFormat("fr-CH", { month: "short" })
    .format(date)
    .replace(".", "")
    .trim()
    .toUpperCase();
  return `${day} ${month}`;
}

export function controlAgendaDateParts(date: Date): { day: string; month: string } {
  const day = new Intl.DateTimeFormat("fr-CH", { day: "numeric" }).format(date);
  const month = new Intl.DateTimeFormat("fr-CH", { month: "short" })
    .format(date)
    .replace(".", "")
    .trim()
    .toLowerCase();
  return { day, month };
}

export function planningDayParts(date: Date): { dayNumber: string; weekday: string } {
  const dayNumber = new Intl.DateTimeFormat("fr-CH", { day: "numeric" }).format(date);
  const weekday = new Intl.DateTimeFormat("fr-CH", { weekday: "short" })
    .format(date)
    .replace(".", "")
    .trim()
    .toUpperCase();
  return { dayNumber, weekday };
}

/** Présentation compacte du compteur — mêmes seuils que formatNextControlHeadline. */
export function compactControlPresentation(
  daysUntil: number,
  date: Date,
): { urgency: ControlUrgency; badge: string; warn: boolean } {
  if (daysUntil <= 0) {
    return { urgency: "today", badge: "AUJOURD’HUI", warn: false };
  }
  if (daysUntil === 1) {
    return { urgency: "tomorrow", badge: "DEMAIN", warn: true };
  }
  if (daysUntil <= 7) {
    return { urgency: "week", badge: `J-${daysUntil}`, warn: true };
  }
  return { urgency: "later", badge: formatCompactControlDate(date), warn: false };
}

export function groupControlPlanning(futureTests: UpcomingTestEntry[]): ControlPlanningWeek[] {
  const weeks: ControlPlanningWeek[] = [];

  for (const entry of futureTests) {
    const dateKey = calendarDateKey(entry.slot.date);
    const weekKey = `${entry.slot.schoolWeekNumber}-${entry.slot.weekKind ?? ""}`;
    let week = weeks.find(
      (item) => `${item.schoolWeekNumber}-${item.weekKind ?? ""}` === weekKey,
    );
    if (!week) {
      week = {
        weekLabel: formatSchoolWeekOptionLabel({
          number: entry.slot.schoolWeekNumber,
          kind: entry.slot.weekKind,
        }),
        schoolWeekNumber: entry.slot.schoolWeekNumber,
        weekKind: entry.slot.weekKind,
        days: [],
      };
      weeks.push(week);
    }
    let day = week.days.find((item) => item.dateKey === dateKey);
    if (!day) {
      day = { dateKey, slot: entry.slot, entries: [] };
      week.days.push(day);
    }
    day.entries.push(entry);
  }

  return weeks;
}

export function listStudentControlPlanning(
  items: PrototypeAgendaItem[],
  catalog: ClassroomCatalog,
  classroomId: string,
  fromDate: Date,
  weeks: SchoolWeek[],
): ControlPlanningWeek[] {
  return groupControlPlanning(listFutureTestsForClass(items, catalog, classroomId, fromDate, weeks));
}
