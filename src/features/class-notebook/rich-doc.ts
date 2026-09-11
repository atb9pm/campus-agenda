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
  return parseInlinesFromHtml(html);
}

const HIGHLIGHT_RGB = { r: 254, g: 240, b: 138 };

export function parseCssColorToRgb(value: string): { r: number; g: number; b: number } | null {
  const raw = value.trim().toLowerCase();
  if (!raw) return null;
  if (raw === "yellow" || raw === "highlight") return { ...HIGHLIGHT_RGB };
  const hex = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const digits = hex[1]!;
    const full = digits.length === 3 ? digits.split("").map((d) => d + d).join("") : digits;
    return {
      r: Number.parseInt(full.slice(0, 2), 16),
      g: Number.parseInt(full.slice(2, 4), 16),
      b: Number.parseInt(full.slice(4, 6), 16),
    };
  }
  const rgb = raw.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgb) {
    return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) };
  }
  return null;
}

function rgbClose(left: { r: number; g: number; b: number }, right: { r: number; g: number; b: number }, delta = 12) {
  return Math.abs(left.r - right.r) <= delta && Math.abs(left.g - right.g) <= delta && Math.abs(left.b - right.b) <= delta;
}

export function colorIdFromCss(value: string): RichTextColorId | undefined {
  const rgb = parseCssColorToRgb(value);
  if (!rgb) return undefined;
  for (const id of RICH_TEXT_COLOR_IDS) {
    const hex = RICH_TEXT_COLOR_HEX[id];
    const target = parseCssColorToRgb(hex);
    if (target && rgbClose(rgb, target)) return id;
  }
  return undefined;
}

export function isHighlightCss(value: string): boolean {
  const rgb = parseCssColorToRgb(value);
  if (!rgb) return /yellow|highlight|#ff0\b|#ffff00|fef08a/i.test(value);
  return rgbClose(rgb, HIGHLIGHT_RGB, 20) || rgbClose(rgb, { r: 255, g: 255, b: 0 }, 10);
}

export function marksFromCssText(style: string): RichMarks {
  const marks: RichMarks = {};
  const decls = style.split(";").map((part) => part.trim()).filter(Boolean);
  for (const decl of decls) {
    const sep = decl.indexOf(":");
    if (sep < 0) continue;
    const prop = decl.slice(0, sep).trim().toLowerCase();
    const value = decl.slice(sep + 1).trim();
    if (prop === "color") {
      const color = colorIdFromCss(value);
      if (color) marks.color = color;
    }
    if (prop === "background" || prop === "background-color") {
      if (isHighlightCss(value)) marks.highlight = true;
    }
    if (prop === "font-weight" && /bold|[6-9]00/.test(value)) marks.bold = true;
    if (prop === "font-style" && value.includes("italic")) marks.italic = true;
    if (prop === "text-decoration" && value.includes("underline")) marks.underline = true;
  }
  return marks;
}

export function mergeRichMarks(base: RichMarks, extra: RichMarks): RichMarks {
  return { ...base, ...extra };
}

/** Interprète le HTML produit par execCommand (Chrome/Firefox : span/font, pas seulement <mark>). */
export function parseInlinesFromHtml(html: string): RichInline[] {
  const cleaned = html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "")
    .replace(/<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi, "");
  const inlines: RichInline[] = [];
  const stack: RichMarks[] = [{}];
  const token = /<\/?([a-zA-Z0-9]+)([^>]*)>|([^<]+)/g;
  let match: RegExpExecArray | null;
  while ((match = token.exec(cleaned))) {
    if (match[3] != null) {
      const text = decodeHtmlEntities(match[3]);
      if (!text) continue;
      const marks = stack[stack.length - 1] ?? {};
      inlines.push(Object.keys(marks).length ? { text, marks: { ...marks } } : { text });
      continue;
    }
    const tag = match[1]!.toLowerCase();
    const attrs = match[2] ?? "";
    const closing = match[0]!.startsWith("</");
    if (tag === "br") {
      inlines.push({ text: " " });
      continue;
    }
    if (tag === "script" || tag === "iframe" || tag === "object" || tag === "embed") continue;
    if (closing) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const current = stack[stack.length - 1] ?? {};
    stack.push(mergeRichMarks(current, marksFromHtmlTag(tag, attrs)));
  }
  return inlines.filter((entry) => entry.text.length > 0);
}

function marksFromHtmlTag(tag: string, rawAttrs: string): RichMarks {
  const marks: RichMarks = {};
  if (tag === "strong" || tag === "b") marks.bold = true;
  if (tag === "em" || tag === "i") marks.italic = true;
  if (tag === "u") marks.underline = true;
  if (tag === "mark") marks.highlight = true;
  const attrs = parseHtmlAttributes(rawAttrs);
  if (tag === "a") {
    const href = sanitizeHref(attrs.href);
    if (href) marks.href = href;
  }
  if (attrs["data-color"] && (RICH_TEXT_COLOR_IDS as readonly string[]).includes(attrs["data-color"])) {
    marks.color = attrs["data-color"] as RichTextColorId;
  }
  if (attrs.color) {
    const color = colorIdFromCss(attrs.color);
    if (color) marks.color = color;
  }
  Object.assign(marks, marksFromCssText(attrs.style ?? ""));
  return marks;
}

function parseHtmlAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const token = /([:A-Za-z_][:A-Za-z0-9_-]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match: RegExpExecArray | null;
  while ((match = token.exec(raw))) {
    attrs[match[1]!.toLowerCase()] = match[3] ?? match[4] ?? match[5] ?? "";
  }
  return attrs;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

export function addStructuredListItem(block: RichBlock, afterIndex?: number): RichBlock {
  if (block.type === "bulletList" || block.type === "orderedList") {
    const items = [...block.items];
    const at = afterIndex == null ? items.length : afterIndex + 1;
    items.splice(at, 0, []);
    return { ...block, items: items.slice(0, MAX_LIST_ITEMS) };
  }
  if (block.type === "checklist") {
    const items = [...block.items];
    const at = afterIndex == null ? items.length : afterIndex + 1;
    items.splice(at, 0, { checked: false, inlines: [] });
    return { ...block, items: items.slice(0, MAX_LIST_ITEMS) };
  }
  return block;
}

export function removeStructuredListItem(block: RichBlock, index: number): RichBlock {
  if (block.type === "bulletList" || block.type === "orderedList") {
    const items = block.items.filter((_, current) => current !== index);
    return { ...block, items: items.length ? items : [[]] };
  }
  if (block.type === "checklist") {
    const items = block.items.filter((_, current) => current !== index);
    return { ...block, items: items.length ? items : [{ checked: false, inlines: [] }] };
  }
  return block;
}
