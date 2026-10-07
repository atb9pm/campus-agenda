import {
  CAMPUS_RICH_DETAIL_PREFIX,
  CAMPUS_RICH_FORMAT,
  QUICK_BLOCK_LABELS,
  decodeRichDetail,
  isEmptyRichDoc,
  type CampusRichDoc,
} from "../class-notebook/rich-doc.ts";
import type { NotebookExportRichLine } from "./types.ts";

function inlinesText(inlines: ReadonlyArray<{ text: string; marks?: { href?: string } }>): {
  text: string;
  href?: string;
} {
  const href = inlines.find((entry) => entry.marks?.href)?.marks?.href;
  return { text: inlines.map((entry) => entry.text).join(""), href };
}

export function richDocToExportLines(doc: CampusRichDoc | null | undefined): NotebookExportRichLine[] {
  if (!doc || isEmptyRichDoc(doc)) return [];
  const lines: NotebookExportRichLine[] = [];
  for (const block of doc.blocks) {
    if (block.type === "heading") {
      const { text, href } = inlinesText(block.inlines);
      if (text.trim()) lines.push({ kind: "heading", text: text.trim(), href });
      continue;
    }
    if (block.type === "callout") {
      const { text, href } = inlinesText(block.inlines);
      const label = QUICK_BLOCK_LABELS[block.kind];
      const body = text.trim();
      lines.push({
        kind: "callout",
        calloutKind: block.kind,
        text: body ? `${label} : ${body}` : label,
        href,
      });
      continue;
    }
    if (block.type === "bulletList") {
      for (const item of block.items) {
        const { text, href } = inlinesText(item);
        if (text.trim()) lines.push({ kind: "bullet", text: text.trim(), href });
      }
      continue;
    }
    if (block.type === "orderedList") {
      block.items.forEach((item, index) => {
        const { text, href } = inlinesText(item);
        if (text.trim()) lines.push({ kind: "ordered", text: text.trim(), order: index + 1, href });
      });
      continue;
    }
    if (block.type === "checklist") {
      for (const item of block.items) {
        const { text, href } = inlinesText(item.inlines);
        if (text.trim()) {
          lines.push({ kind: "check", text: text.trim(), checked: item.checked, href });
        }
      }
      continue;
    }
    const { text, href } = inlinesText(block.inlines);
    if (text.trim()) lines.push({ kind: "paragraph", text: text.trim(), href });
  }
  return lines;
}

export function publicationToExportLines(title: string, detail: string): NotebookExportRichLine[] {
  const rich = decodeRichDetail(detail);
  if (rich && !isEmptyRichDoc(rich)) {
    const lines = richDocToExportLines(rich);
    if (title.trim() && !lines.some((line) => line.kind === "heading" && line.text === title.trim())) {
      return [{ kind: "heading", text: title.trim() }, ...lines];
    }
    return lines;
  }
  const lines: NotebookExportRichLine[] = [];
  if (title.trim()) lines.push({ kind: "heading", text: title.trim() });
  const plain = detail.trim();
  if (plain && !plain.startsWith(CAMPUS_RICH_DETAIL_PREFIX) && plain !== CAMPUS_RICH_FORMAT) {
    lines.push({ kind: "paragraph", text: plain });
  }
  return lines;
}

export function exportLinesContainRawRichPayload(lines: readonly NotebookExportRichLine[]): boolean {
  const joined = lines.map((line) => line.text).join("\n");
  return joined.includes(CAMPUS_RICH_DETAIL_PREFIX) || joined.includes(`"${CAMPUS_RICH_FORMAT}"`);
}
