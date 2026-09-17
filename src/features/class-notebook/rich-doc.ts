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

export const RICH_TEXT_COLOR_LABELS: Record<RichTextColorId, string> = {
  navy: "Marine",
  blue: "Bleu",
  red: "Rouge",
  green: "Vert",
  orange: "Orange",
  gray: "Gris",
};

export type RichStructureType = "heading" | "paragraph" | "bulletList" | "orderedList" | "checklist";

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

/** Insère un bloc de semaine juste après le bloc actif (ou à la fin si non précisé). */
export function insertQuickBlock(
  doc: CampusRichDoc,
  kind: QuickBlockKind,
  afterBlockIndex?: number,
): CampusRichDoc {
  const next = sanitizeRichDoc(doc);
  const blocks = [...next.blocks];
  const callout: RichBlock = { type: "callout", kind, inlines: [] };
  const at = afterBlockIndex == null ? blocks.length : Math.min(blocks.length, afterBlockIndex + 1);
  blocks.splice(at, 0, callout);
  return { format: CAMPUS_RICH_FORMAT, blocks: blocks.slice(0, MAX_BLOCKS) };
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
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .slice(0, MAX_TEXT_LENGTH);
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
      if (/\bdata-padding\s*=/.test(attrs)) continue;
      inlines.push({ text: "\n" });
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

export function inlinesPlainText(inlines: readonly RichInline[]): string {
  return inlines.map((entry) => entry.text).join("");
}

export function marksEqual(left?: RichMarks, right?: RichMarks): boolean {
  const a = left ?? {};
  const b = right ?? {};
  return (
    Boolean(a.bold) === Boolean(b.bold) &&
    Boolean(a.italic) === Boolean(b.italic) &&
    Boolean(a.underline) === Boolean(b.underline) &&
    Boolean(a.highlight) === Boolean(b.highlight) &&
    (a.color ?? null) === (b.color ?? null) &&
    (a.href ?? null) === (b.href ?? null)
  );
}

function cleanMarks(marks: RichMarks | undefined): RichMarks | undefined {
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

/** Fusionne les segments voisins de même mise en forme et supprime les vides. */
export function normalizeInlines(inlines: readonly RichInline[]): RichInline[] {
  const result: RichInline[] = [];
  for (const entry of inlines) {
    if (!entry.text) continue;
    const marks = cleanMarks(entry.marks);
    const previous = result[result.length - 1];
    if (previous && marksEqual(previous.marks, marks)) {
      result[result.length - 1] = marks
        ? { text: previous.text + entry.text, marks }
        : { text: previous.text + entry.text };
      continue;
    }
    result.push(marks ? { text: entry.text, marks } : { text: entry.text });
  }
  return result;
}

export type RichMarkName = "bold" | "italic" | "underline" | "highlight" | "color" | "href";

export function withMark(
  marks: RichMarks | undefined,
  mark: RichMarkName,
  value: boolean | RichTextColorId | string | undefined,
): RichMarks | undefined {
  const next: RichMarks = { ...(marks ?? {}) };
  if (value === undefined || value === false) {
    delete next[mark];
  } else if (mark === "color") {
    next.color = value as RichTextColorId;
  } else if (mark === "href") {
    next.href = value as string;
  } else {
    next[mark] = true;
  }
  return cleanMarks(next);
}

/**
 * Applique (ou retire) une mise en forme sur l'intervalle de caractères [start, end).
 * Aucun HTML n'est manipulé : le document reste la source de vérité.
 */
export function applyMarkToRange(
  inlines: readonly RichInline[],
  start: number,
  end: number,
  mark: RichMarkName,
  value: boolean | RichTextColorId | string | undefined,
): RichInline[] {
  const from = Math.max(0, Math.min(start, end));
  const to = Math.max(start, end);
  if (to <= from) return normalizeInlines(inlines);

  const result: RichInline[] = [];
  let offset = 0;
  for (const entry of inlines) {
    const entryStart = offset;
    const entryEnd = offset + entry.text.length;
    offset = entryEnd;
    if (entryEnd <= from || entryStart >= to) {
      result.push(entry);
      continue;
    }
    const localFrom = Math.max(0, from - entryStart);
    const localTo = Math.min(entry.text.length, to - entryStart);
    if (localFrom > 0) {
      result.push({ text: entry.text.slice(0, localFrom), ...(entry.marks ? { marks: entry.marks } : {}) });
    }
    const marked = withMark(entry.marks, mark, value);
    result.push({ text: entry.text.slice(localFrom, localTo), ...(marked ? { marks: marked } : {}) });
    if (localTo < entry.text.length) {
      result.push({ text: entry.text.slice(localTo), ...(entry.marks ? { marks: entry.marks } : {}) });
    }
  }
  return normalizeInlines(result);
}

/** Marques du caractère à gauche du curseur (ou du premier caractère en début de ligne). */
export function marksAtOffset(inlines: readonly RichInline[], offset: number): RichMarks {
  const length = inlinesPlainText(inlines).length;
  if (!length) return {};
  const index = offset <= 0 ? 0 : Math.min(offset, length) - 1;
  return marksInRange(inlines, index, index + 1);
}

/** Mise en forme commune à tout l'intervalle — sert à l'état actif de la barre d'outils. */
export function marksInRange(
  inlines: readonly RichInline[],
  start: number,
  end: number,
): RichMarks {
  const from = Math.max(0, Math.min(start, end));
  const to = Math.max(start, end);
  const covered: RichMarks[] = [];
  let offset = 0;
  for (const entry of inlines) {
    const entryStart = offset;
    const entryEnd = offset + entry.text.length;
    offset = entryEnd;
    if (entryEnd <= from || entryStart >= to) continue;
    covered.push(entry.marks ?? {});
  }
  if (!covered.length) return {};
  const first = covered[0]!;
  const common: RichMarks = {};
  if (covered.every((marks) => marks.bold)) common.bold = true;
  if (covered.every((marks) => marks.italic)) common.italic = true;
  if (covered.every((marks) => marks.underline)) common.underline = true;
  if (covered.every((marks) => marks.highlight)) common.highlight = true;
  if (first.color && covered.every((marks) => marks.color === first.color)) common.color = first.color;
  if (first.href && covered.every((marks) => marks.href === first.href)) common.href = first.href;
  return common;
}

/** Insère du texte (y compris un saut de ligne) à une position de caractères. */
export function insertTextAt(
  inlines: readonly RichInline[],
  offset: number,
  text: string,
  marks?: RichMarks,
): RichInline[] {
  const piece = clippedText(text);
  if (!piece) return normalizeInlines(inlines);
  const [before, after] = splitInlinesAt(inlines, offset);
  if (marks !== undefined) {
    const cleaned = cleanMarks(marks);
    const insert: RichInline = cleaned ? { text: piece, marks: cleaned } : { text: piece };
    return normalizeInlines([...before, insert, ...after]);
  }
  if (!before.length) return normalizeInlines([{ text: piece }, ...after]);
  const last = before[before.length - 1]!;
  before[before.length - 1] = { ...last, text: last.text + piece };
  return normalizeInlines([...before, ...after]);
}

export function splitInlinesAt(
  inlines: readonly RichInline[],
  offset: number,
): [RichInline[], RichInline[]] {
  const before: RichInline[] = [];
  const after: RichInline[] = [];
  let seen = 0;
  for (const entry of inlines) {
    const entryEnd = seen + entry.text.length;
    if (entryEnd <= offset) {
      before.push(entry);
    } else if (seen >= offset) {
      after.push(entry);
    } else {
      const cut = offset - seen;
      before.push({ text: entry.text.slice(0, cut), ...(entry.marks ? { marks: entry.marks } : {}) });
      after.push({ text: entry.text.slice(cut), ...(entry.marks ? { marks: entry.marks } : {}) });
    }
    seen = entryEnd;
  }
  return [normalizeInlines(before), normalizeInlines(after)];
}

export function sliceInlines(
  inlines: readonly RichInline[],
  start: number,
  end: number,
): RichInline[] {
  const from = Math.max(0, Math.min(start, end));
  const to = Math.max(start, end);
  if (to <= from) return [];
  const [, rest] = splitInlinesAt(inlines, from);
  const [middle] = splitInlinesAt(rest, to - from);
  return normalizeInlines(middle);
}

export function insertInlinesAt(
  inlines: readonly RichInline[],
  offset: number,
  incoming: readonly RichInline[],
): RichInline[] {
  if (!incoming.length) return normalizeInlines(inlines);
  const [before, after] = splitInlinesAt(inlines, offset);
  return normalizeInlines([...before, ...incoming, ...after]);
}

/** Une ligne éditable : un bloc simple, ou un élément de liste. */
export interface RichDocLine {
  blockIndex: number;
  itemIndex: number | null;
  kind: "heading" | "paragraph" | "callout" | "bulletList" | "orderedList" | "checklist";
  inlines: RichInline[];
  checked?: boolean;
  calloutKind?: QuickBlockKind;
  /** Numéro affiché pour une liste numérotée. */
  ordinal?: number;
}

export function richDocLines(doc: CampusRichDoc): RichDocLine[] {
  const blocks = doc.blocks.length ? doc.blocks : [{ type: "paragraph" as const, inlines: [] }];
  const lines: RichDocLine[] = [];
  blocks.forEach((block, blockIndex) => {
    if (block.type === "bulletList" || block.type === "orderedList") {
      const items = block.items.length ? block.items : [[]];
      items.forEach((item, itemIndex) => {
        lines.push({
          blockIndex,
          itemIndex,
          kind: block.type,
          inlines: item,
          ordinal: itemIndex + 1,
        });
      });
      return;
    }
    if (block.type === "checklist") {
      const items = block.items.length ? block.items : [{ checked: false, inlines: [] }];
      items.forEach((item, itemIndex) => {
        lines.push({
          blockIndex,
          itemIndex,
          kind: "checklist",
          inlines: item.inlines,
          checked: item.checked,
        });
      });
      return;
    }
    lines.push({
      blockIndex,
      itemIndex: null,
      kind: block.type,
      inlines: block.inlines,
      calloutKind: block.type === "callout" ? block.kind : undefined,
    });
  });
  return lines;
}

export function lineInlines(doc: CampusRichDoc, blockIndex: number, itemIndex: number | null): RichInline[] {
  return (
    richDocLines(doc).find((line) => line.blockIndex === blockIndex && line.itemIndex === itemIndex)?.inlines ?? []
  );
}

export function setLineInlines(
  doc: CampusRichDoc,
  blockIndex: number,
  itemIndex: number | null,
  inlines: readonly RichInline[],
): CampusRichDoc {
  const blocks = doc.blocks.length ? [...doc.blocks] : [{ type: "paragraph" as const, inlines: [] }];
  const block = blocks[blockIndex];
  if (!block) return doc;
  const next = normalizeInlines(inlines);
  if (block.type === "bulletList" || block.type === "orderedList") {
    const items = block.items.length ? [...block.items] : [[]];
    items[itemIndex ?? 0] = next;
    blocks[blockIndex] = { ...block, items };
  } else if (block.type === "checklist") {
    const items = block.items.length ? [...block.items] : [{ checked: false, inlines: [] }];
    const current = items[itemIndex ?? 0] ?? { checked: false, inlines: [] };
    items[itemIndex ?? 0] = { ...current, inlines: next };
    blocks[blockIndex] = { ...block, items };
  } else {
    blocks[blockIndex] = { ...block, inlines: next };
  }
  return { format: CAMPUS_RICH_FORMAT, blocks };
}

export function setChecklistChecked(
  doc: CampusRichDoc,
  blockIndex: number,
  itemIndex: number,
  checked: boolean,
): CampusRichDoc {
  const blocks = [...doc.blocks];
  const block = blocks[blockIndex];
  if (!block || block.type !== "checklist") return doc;
  blocks[blockIndex] = {
    ...block,
    items: block.items.map((item, index) => (index === itemIndex ? { ...item, checked } : item)),
  };
  return { format: CAMPUS_RICH_FORMAT, blocks };
}

export interface RichLinePosition {
  blockIndex: number;
  itemIndex: number | null;
  offset: number;
}

/**
 * Entrée : nouvelle ligne au même niveau.
 * Dans une liste, un nouvel élément. Ailleurs, un nouveau paragraphe.
 * Un titre ou un bloc de semaine passe au paragraphe suivant : le titre ne contamine plus la suite.
 */
export function splitLine(
  doc: CampusRichDoc,
  blockIndex: number,
  itemIndex: number | null,
  offset: number,
): { doc: CampusRichDoc; caret: RichLinePosition } {
  const blocks = doc.blocks.length ? [...doc.blocks] : [{ type: "paragraph" as const, inlines: [] }];
  const block = blocks[blockIndex];
  if (!block) return { doc, caret: { blockIndex, itemIndex, offset } };

  if (block.type === "bulletList" || block.type === "orderedList") {
    const items = block.items.length ? [...block.items] : [[]];
    const at = itemIndex ?? 0;
    const [before, after] = splitInlinesAt(items[at] ?? [], offset);
    items.splice(at, 1, before, after);
    blocks[blockIndex] = { ...block, items: items.slice(0, MAX_LIST_ITEMS) };
    return {
      doc: { format: CAMPUS_RICH_FORMAT, blocks },
      caret: { blockIndex, itemIndex: at + 1, offset: 0 },
    };
  }

  if (block.type === "checklist") {
    const items = block.items.length ? [...block.items] : [{ checked: false, inlines: [] }];
    const at = itemIndex ?? 0;
    const [before, after] = splitInlinesAt(items[at]?.inlines ?? [], offset);
    items.splice(at, 1, { checked: items[at]?.checked ?? false, inlines: before }, { checked: false, inlines: after });
    blocks[blockIndex] = { ...block, items: items.slice(0, MAX_LIST_ITEMS) };
    return {
      doc: { format: CAMPUS_RICH_FORMAT, blocks },
      caret: { blockIndex, itemIndex: at + 1, offset: 0 },
    };
  }

  const [before, after] = splitInlinesAt(block.inlines, offset);
  const head: RichBlock = block.type === "callout"
    ? { ...block, inlines: before }
    : { type: block.type, inlines: before };
  blocks.splice(blockIndex, 1, head, { type: "paragraph", inlines: after });
  return {
    doc: sanitizeRichDoc({ format: CAMPUS_RICH_FORMAT, blocks: blocks.slice(0, MAX_BLOCKS) }),
    caret: { blockIndex: blockIndex + 1, itemIndex: null, offset: 0 },
  };
}

/**
 * Colle du texte brut : les sauts simples restent dans le bloc,
 * une ligne vide crée un nouveau bloc.
 */
export function pastePlainText(
  doc: CampusRichDoc,
  blockIndex: number,
  itemIndex: number | null,
  offset: number,
  raw: string,
): { doc: CampusRichDoc; caret: RichLinePosition } {
  const paragraphs = clippedText(raw).split(/\n{2,}/);
  const inlines = lineInlines(doc, blockIndex, itemIndex);
  if (paragraphs.length <= 1) {
    const piece = paragraphs[0] ?? "";
    const next = insertTextAt(inlines, offset, piece);
    return {
      doc: setLineInlines(doc, blockIndex, itemIndex, next),
      caret: { blockIndex, itemIndex, offset: offset + piece.length },
    };
  }

  const [before, after] = splitInlinesAt(inlines, offset);
  let nextDoc = setLineInlines(
    doc,
    blockIndex,
    itemIndex,
    normalizeInlines([...before, { text: paragraphs[0]! }]),
  );
  let caret: RichLinePosition = {
    blockIndex,
    itemIndex,
    offset: inlinesPlainText(before).length + paragraphs[0]!.length,
  };

  for (let index = 1; index < paragraphs.length; index += 1) {
    const split = splitLine(nextDoc, caret.blockIndex, caret.itemIndex, caret.offset);
    nextDoc = split.doc;
    caret = split.caret;
    const chunk = paragraphs[index]!;
    const isLast = index === paragraphs.length - 1;
    const combined = isLast
      ? normalizeInlines([{ text: chunk }, ...after])
      : [{ text: chunk }];
    nextDoc = setLineInlines(nextDoc, caret.blockIndex, caret.itemIndex, combined);
    caret = { ...caret, offset: chunk.length };
  }

  return { doc: nextDoc, caret };
}

/**
 * Retour arrière en début de ligne vide : supprime la ligne et place le curseur
 * à la fin de la précédente. Ne laisse jamais le document sans ligne.
 */
export function removeLine(
  doc: CampusRichDoc,
  blockIndex: number,
  itemIndex: number | null,
): { doc: CampusRichDoc; caret: RichLinePosition } | null {
  const lines = richDocLines(doc);
  if (lines.length <= 1) return null;
  const position = lines.findIndex((line) => line.blockIndex === blockIndex && line.itemIndex === itemIndex);
  if (position <= 0) return null;
  const previous = lines[position - 1]!;

  const blocks = [...doc.blocks];
  const block = blocks[blockIndex];
  if (!block) return null;

  if (block.type === "bulletList" || block.type === "orderedList") {
    const items = block.items.filter((_, index) => index !== (itemIndex ?? 0));
    if (items.length) blocks[blockIndex] = { ...block, items };
    else blocks.splice(blockIndex, 1);
  } else if (block.type === "checklist") {
    const items = block.items.filter((_, index) => index !== (itemIndex ?? 0));
    if (items.length) blocks[blockIndex] = { ...block, items };
    else blocks.splice(blockIndex, 1);
  } else {
    blocks.splice(blockIndex, 1);
  }

  const nextDoc = sanitizeRichDoc({ format: CAMPUS_RICH_FORMAT, blocks });
  const target = richDocLines(nextDoc).find(
    (line) => line.blockIndex === Math.min(previous.blockIndex, nextDoc.blocks.length - 1),
  );
  const caretLine = target ?? richDocLines(nextDoc)[0]!;
  return {
    doc: nextDoc,
    caret: {
      blockIndex: caretLine.blockIndex,
      itemIndex: caretLine.itemIndex,
      offset: inlinesPlainText(caretLine.inlines).length,
    },
  };
}

function cloneBlock(block: RichBlock): RichBlock {
  return JSON.parse(JSON.stringify(block)) as RichBlock;
}

/** Extraie une ligne (bloc entier, ou un seul élément de liste) sans toucher au reste. */
function takeLine(
  doc: CampusRichDoc,
  blockIndex: number,
  itemIndex: number | null,
): { extracted: RichBlock; remaining: CampusRichDoc } | null {
  const blocks = doc.blocks.length ? [...doc.blocks] : [];
  const block = blocks[blockIndex];
  if (!block) return null;

  let extracted: RichBlock;
  if (block.type === "bulletList" || block.type === "orderedList") {
    const at = itemIndex ?? 0;
    const item = block.items[at];
    if (!item) return null;
    extracted = { type: block.type, items: [item.map((inline) => ({ ...inline, marks: inline.marks ? { ...inline.marks } : undefined }))] };
    const nextItems = block.items.filter((_, index) => index !== at);
    if (nextItems.length) blocks[blockIndex] = { ...block, items: nextItems };
    else blocks.splice(blockIndex, 1);
  } else if (block.type === "checklist") {
    const at = itemIndex ?? 0;
    const item = block.items[at];
    if (!item) return null;
    extracted = {
      type: "checklist",
      items: [{ checked: item.checked, inlines: item.inlines.map((inline) => ({ ...inline, marks: inline.marks ? { ...inline.marks } : undefined })) }],
    };
    const nextItems = block.items.filter((_, index) => index !== at);
    if (nextItems.length) blocks[blockIndex] = { ...block, items: nextItems };
    else blocks.splice(blockIndex, 1);
  } else {
    extracted = cloneBlock(block);
    blocks.splice(blockIndex, 1);
  }

  return {
    extracted,
    remaining: sanitizeRichDoc({ format: CAMPUS_RICH_FORMAT, blocks }),
  };
}

export function extractLine(
  doc: CampusRichDoc,
  blockIndex: number,
  itemIndex: number | null,
): { extracted: RichBlock; remaining: CampusRichDoc } | null {
  const taken = takeLine(doc, blockIndex, itemIndex);
  if (!taken || !blockHasText(taken.extracted)) return null;
  return taken;
}

/**
 * Supprime une ligne, y compris la première. S’il n’en reste aucune, document vide
 * (l’éditeur affiche alors un paragraphe vide).
 */
export function deleteLine(
  doc: CampusRichDoc,
  blockIndex: number,
  itemIndex: number | null,
): { doc: CampusRichDoc; caret: RichLinePosition } | null {
  const lines = richDocLines(doc);
  const position = lines.findIndex((line) => line.blockIndex === blockIndex && line.itemIndex === itemIndex);
  if (position < 0) return null;
  const taken = takeLine(doc, blockIndex, itemIndex);
  if (!taken) return null;
  const next = taken.remaining.blocks.length ? taken.remaining : emptyRichDoc();
  const nextLines = richDocLines(next);
  const caretLine = nextLines[Math.min(position, Math.max(0, nextLines.length - 1))] ?? nextLines[0];
  if (!caretLine) {
    return { doc: emptyRichDoc(), caret: { blockIndex: 0, itemIndex: null, offset: 0 } };
  }
  return {
    doc: next,
    caret: {
      blockIndex: caretLine.blockIndex,
      itemIndex: caretLine.itemIndex,
      offset: position === 0 ? 0 : inlinesPlainText(caretLine.inlines).length,
    },
  };
}

function mergeListBlocks(left: RichBlock, right: RichBlock): RichBlock | null {
  if (left.type === "checklist" && right.type === "checklist") {
    return { type: "checklist", items: [...left.items, ...right.items].slice(0, MAX_LIST_ITEMS) };
  }
  if (
    (left.type === "bulletList" || left.type === "orderedList") &&
    left.type === right.type
  ) {
    return { type: left.type, items: [...left.items, ...right.items].slice(0, MAX_LIST_ITEMS) };
  }
  return null;
}

/** Lignes visibles dans la colonne semaine (texte non vide). */
export function visibleRichDocLines(doc: CampusRichDoc): RichDocLine[] {
  return richDocLines(doc).filter((line) => line.inlines.length > 0);
}

function isListBlock(block: RichBlock): boolean {
  return block.type === "bulletList" || block.type === "orderedList" || block.type === "checklist";
}

function insertListItems(block: RichBlock, atItemIndex: number, incoming: RichBlock): RichBlock | null {
  if (block.type === "checklist" && incoming.type === "checklist") {
    const items = [...block.items];
    items.splice(Math.max(0, atItemIndex), 0, ...incoming.items);
    return { type: "checklist", items: items.slice(0, MAX_LIST_ITEMS) };
  }
  if ((block.type === "bulletList" || block.type === "orderedList") && incoming.type === block.type) {
    const items = [...block.items];
    items.splice(Math.max(0, atItemIndex), 0, ...incoming.items);
    return { type: block.type, items: items.slice(0, MAX_LIST_ITEMS) };
  }
  return null;
}

function splitListBlock(
  block: RichBlock,
  itemIndex: number,
): { before: RichBlock; after: RichBlock } | null {
  if (block.type === "checklist") {
    if (itemIndex <= 0 || itemIndex >= block.items.length) return null;
    return {
      before: { type: "checklist", items: block.items.slice(0, itemIndex) },
      after: { type: "checklist", items: block.items.slice(itemIndex) },
    };
  }
  if (block.type === "bulletList" || block.type === "orderedList") {
    if (itemIndex <= 0 || itemIndex >= block.items.length) return null;
    return {
      before: { type: block.type, items: block.items.slice(0, itemIndex) },
      after: { type: block.type, items: block.items.slice(itemIndex) },
    };
  }
  return null;
}

/** Ajoute un bloc en fin de document. Fusionne avec la dernière liste si le type est le même. */
export function appendBlock(doc: CampusRichDoc, block: RichBlock): CampusRichDoc {
  const incoming = cloneBlock(block);
  if (!blockHasText(incoming)) return sanitizeRichDoc(doc);
  const blocks = isEmptyRichDoc(doc) ? [] : [...sanitizeRichDoc(doc).blocks];
  const last = blocks[blocks.length - 1];
  const merged = last ? mergeListBlocks(last, incoming) : null;
  if (merged) blocks[blocks.length - 1] = merged;
  else blocks.push(incoming);
  return sanitizeRichDoc({ format: CAMPUS_RICH_FORMAT, blocks: blocks.slice(0, MAX_BLOCKS) });
}

function insertBeforeLine(doc: CampusRichDoc, incoming: RichBlock, next: RichDocLine): CampusRichDoc {
  const blocks = [...sanitizeRichDoc(doc).blocks];
  const nextBlock = blocks[next.blockIndex];
  if (!nextBlock) return appendBlock(doc, incoming);

  const lines = visibleRichDocLines({ format: CAMPUS_RICH_FORMAT, blocks });
  const nextPos = lines.findIndex(
    (line) => line.blockIndex === next.blockIndex && line.itemIndex === next.itemIndex,
  );
  const prev = nextPos > 0 ? lines[nextPos - 1] : undefined;
  const incomingIsList = isListBlock(incoming);

  if (incomingIsList && nextBlock.type === incoming.type && next.itemIndex != null) {
    const merged = insertListItems(nextBlock, next.itemIndex, incoming);
    if (merged) {
      blocks[next.blockIndex] = merged;
      return sanitizeRichDoc({ format: CAMPUS_RICH_FORMAT, blocks });
    }
  }

  if (incomingIsList && prev) {
    const prevBlock = blocks[prev.blockIndex];
    if (prevBlock && prevBlock.type === incoming.type && prev.itemIndex != null) {
      const merged = insertListItems(prevBlock, prev.itemIndex + 1, incoming);
      if (merged) {
        blocks[prev.blockIndex] = merged;
        return sanitizeRichDoc({ format: CAMPUS_RICH_FORMAT, blocks });
      }
    }
  }

  if (isListBlock(nextBlock) && next.itemIndex != null && next.itemIndex > 0) {
    const split = splitListBlock(nextBlock, next.itemIndex);
    if (split) {
      blocks.splice(next.blockIndex, 1, split.before, incoming, split.after);
      return sanitizeRichDoc({ format: CAMPUS_RICH_FORMAT, blocks: blocks.slice(0, MAX_BLOCKS) });
    }
  }

  blocks.splice(next.blockIndex, 0, incoming);
  return sanitizeRichDoc({ format: CAMPUS_RICH_FORMAT, blocks: blocks.slice(0, MAX_BLOCKS) });
}

/**
 * Insère un bloc à un emplacement de ligne (0 = début, lines.length = fin).
 * Une puce déposée au milieu d’une liste du même type s’y fond.
 */
export function insertBlockAt(doc: CampusRichDoc, block: RichBlock, atLineIndex: number): CampusRichDoc {
  const incoming = cloneBlock(block);
  if (!blockHasText(incoming)) return sanitizeRichDoc(doc);
  if (isEmptyRichDoc(doc)) {
    return sanitizeRichDoc({ format: CAMPUS_RICH_FORMAT, blocks: [incoming] });
  }
  const sanitized = sanitizeRichDoc(doc);
  const lines = visibleRichDocLines(sanitized);
  const at = Math.max(0, Math.min(atLineIndex, lines.length));
  if (at >= lines.length) return appendBlock(sanitized, incoming);
  return insertBeforeLine(sanitized, incoming, lines[at]!);
}

function placeExtractedBlock(target: CampusRichDoc, extracted: RichBlock, atLineIndex?: number): CampusRichDoc {
  if (atLineIndex == null) return appendBlock(target, extracted);
  return insertBlockAt(target, extracted, atLineIndex);
}

/** Déplace une ligne d’un document vers un autre (fin, ou emplacement donné). */
export function moveLineToDoc(
  source: CampusRichDoc,
  target: CampusRichDoc,
  blockIndex: number,
  itemIndex: number | null,
  atLineIndex?: number,
): { source: CampusRichDoc; target: CampusRichDoc } | null {
  const extracted = extractLine(source, blockIndex, itemIndex);
  if (!extracted) return null;
  return {
    source: extracted.remaining,
    target: placeExtractedBlock(target, extracted.extracted, atLineIndex),
  };
}

/** Copie une ligne vers un autre document, sans la retirer de la source. */
export function copyLineToDoc(
  source: CampusRichDoc,
  target: CampusRichDoc,
  blockIndex: number,
  itemIndex: number | null,
  atLineIndex?: number,
): CampusRichDoc | null {
  const extracted = extractLine(source, blockIndex, itemIndex);
  if (!extracted) return null;
  return placeExtractedBlock(target, extracted.extracted, atLineIndex);
}

/**
 * Réordonne une ligne dans le même document.
 * `atLineIndex` est l’emplacement parmi les lignes visibles avant le déplacement.
 * Un dépôt juste avant ou juste après la ligne elle-même est un no-op (même référence).
 */
export function moveLineWithinDoc(
  doc: CampusRichDoc,
  blockIndex: number,
  itemIndex: number | null,
  atLineIndex: number,
): CampusRichDoc | null {
  const lines = visibleRichDocLines(doc);
  const from = lines.findIndex((line) => line.blockIndex === blockIndex && line.itemIndex === itemIndex);
  if (from < 0) return null;
  if (atLineIndex === from || atLineIndex === from + 1) return doc;
  const extracted = extractLine(doc, blockIndex, itemIndex);
  if (!extracted) return null;
  const adjusted = from < atLineIndex ? atLineIndex - 1 : atLineIndex;
  return insertBlockAt(extracted.remaining, extracted.extracted, adjusted);
}

/** Index de la ligne après un déplacement interne, pour garder la sélection. */
export function lineIndexAfterMove(fromIndex: number, atLineIndex: number): number {
  return atLineIndex <= fromIndex ? atLineIndex : atLineIndex - 1;
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

function itemsFromBlock(block: RichBlock): RichInline[][] {
  if (block.type === "bulletList" || block.type === "orderedList") {
    return block.items.length ? block.items : [[]];
  }
  if (block.type === "checklist") {
    return block.items.length ? block.items.map((item) => item.inlines) : [[]];
  }
  return [block.inlines];
}

function flattenBlockInlines(block: RichBlock): RichInline[] {
  const items = itemsFromBlock(block);
  const inlines: RichInline[] = [];
  for (const item of items) {
    if (inlines.length && item.length) inlines.push({ text: " " });
    inlines.push(...item);
  }
  return inlines;
}

/** Convertit un bloc (titre, paragraphe, puces, numérotée, cases) sans perdre le texte. */
export function convertBlock(block: RichBlock, type: RichStructureType): RichBlock {
  if (type === "heading" || type === "paragraph") {
    return { type, inlines: flattenBlockInlines(block) };
  }
  if (type === "bulletList" || type === "orderedList") {
    return { type, items: itemsFromBlock(block) };
  }
  return {
    type: "checklist",
    items: itemsFromBlock(block).map((inlines) => ({ checked: false, inlines })),
  };
}

/**
 * Applique un type de paragraphe au bloc actif.
 * Un second clic sur le même type (sauf paragraphe) revient au paragraphe.
 */
function isListType(type: RichStructureType | RichBlock["type"]): boolean {
  return type === "bulletList" || type === "orderedList" || type === "checklist";
}

/**
 * Applique un type à la ligne active.
 * Sur une liste, passer à un titre ou un paragraphe n'extrait que la ligne visée :
 * le reste de la liste est conservé tel quel.
 */
export function applyStructureToLine(
  doc: CampusRichDoc,
  blockIndex: number,
  itemIndex: number | null,
  type: RichStructureType,
): { doc: CampusRichDoc; caret: RichLinePosition } {
  const blocks = doc.blocks.length ? [...doc.blocks] : [{ type: "paragraph" as const, inlines: [] }];
  const index = Math.min(Math.max(0, blockIndex), blocks.length - 1);
  const block = blocks[index] ?? { type: "paragraph" as const, inlines: [] };

  const sameType = block.type === type;
  const target: RichStructureType = sameType && type !== "paragraph" ? "paragraph" : type;

  if (isListType(block.type) && !isListType(target) && itemIndex != null) {
    const items = itemsFromBlock(block);
    const before = items.slice(0, itemIndex);
    const after = items.slice(itemIndex + 1);
    const extracted: RichBlock = target === "heading"
      ? { type: "heading", inlines: items[itemIndex] ?? [] }
      : { type: "paragraph", inlines: items[itemIndex] ?? [] };

    const replacement: RichBlock[] = [];
    if (before.length) replacement.push(listBlockOfType(block, before));
    replacement.push(extracted);
    if (after.length) replacement.push(listBlockOfType(block, after));

    blocks.splice(index, 1, ...replacement);
    return {
      doc: sanitizeRichDoc({ format: CAMPUS_RICH_FORMAT, blocks: blocks.slice(0, MAX_BLOCKS) }),
      caret: { blockIndex: before.length ? index + 1 : index, itemIndex: null, offset: 0 },
    };
  }

  blocks[index] = convertBlock(block, target);
  const nextDoc = sanitizeRichDoc({ format: CAMPUS_RICH_FORMAT, blocks });
  const caretItem = isListType(target) ? Math.min(itemIndex ?? 0, MAX_LIST_ITEMS - 1) : null;
  return {
    doc: nextDoc,
    caret: { blockIndex: index, itemIndex: isListType(target) ? (caretItem ?? 0) : null, offset: 0 },
  };
}

function listBlockOfType(source: RichBlock, items: RichInline[][]): RichBlock {
  if (source.type === "checklist") {
    return { type: "checklist", items: items.map((inlines) => ({ checked: false, inlines })) };
  }
  if (source.type === "orderedList") return { type: "orderedList", items };
  return { type: "bulletList", items };
}

export function applyStructureToDoc(
  doc: CampusRichDoc,
  blockIndex: number,
  type: RichStructureType,
): CampusRichDoc {
  const blocks = doc.blocks.length ? [...doc.blocks] : [{ type: "paragraph" as const, inlines: [] }];
  const index = Math.min(Math.max(0, blockIndex), blocks.length - 1);
  const current = blocks[index] ?? { type: "paragraph" as const, inlines: [] };
  blocks[index] = current.type === type && type !== "paragraph"
    ? convertBlock(current, "paragraph")
    : convertBlock(current, type);
  return sanitizeRichDoc({ format: CAMPUS_RICH_FORMAT, blocks });
}
