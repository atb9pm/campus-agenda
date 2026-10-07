import { isStudentVisible } from "../agenda/visibility.ts";
import type { PrototypeAgendaItem } from "../agenda/demo-items.ts";
import { isPublicationLine, weekNotesKey, composeWeekNotesDoc, listWeekNotes } from "../class-notebook/index.ts";
import type { ClassNotesDocument } from "../class-notebook/types.ts";
import { COURSE_WEEKDAY_LABELS } from "../course-schedule/types.ts";
import { formatSwissDate } from "../course-sessions/format.ts";
import type { CourseSession } from "../course-sessions/types.ts";
import { splitControlPlanningPeriods } from "../control-planning/periods.ts";
import type { SchoolWeekEntry } from "../school-year/types.ts";
import { publicationToExportLines, richDocToExportLines } from "./rich-lines.ts";
import {
  agendaItemBelongsToExportPeriod,
  resolveAgendaItemSession,
} from "./session-match.ts";
import { formatSummaryDateLabel } from "./summary.ts";
import type {
  NotebookExportDocument,
  NotebookExportOptions,
  NotebookExportSessionBlock,
  NotebookExportUnmatchedControl,
} from "./types.ts";

function padWeek(number: number): string {
  return String(number).padStart(2, "0");
}

export function formatExportWeekLabel(session: Pick<CourseSession, "schoolWeekNumber" | "weekKind">): string {
  const padded = padWeek(session.schoolWeekNumber);
  if (session.weekKind === "A" || session.weekKind === "B") return `Sem ${padded}-${session.weekKind}`;
  return `Sem ${padded}`;
}

export function formatExportDateLabel(session: Pick<CourseSession, "date" | "dayOfWeek">): string {
  const weekday = COURSE_WEEKDAY_LABELS[session.dayOfWeek];
  return `${weekday} ${formatSwissDate(session.date)}`;
}

export function formatExportLongDateLabel(session: Pick<CourseSession, "date" | "dayOfWeek">): string {
  const [year, month, day] = session.date.split("-").map(Number);
  const date = new Date(year, (month ?? 1) - 1, day ?? 1, 12);
  const datePart = new Intl.DateTimeFormat("fr-CH", { day: "numeric", month: "long", year: "numeric" }).format(date);
  return `${COURSE_WEEKDAY_LABELS[session.dayOfWeek]} ${datePart.replace(".", "")}`;
}

export function filterSessionsForExportPeriod(
  sessions: readonly CourseSession[],
  weeks: readonly SchoolWeekEntry[],
  period: NotebookExportOptions["period"],
): CourseSession[] {
  if (period === "year") return [...sessions];
  const split = splitControlPlanningPeriods(weeks);
  const wanted = split.find((entry) => entry.id === period);
  const numbers = new Set((wanted?.weeks ?? []).map((week) => week.number));
  return sessions.filter((session) => numbers.has(session.schoolWeekNumber));
}

function itemsForSession(
  items: readonly PrototypeAgendaItem[],
  session: CourseSession,
  allSessions: readonly CourseSession[],
  kind: "publication" | "control",
  includeDrafts: boolean,
): PrototypeAgendaItem[] {
  return items.filter((item) => {
    const resolved = resolveAgendaItemSession(item, allSessions);
    if (resolved.kind === "UNMATCHED" || resolved.session.key !== session.key) return false;
    if (kind === "control") return item.type === "TEST";
    if (!isPublicationLine(item)) return false;
    if (!includeDrafts && !isStudentVisible(item)) return false;
    return true;
  });
}

function unmatchedControlEntry(item: PrototypeAgendaItem): NotebookExportUnmatchedControl {
  const date = item.courseSessionDate?.trim();
  return {
    id: item.id,
    title: item.title.trim() || "Contrôle",
    dateLabel: date ? formatSwissDate(date) : null,
  };
}

function compareUnmatchedControls(
  left: PrototypeAgendaItem,
  right: PrototypeAgendaItem,
): number {
  const leftDate = left.courseSessionDate?.trim() ?? "";
  const rightDate = right.courseSessionDate?.trim() ?? "";
  return leftDate.localeCompare(rightDate) || left.schoolWeekNumber - right.schoolWeekNumber || left.id - right.id;
}

export function assembleNotebookExport(input: {
  sessions: readonly CourseSession[];
  weeks: readonly SchoolWeekEntry[];
  items: readonly PrototypeAgendaItem[];
  notes: ClassNotesDocument | null;
  annualCourseId?: string;
  classId: string;
  classCode: string;
  classLabel: string;
  branchLabel: string;
  schoolYearLabel: string;
  teacherName: string;
  scheduleSummary: string;
  generatedOn: string;
  options: NotebookExportOptions;
}): NotebookExportDocument | null {
  const allSessions = [...input.sessions];
  const sessions = filterSessionsForExportPeriod(allSessions, input.weeks, input.options.period);
  const notesSeen = new Set<number>();
  const blocks: NotebookExportSessionBlock[] = [];
  const scopedItems = input.annualCourseId
    ? input.items.filter((entry) => !entry.annualCourseId || entry.annualCourseId === input.annualCourseId)
    : input.items;
  let publicationCount = 0;
  let matchedControlCount = 0;

  for (const session of sessions) {
    const publicationItems = input.options.includePublications
      ? itemsForSession(scopedItems, session, allSessions, "publication", input.options.includeDrafts)
      : [];
    const publications = publicationItems.flatMap((entry) => publicationToExportLines(entry.title, entry.detail));
    const controlItems = input.options.includeControls
      ? itemsForSession(scopedItems, session, allSessions, "control", true)
      : [];
    const controls = controlItems.map((entry) => entry.title.trim()).filter(Boolean);
    publicationCount += publicationItems.length;
    matchedControlCount += controlItems.length;
    let notes: NotebookExportSessionBlock["notes"] = [];
    if (input.options.includeTeacherNotes && input.notes && !notesSeen.has(session.schoolWeekNumber)) {
      notesSeen.add(session.schoolWeekNumber);
      const weekNotes = listWeekNotes(input.notes, weekNotesKey(input.classId, session.schoolWeekNumber));
      notes = richDocToExportLines(composeWeekNotesDoc(weekNotes));
    }
    if (!publications.length && !controls.length && !notes.length) continue;
    blocks.push({
      session,
      weekLabel: formatExportWeekLabel(session),
      dateLabel: formatExportDateLabel(session),
      longDateLabel: formatExportLongDateLabel(session),
      summaryDateLabel: formatSummaryDateLabel(session),
      publications,
      controls,
      notes,
    });
  }

  const unmatchedControlItems = input.options.includeControls
    ? scopedItems
        .filter((item) => item.type === "TEST")
        .filter((item) => resolveAgendaItemSession(item, allSessions).kind === "UNMATCHED")
        .filter((item) => agendaItemBelongsToExportPeriod(item, input.options.period, input.weeks))
        .sort(compareUnmatchedControls)
    : [];
  const unmatchedControls = unmatchedControlItems.map(unmatchedControlEntry);
  const controlCount = matchedControlCount + unmatchedControlItems.length;

  if (!blocks.length && !unmatchedControls.length) return null;

  return {
    classCode: input.classCode,
    classLabel: input.classLabel,
    branchLabel: input.branchLabel,
    schoolYearLabel: input.schoolYearLabel,
    teacherName: input.teacherName,
    scheduleSummary: input.scheduleSummary,
    generatedOn: input.generatedOn,
    layout: input.options.layout,
    coverPage: input.options.coverPage,
    sessionCount: sessions.length,
    publicationCount,
    controlCount,
    noteCount: blocks.reduce((sum, block) => sum + (block.notes.length ? 1 : 0), 0),
    sessions: blocks,
    unmatchedControls,
  };
}
