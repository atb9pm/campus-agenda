/** Document riche du Carnet — JSON structuré, jamais de HTML arbitraire. */

export const CAMPUS_RICH_FORMAT = "campus-rich-v1" as const;
export const CAMPUS_RICH_DETAIL_PREFIX = "CAMPUS_RICH_V1:" as const;

export const RICH_TEXT_COLOR_IDS = ["navy", "blue", "red", "green", "orange", "gray"] as const;
export type RichTextColorId = (typeof RICH_TEXT_COLOR_IDS)[number];

export const RICH_TEXT_COLOR_HEX: Record<RichTextColorId, string> = {
  navy: "#1d3557",
  blue: "#1d4ed8",
  red: "#b42318",
  green: "#027a48",
  orange: "#b54708",
  gray: "#475467",
};

export const RICH_HIGHLIGHT_HEX = "#fef08a";

export const QUICK_BLOCK_KINDS = ["todo", "finish", "review", "info", "bring", "read"] as const;
export type QuickBlockKind = (typeof QUICK_BLOCK_KINDS)[number];

export const QUICK_BLOCK_LABELS: Record<QuickBlockKind, string> = {
  todo: "À faire",
  finish: "À terminer",
  review: "Révision",
  info: "Information",
  bring: "À apporter",
  read: "À lire",
};

export interface RichMarks {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: RichTextColorId;
  highlight?: boolean;
  href?: string;
}

export interface RichInline {
  text: string;
  marks?: RichMarks;
}

export type RichBlock =
  | { type: "heading"; inlines: RichInline[] }
  | { type: "paragraph"; inlines: RichInline[] }
  | { type: "bulletList"; items: RichInline[][] }
  | { type: "orderedList"; items: RichInline[][] }
  | { type: "checklist"; items: Array<{ checked: boolean; inlines: RichInline[] }> }
  | { type: "callout"; kind: QuickBlockKind; inlines: RichInline[] };

export interface CampusRichDoc {
  format: typeof CAMPUS_RICH_FORMAT;
  blocks: RichBlock[];
}

const DEFAULT_PLACEHOLDER_DETAIL = "Aucune précision";
const MAX_TEXT_LENGTH = 20_000;
const MAX_BLOCKS = 80;
const MAX_INLINES = 80;
const MAX_LIST_ITEMS = 40;

export function emptyRichDoc(): CampusRichDoc {
  return { format: CAMPUS_RICH_FORMAT, blocks: [] };
}

export function isEmptyRichDoc(doc: CampusRichDoc | null | undefined): boolean {
  if (!doc?.blocks?.length) return true;
  return !doc.blocks.some((block) => blockHasText(block));
}

function inlinesText(inlines: readonly RichInline[]): string {
  return inlines.map((entry) => entry.text).join("");
}

function blockHasText(block: RichBlock): boolean {
  if (block.type === "bulletList" || block.type === "orderedList") {
    return block.items.some((item) => inlinesText(item).trim().length > 0);
  }
  if (block.type === "checklist") {
    return block.items.some((item) => inlinesText(item.inlines).trim().length > 0);
  }
  return inlinesText(block.inlines).trim().length > 0;
}

export function excerptRichDoc(doc: CampusRichDoc | null | undefined, maxLength = 120): string {
  if (!doc) return "";
  const parts: string[] = [];
  for (const block of doc.blocks) {
    if (block.type === "callout") {
      parts.push(`${QUICK_BLOCK_LABELS[block.kind]} ${inlinesText(block.inlines)}`);
    } else if (block.type === "bulletList" || block.type === "orderedList") {
      for (const item of block.items) parts.push(inlinesText(item));
    } else if (block.type === "checklist") {
      for (const item of block.items) parts.push(inlinesText(item.inlines));
    } else {
      parts.push(inlinesText(block.inlines));
    }
    const joined = parts.join(" ").replace(/\s+/g, " ").trim();
    if (joined.length >= maxLength) return `${joined.slice(0, maxLength).trimEnd()}…`;
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

export function fromPlainText(text: string): CampusRichDoc {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  return fromPlainLines(lines);
}

export function fromPlainLines(lines: readonly string[]): CampusRichDoc {
  const blocks: RichBlock[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    blocks.push({ type: "paragraph", inlines: [{ text: clippedText(trimmed) }] });
  }
  return sanitizeRichDoc({ format: CAMPUS_RICH_FORMAT, blocks });
}

export function insertQuickBlock(doc: CampusRichDoc, kind: QuickBlockKind): CampusRichDoc {
  const next = sanitizeRichDoc(doc);
  return sanitizeRichDoc({
    format: CAMPUS_RICH_FORMAT,
    blocks: [
      ...next.blocks,
      { type: "callout", kind, inlines: [{ text: "" }] },
    ],
  });
}

export function sanitizeHref(raw: string | null | undefined): string | undefined {
  const value = raw?.trim() ?? "";
  if (!value) return undefined;
  if (/^https:\/\//i.test(value) || /^mailto:/i.test(value)) return value.slice(0, 2000);
  if (/^http:\/\//i.test(value)) return value.slice(0, 2000);
  return undefined;
}

export function sanitizeRichDoc(input: unknown): CampusRichDoc {
  if (!input || typeof input !== "object") return emptyRichDoc();
  const candidate = input as { format?: unknown; blocks?: unknown };
  if (candidate.format !== CAMPUS_RICH_FORMAT || !Array.isArray(candidate.blocks)) {
    return emptyRichDoc();
  }
  const blocks: RichBlock[] = [];
  for (const raw of candidate.blocks.slice(0, MAX_BLOCKS)) {
    const block = sanitizeBlock(raw);
    if (block) blocks.push(block);
  }
  return { format: CAMPUS_RICH_FORMAT, blocks };
}

function clippedText(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").slice(0, MAX_TEXT_LENGTH);
}

function sanitizeMarks(raw: unknown): RichMarks | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const marks = raw as Record<string, unknown>;
  const next: RichMarks = {};
  if (marks.bold === true) next.bold = true;
  if (marks.italic === true) next.italic = true;
  if (marks.underline === true) next.underline = true;
  if (marks.highlight === true) next.highlight = true;
  if (typeof marks.color === "string" && (RICH_TEXT_COLOR_IDS as readonly string[]).includes(marks.color)) {
    next.color = marks.color as RichTextColorId;
  }
  const href = sanitizeHref(typeof marks.href === "string" ? marks.href : undefined);
  if (href) next.href = href;
  return Object.keys(next).length ? next : undefined;
}

function sanitizeInlines(raw: unknown): RichInline[] {
  if (!Array.isArray(raw)) return [];
  const inlines: RichInline[] = [];
  for (const entry of raw.slice(0, MAX_INLINES)) {
    if (!entry || typeof entry !== "object") continue;
    const text = typeof (entry as { text?: unknown }).text === "string" ? clippedText((entry as { text: string }).text) : "";
    if (!text) continue;
    const marks = sanitizeMarks((entry as { marks?: unknown }).marks);
    inlines.push(marks ? { text, marks } : { text });
  }
  return inlines;
}

function sanitizeBlock(raw: unknown): RichBlock | null {
  if (!raw || typeof raw !== "object") return null;
  const block = raw as { type?: unknown };
  if (block.type === "heading" || block.type === "paragraph") {
    return { type: block.type, inlines: sanitizeInlines((block as { inlines?: unknown }).inlines) };
  }
  if (block.type === "bulletList" || block.type === "orderedList") {
    const items = Array.isArray((block as { items?: unknown }).items)
      ? (block as { items: unknown[] }).items.slice(0, MAX_LIST_ITEMS).map((item) => sanitizeInlines(item))
      : [];
    return { type: block.type, items };
  }
  if (block.type === "checklist") {
    const items = Array.isArray((block as { items?: unknown }).items)
      ? (block as { items: unknown[] }).items.slice(0, MAX_LIST_ITEMS).map((item) => {
          const row = item && typeof item === "object" ? (item as { checked?: unknown; inlines?: unknown }) : {};
          return { checked: row.checked === true, inlines: sanitizeInlines(row.inlines) };
        })
      : [];
    return { type: "checklist", items };
  }
  if (block.type === "callout") {
    const kind = (block as { kind?: unknown }).kind;
    if (typeof kind !== "string" || !(QUICK_BLOCK_KINDS as readonly string[]).includes(kind)) return null;
    return {
      type: "callout",
      kind: kind as QuickBlockKind,
      inlines: sanitizeInlines((block as { inlines?: unknown }).inlines),
    };
  }
  return null;
}

export function isRichDetail(detail: string | null | undefined): boolean {
  return Boolean(detail?.startsWith(CAMPUS_RICH_DETAIL_PREFIX));
}

export function encodeRichDetail(doc: CampusRichDoc): string {
  return `${CAMPUS_RICH_DETAIL_PREFIX}${JSON.stringify(sanitizeRichDoc(doc))}`;
}

export function decodeRichDetail(detail: string | null | undefined): CampusRichDoc | null {
  if (!isRichDetail(detail)) return null;
  const raw = detail!.slice(CAMPUS_RICH_DETAIL_PREFIX.length);
  try {
    const parsed = JSON.parse(raw) as unknown;
    const doc = sanitizeRichDoc(parsed);
    return doc.blocks.length ? doc : emptyRichDoc();
  } catch {
    return null;
  }
}

export function isPlaceholderDetail(detail: string | null | undefined): boolean {
  const value = detail?.trim() ?? "";
  return value.length === 0 || value === DEFAULT_PLACEHOLDER_DETAIL;
}

export function publicationTitleForDoc(doc: CampusRichDoc): string {
  return excerptRichDoc(doc, 120) || "Publication";
}

export function rejectDangerousRichPayload(value: unknown): boolean {
  const serialized = JSON.stringify(value);
  return /<script|javascript:|onerror=|onload=|data:text\/html|<iframe|<object|<embed/i.test(serialized);
}

export function htmlToSafeInlines(html: string): RichInline[] {
  const stripped = html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "")
    .replace(/<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi, "");
  return [{ text: clippedText(stripped.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()) }].filter(
    (entry) => entry.text,
  );
}
