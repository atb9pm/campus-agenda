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
import {
  groupItemsBySubject,
  subjectForPublicationGroup,
  type SubjectAgendaGroup,
} from "./course-day-view.ts";
import {
  nextSessionPublicationsByBranch,
  type StudentNextSessionPublications,
} from "./next-session-publications.ts";
export type { UpcomingControlBranchLink } from "../agenda-bridge/control-links.ts";
import type { UpcomingControlBranchLink } from "../agenda-bridge/control-links.ts";
import {
  orderByDaySchedule,
  type StudentDayScheduleSlot,
} from "./course-day-order.ts";

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
  nextSession?: StudentNextSessionPublications | null;
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

/** Contrôles élève d’un seul AnnualCourse — même identité que le Carnet ouvert. */
export function upcomingTestsForAnnualCourse(
  futureTests: UpcomingTestEntry[],
  annualCourseId: string,
): UpcomingTestEntry[] {
  const id = annualCourseId.trim();
  if (!id) return [];
  return futureTests.filter((entry) => (entry.item.annualCourseId ?? "").trim() === id);
}

interface ControlDateGroup {
  maxDates: number;
  dates: Set<string>;
}

function controlDateGroupKey(
  entry: UpcomingTestEntry,
  linksByCourse: ReadonlyMap<string, UpcomingControlBranchLink | "ambiguous">,
): { key: string; maxDates: number } {
  const courseId = entry.item.annualCourseId?.trim() ?? "";
  const link = courseId ? linksByCourse.get(courseId) : undefined;
  if (link && link !== "ambiguous") {
    return { key: `branch:${link.branchId}`, maxDates: link.maxUpcomingControlDates === 2 ? 2 : 1 };
  }
  return { key: `subject:${entry.item.subjectId}`, maxDates: 1 };
}

function linksByAnnualCourse(
  links: readonly UpcomingControlBranchLink[],
): Map<string, UpcomingControlBranchLink | "ambiguous"> {
  const byCourse = new Map<string, UpcomingControlBranchLink | "ambiguous">();
  for (const link of links) {
    const courseId = link.annualCourseId.trim();
    const branchId = link.branchId.trim();
    if (!courseId || !branchId) continue;
    const maxDates = link.maxUpcomingControlDates === 2 ? 2 : 1;
    const normalized: UpcomingControlBranchLink = {
      annualCourseId: courseId,
      branchId,
      maxUpcomingControlDates: maxDates,
    };
    const current = byCourse.get(courseId);
    if (!current) {
      byCourse.set(courseId, normalized);
      continue;
    }
    if (
      current === "ambiguous"
      || current.branchId !== normalized.branchId
      || current.maxUpcomingControlDates !== normalized.maxUpcomingControlDates
    ) {
      byCourse.set(courseId, "ambiguous");
    }
  }
  return byCourse;
}

/**
 * Vue élève : pour chaque branche officielle, seules les N prochaines dates
 * distinctes restent visibles. N vaut 1 sans réglage, ou 2 si le catalogue
 * de cette branche le demande. Plusieurs contrôles d’une même date restent
 * affichés. Sans lien fiable vers la branche, une seule date est conservée.
 */
export function nextControlDatePerSubject(
  futureTests: UpcomingTestEntry[],
  links: readonly UpcomingControlBranchLink[] = [],
): UpcomingTestEntry[] {
  const linksByCourse = linksByAnnualCourse(links);
  const ordered = futureTests
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) =>
      calendarDateKey(left.entry.slot.date).localeCompare(calendarDateKey(right.entry.slot.date))
      || left.index - right.index,
    );
  const groups = new Map<string, ControlDateGroup>();
  for (const { entry } of ordered) {
    const { key, maxDates } = controlDateGroupKey(entry, linksByCourse);
    const dateKey = calendarDateKey(entry.slot.date);
    const group = groups.get(key) ?? { maxDates, dates: new Set<string>() };
    if (group.dates.size < group.maxDates || group.dates.has(dateKey)) group.dates.add(dateKey);
    groups.set(key, group);
  }
  const seen = new Set<number>();
  return futureTests.filter((entry) => {
    if (seen.has(entry.item.id)) return false;
    const { key } = controlDateGroupKey(entry, linksByCourse);
    const group = groups.get(key);
    if (!group?.dates.has(calendarDateKey(entry.slot.date))) return false;
    seen.add(entry.item.id);
    return true;
  });
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
  options: {
    includeNextControls?: boolean;
    scheduleSlots?: readonly StudentDayScheduleSlot[];
    courseDay?: CourseDaySlot;
    /** Publications de la prochaine séance de chaque branche, après `courseDay`. */
    nextSession?: { items: readonly PrototypeAgendaItem[]; weeks: readonly SchoolWeek[] };
    /** Réglage catalogue déjà résolu. Absent : une date par branche affichée. */
    controlLinks?: readonly UpcomingControlBranchLink[];
  } = {},
): StudentCourseDaySection[] {
  const includeNextControls = options.includeNextControls !== false;
  const publications = sortPublications(dayItems);
  const groups: SubjectAgendaGroup[] = groupItemsBySubject(publications, subjects, {
    scheduleSlots: options.scheduleSlots,
    courseDay: options.courseDay,
  });
  const nextBySubject = new Map<string, UpcomingTestEntry[]>();

  if (includeNextControls) {
    for (const entry of nextControlDatePerSubject(futureTests, options.controlLinks)) {
      const subjectId = entry.item.subjectId;
      const current = nextBySubject.get(subjectId);
      if (current) current.push(entry);
      else nextBySubject.set(subjectId, [entry]);
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

  if (options.nextSession && options.courseDay) {
    const upcoming = nextSessionPublicationsByBranch(
      options.nextSession.items,
      options.nextSession.weeks,
      options.courseDay,
    );
    for (const [key, entry] of upcoming) {
      const sample = entry.publications[0]!;
      const subject = subjectForPublicationGroup(key, sample, subjects);
      const nextSession = {
        slot: entry.slot,
        publications: entry.publications.slice().sort(compareStudentPublications),
      };
      const existing = sections.get(subject.id);
      if (existing) {
        existing.nextSession = nextSession;
        continue;
      }
      sections.set(subject.id, {
        subject: { ...subject, name: displayBranchLabel(subject.name) },
        nextControls: [],
        publications: [],
        nextSession,
      });
    }
  }

  return orderByDaySchedule(
    [...sections.values()].filter(
      (section) =>
        section.publications.length > 0 ||
        section.nextControls.length > 0 ||
        (section.nextSession?.publications.length ?? 0) > 0,
    ),
    subjects,
    options.scheduleSlots,
    options.courseDay,
  );
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
      nextSession: filterNextSession(section.nextSession, (item) => item.type !== "TEST"),
    }))
    .filter(hasStudentPublications);
}

export function studentHomeworkOnlySections(
  sections: StudentCourseDaySection[],
): StudentCourseDaySection[] {
  return sections
    .map((section) => ({
      ...section,
      nextControls: [] as UpcomingTestEntry[],
      publications: section.publications.filter((item) => item.type === "HOMEWORK"),
      nextSession: filterNextSession(section.nextSession, (item) => item.type === "HOMEWORK"),
    }))
    .filter(hasStudentPublications);
}

export interface StudentNextSessionDateGroup {
  dateKey: string;
  slot: CourseDaySlot;
  branches: { subject: Subject; publications: PrototypeAgendaItem[] }[];
}

/** Une rubrique « Pour le … » par date, dans l’ordre chronologique ; branches dans l’ordre des sections. */
export function groupNextSessionsByDate(sections: StudentCourseDaySection[]): StudentNextSessionDateGroup[] {
  const groups = new Map<string, StudentNextSessionDateGroup>();
  for (const section of sections) {
    const next = section.nextSession;
    if (!next?.publications.length) continue;
    const dateKey = calendarDateKey(next.slot.date);
    const group = groups.get(dateKey) ?? { dateKey, slot: next.slot, branches: [] };
    group.branches.push({ subject: section.subject, publications: next.publications });
    groups.set(dateKey, group);
  }
  return [...groups.values()].sort((left, right) => left.dateKey.localeCompare(right.dateKey));
}

function filterNextSession(
  nextSession: StudentNextSessionPublications | null | undefined,
  keep: (item: PrototypeAgendaItem) => boolean,
): StudentNextSessionPublications | null {
  if (!nextSession) return null;
  const publications = nextSession.publications.filter(keep);
  return publications.length ? { slot: nextSession.slot, publications } : null;
}

function hasStudentPublications(section: StudentCourseDaySection): boolean {
  return section.publications.length > 0 || (section.nextSession?.publications.length ?? 0) > 0;
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

/** Pastille élève : « Sem. 12 », ou « Sem. 12-A » quand la semaine est alternée. */
export function formatControlWeekBadge(
  slot: Pick<CourseDaySlot, "schoolWeekNumber" | "weekKind">,
): string | null {
  if (!Number.isInteger(slot.schoolWeekNumber) || slot.schoolWeekNumber < 1) return null;
  const number = String(slot.schoolWeekNumber);
  if (slot.weekKind === "A" || slot.weekKind === "B") return `Sem. ${number}-${slot.weekKind}`;
  return `Sem. ${number}`;
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
  links: readonly UpcomingControlBranchLink[] = [],
): ControlPlanningWeek[] {
  return groupControlPlanning(
    nextControlDatePerSubject(listFutureTestsForClass(items, catalog, classroomId, fromDate, weeks), links),
  );
}
