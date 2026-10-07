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
import { formatSummaryDateLabel } from "./summary.ts";
import type {
  NotebookExportDocument,
  NotebookExportOptions,
  NotebookExportSessionBlock,
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

function sessionDayIndex(session: CourseSession): number {
  return session.dayOfWeek - 1;
}

function itemsForSession(
  items: readonly PrototypeAgendaItem[],
  session: CourseSession,
  kind: "publication" | "control",
  includeDrafts: boolean,
): PrototypeAgendaItem[] {
  return items.filter((item) => {
    if (item.schoolWeekNumber !== session.schoolWeekNumber) return false;
    if (item.day !== sessionDayIndex(session)) return false;
    if (kind === "control") return item.type === "TEST";
    if (!isPublicationLine(item)) return false;
    if (!includeDrafts && !isStudentVisible(item)) return false;
    return true;
  });
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
  const sessions = filterSessionsForExportPeriod(input.sessions, input.weeks, input.options.period);
  const notesSeen = new Set<number>();
  const blocks: NotebookExportSessionBlock[] = [];
  const scopedItems = input.annualCourseId
    ? input.items.filter((entry) => !entry.annualCourseId || entry.annualCourseId === input.annualCourseId)
    : input.items;
  let publicationCount = 0;
  let controlCount = 0;

  for (const session of sessions) {
    const publicationItems = input.options.includePublications
      ? itemsForSession(scopedItems, session, "publication", input.options.includeDrafts)
      : [];
    const publications = publicationItems.flatMap((entry) => publicationToExportLines(entry.title, entry.detail));
    const controls = input.options.includeControls
      ? itemsForSession(scopedItems, session, "control", true).map((entry) => entry.title.trim()).filter(Boolean)
      : [];
    publicationCount += publicationItems.length;
    controlCount += controls.length;
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

  if (!blocks.length) return null;

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
  };
}
