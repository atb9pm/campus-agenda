import {
  CAMPUS_RICH_DETAIL_PREFIX,
  CAMPUS_RICH_FORMAT,
  QUICK_BLOCK_LABELS,
  decodeRichDetail,
  isEmptyRichDoc,
  type CampusRichDoc,
  type RichInline,
  type RichMarks,
} from "../class-notebook/rich-doc.ts";
import type { NotebookExportRichLine, NotebookExportRun } from "./types.ts";

export function cloneMarks(marks?: RichMarks): RichMarks | undefined {
  if (!marks) return undefined;
  const next: RichMarks = {};
  if (marks.bold) next.bold = true;
  if (marks.italic) next.italic = true;
  if (marks.underline) next.underline = true;
  if (marks.highlight) next.highlight = true;
  if (marks.color) next.color = marks.color;
  if (marks.href) next.href = marks.href;
  return Object.keys(next).length ? next : undefined;
}

export function inlinesToRuns(inlines: readonly RichInline[]): NotebookExportRun[] {
  return inlines
    .map((entry) => {
      const marks = cloneMarks(entry.marks);
      return marks ? { text: entry.text, marks } : { text: entry.text };
    })
    .filter((run) => run.text.length > 0);
}

export function runsPlainText(runs: readonly NotebookExportRun[]): string {
  return runs.map((run) => run.text).join("");
}

export function lineFromRuns(
  kind: NotebookExportRichLine["kind"],
  runs: readonly NotebookExportRun[],
  extra?: Pick<NotebookExportRichLine, "order" | "checked" | "calloutKind">,
): NotebookExportRichLine | null {
  const cleaned = [...runs];
  if (!runsPlainText(cleaned).trim()) return null;
  return {
    kind,
    runs: cleaned,
    text: runsPlainText(cleaned),
    ...extra,
  };
}

function pushLine(lines: NotebookExportRichLine[], line: NotebookExportRichLine | null): void {
  if (line) lines.push(line);
}

export function richDocToExportLines(doc: CampusRichDoc | null | undefined): NotebookExportRichLine[] {
  if (!doc || isEmptyRichDoc(doc)) return [];
  const lines: NotebookExportRichLine[] = [];
  for (const block of doc.blocks) {
    if (block.type === "heading") {
      pushLine(lines, lineFromRuns("heading", inlinesToRuns(block.inlines)));
      continue;
    }
    if (block.type === "callout") {
      const label = QUICK_BLOCK_LABELS[block.kind];
      const body = inlinesToRuns(block.inlines);
      const runs: NotebookExportRun[] = body.length
        ? [{ text: `${label} : `, marks: { bold: true } }, ...body]
        : [{ text: label, marks: { bold: true } }];
      pushLine(lines, lineFromRuns("callout", runs, { calloutKind: block.kind }));
      continue;
    }
    if (block.type === "bulletList") {
      for (const item of block.items) {
        pushLine(lines, lineFromRuns("bullet", inlinesToRuns(item)));
      }
      continue;
    }
    if (block.type === "orderedList") {
      block.items.forEach((item, index) => {
        pushLine(lines, lineFromRuns("ordered", inlinesToRuns(item), { order: index + 1 }));
      });
      continue;
    }
    if (block.type === "checklist") {
      for (const item of block.items) {
        pushLine(lines, lineFromRuns("check", inlinesToRuns(item.inlines), { checked: item.checked }));
      }
      continue;
    }
    pushLine(lines, lineFromRuns("paragraph", inlinesToRuns(block.inlines)));
  }
  return lines;
}

export function publicationToExportLines(title: string, detail: string): NotebookExportRichLine[] {
  const rich = decodeRichDetail(detail);
  if (rich && !isEmptyRichDoc(rich)) {
    return richDocToExportLines(rich);
  }
  const lines: NotebookExportRichLine[] = [];
  if (title.trim()) {
    pushLine(lines, lineFromRuns("heading", [{ text: title.trim() }]));
  }
  const plain = detail.trim();
  if (plain && !plain.startsWith(CAMPUS_RICH_DETAIL_PREFIX) && plain !== CAMPUS_RICH_FORMAT) {
    pushLine(lines, lineFromRuns("paragraph", [{ text: plain }]));
  }
  return lines;
}

export function exportLineHasMark(
  line: NotebookExportRichLine,
  mark: keyof Pick<RichMarks, "bold" | "italic" | "underline" | "highlight" | "href" | "color">,
): boolean {
  return line.runs.some((run) => {
    if (mark === "href") return Boolean(run.marks?.href);
    if (mark === "color") return Boolean(run.marks?.color);
    return Boolean(run.marks?.[mark]);
  });
}

export function exportLinesContainRawRichPayload(lines: readonly NotebookExportRichLine[]): boolean {
  const joined = lines.map((line) => line.text).join("\n");
  return joined.includes(CAMPUS_RICH_DETAIL_PREFIX) || joined.includes(`"${CAMPUS_RICH_FORMAT}"`);
}

export function compactLineText(line: NotebookExportRichLine): string {
  if (line.kind === "bullet") return `- ${line.text.trim()}`;
  if (line.kind === "ordered") return `${line.order ?? 1}. ${line.text.trim()}`;
  if (line.kind === "check") return `${line.checked ? "[x]" : "[ ]"} ${line.text.trim()}`;
  return line.text.replace(/\s+/g, " ").trim();
}

export function truncateExportText(value: string, maxLength = 110): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}
