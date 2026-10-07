import { COURSE_WEEKDAY_LABELS } from "../course-schedule/types.ts";
import { formatSwissDate } from "../course-sessions/format.ts";
import type { CourseSession } from "../course-sessions/types.ts";
import { compactLineText, truncateExportText } from "./rich-lines.ts";
import type { NotebookExportSessionBlock } from "./types.ts";

const WEEKDAY_SHORT: Record<number, string> = {
  1: "Lun.",
  2: "Mar.",
  3: "Mer.",
  4: "Jeu.",
  5: "Ven.",
};

export function formatSummaryDateLabel(session: Pick<CourseSession, "date" | "dayOfWeek">): string {
  const weekday = WEEKDAY_SHORT[session.dayOfWeek] ?? COURSE_WEEKDAY_LABELS[session.dayOfWeek];
  return `${weekday} ${formatSwissDate(session.date)}`;
}

export function summaryLinesForSession(block: NotebookExportSessionBlock): string[] {
  const header = `${block.weekLabel.replace(/^Sem\b/i, "SEM")} · ${block.summaryDateLabel}`;
  const lines = [header];
  const body = block.publications.filter((line) => line.kind !== "callout").map(compactLineText).filter(Boolean);
  const callouts = block.publications.filter((line) => line.kind === "callout").map(compactLineText).filter(Boolean);
  if (body.length) {
    lines.push(truncateExportText(`Publication élèves — ${body.join(" · ")}`));
  }
  for (const callout of callouts) {
    lines.push(truncateExportText(body.length ? callout : `Publication élèves — ${callout}`));
  }
  for (const title of block.controls) {
    lines.push(truncateExportText(`Contrôle — ${title}`));
  }
  if (block.notes.length) {
    lines.push(truncateExportText(`Notes prof — ${block.notes.map(compactLineText).join(" · ")}`));
  }
  return lines;
}
