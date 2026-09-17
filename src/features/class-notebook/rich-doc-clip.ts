import {
  CAMPUS_RICH_FORMAT,
  extractLine,
  inlinesPlainText,
  insertBlockAt,
  insertInlinesAt,
  lineInlines,
  sanitizeRichDoc,
  setLineInlines,
  visibleRichDocLines,
  type CampusRichDoc,
  type RichBlock,
  type RichInline,
  type RichLinePosition,
} from "./rich-doc.ts";

export const CAMPUS_RICH_CLIP_PREFIX = "CAMPUS_RICH_CLIP_V1:" as const;

export type RichClip =
  | { kind: "block"; block: RichBlock }
  | { kind: "inlines"; inlines: RichInline[] };

let remembered: RichClip | null = null;

export function rememberRichClip(clip: RichClip | null): void {
  remembered = clip ? sanitizeRichClip(clip) : null;
}

export function lastRememberedRichClip(): RichClip | null {
  return remembered;
}

export function richClipPlainText(clip: RichClip): string {
  if (clip.kind === "inlines") return inlinesPlainText(clip.inlines);
  const doc = sanitizeRichDoc({ format: CAMPUS_RICH_FORMAT, blocks: [clip.block] });
  return inlinesPlainText(
    doc.blocks.flatMap((block) => {
      if (block.type === "bulletList" || block.type === "orderedList") return block.items.flat();
      if (block.type === "checklist") return block.items.flatMap((item) => item.inlines);
      return block.inlines;
    }),
  );
}

export function encodeRichClip(clip: RichClip): string {
  const clean = sanitizeRichClip(clip);
  if (!clean) return "";
  return `${CAMPUS_RICH_CLIP_PREFIX}${JSON.stringify(clean)}`;
}

export function decodeRichClip(raw: string): RichClip | null {
  const text = raw.trim();
  const at = text.lastIndexOf(CAMPUS_RICH_CLIP_PREFIX);
  if (at < 0) return null;
  try {
    const parsed = JSON.parse(text.slice(at + CAMPUS_RICH_CLIP_PREFIX.length)) as unknown;
    return sanitizeRichClip(parsed);
  } catch {
    return null;
  }
}

export function copyLineAsClip(
  doc: CampusRichDoc,
  blockIndex: number,
  itemIndex: number | null,
): RichClip | null {
  const extracted = extractLine(doc, blockIndex, itemIndex);
  if (!extracted) return null;
  return { kind: "block", block: extracted.extracted };
}

export function pasteRichClip(
  doc: CampusRichDoc,
  blockIndex: number,
  itemIndex: number | null,
  offset: number,
  clip: RichClip,
): { doc: CampusRichDoc; caret: RichLinePosition } | null {
  const clean = sanitizeRichClip(clip);
  if (!clean) return null;

  if (clean.kind === "inlines") {
    const next = insertInlinesAt(lineInlines(doc, blockIndex, itemIndex), offset, clean.inlines);
    return {
      doc: setLineInlines(doc, blockIndex, itemIndex, next),
      caret: {
        blockIndex,
        itemIndex,
        offset: offset + inlinesPlainText(clean.inlines).length,
      },
    };
  }

  const visible = visibleRichDocLines(doc);
  const from = visible.findIndex(
    (line) => line.blockIndex === blockIndex && line.itemIndex === itemIndex,
  );
  const at = from < 0 ? visible.length : from + 1;
  const next = insertBlockAt(doc, clean.block, at);
  const lines = visibleRichDocLines(next);
  const pasted = lines[Math.min(at, Math.max(0, lines.length - 1))];
  return {
    doc: next,
    caret: pasted
      ? { blockIndex: pasted.blockIndex, itemIndex: pasted.itemIndex, offset: 0 }
      : { blockIndex, itemIndex, offset },
  };
}

function sanitizeRichClip(value: unknown): RichClip | null {
  if (!value || typeof value !== "object") return null;
  const record = value as { kind?: unknown; block?: unknown; inlines?: unknown };
  if (record.kind === "inlines" && Array.isArray(record.inlines)) {
    const wrapped = sanitizeRichDoc({
      format: CAMPUS_RICH_FORMAT,
      blocks: [{ type: "paragraph", inlines: record.inlines as RichInline[] }],
    });
    const block = wrapped.blocks[0];
    if (!block || block.type !== "paragraph" || !block.inlines.length) return null;
    return { kind: "inlines", inlines: block.inlines };
  }
  if (record.kind === "block" && record.block && typeof record.block === "object") {
    const wrapped = sanitizeRichDoc({
      format: CAMPUS_RICH_FORMAT,
      blocks: [record.block as RichBlock],
    });
    const block = wrapped.blocks[0];
    if (!block) return null;
    return { kind: "block", block };
  }
  return null;
}
