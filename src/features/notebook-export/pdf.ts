import { readFile } from "node:fs/promises";
import {
  PDFDocument,
  PDFString,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";

import { RICH_TEXT_COLOR_HEX } from "../class-notebook/rich-doc.ts";
import { normalizeExportControlChars, splitRunsOnNewlines } from "./rich-lines.ts";
import {
  formatNotebookExportCoverage,
  NOTEBOOK_EXPORT_UNMATCHED_CONTROLS_TITLE,
  type NotebookExportDocument,
  type NotebookExportRichLine,
  type NotebookExportRun,
  type NotebookExportSessionBlock,
  type NotebookExportUnmatchedControl,
} from "./types.ts";
import {
  colorHexForMarks,
  fontKindForMarks,
  hexToRgbParts,
  highlightHexForMarks,
  hrefForMarks,
  underlineForMarks,
  type NotebookExportFontKind,
} from "./rich-style.ts";

export const PDF_EXPORT_PAGE_WIDTH = 595.28;
export const PDF_EXPORT_MARGIN = 50;
const PAGE_WIDTH = PDF_EXPORT_PAGE_WIDTH;
const PAGE_HEIGHT = 841.89;
const MARGIN = PDF_EXPORT_MARGIN;
const NAVY = rgb(29 / 255, 53 / 255, 87 / 255);
const MUTED = rgb(81 / 255, 101 / 255, 130 / 255);
const RULE = rgb(210 / 255, 218 / 255, 230 / 255);
const BLACK = rgb(0.12, 0.14, 0.18);
const CHIP_BG = rgb(238 / 255, 243 / 255, 251 / 255);
const NOTE_RAIL = rgb(210 / 255, 218 / 255, 230 / 255);
const CONTROL_RED = rgb(
  Number.parseInt(RICH_TEXT_COLOR_HEX.red.slice(1, 3), 16) / 255,
  Number.parseInt(RICH_TEXT_COLOR_HEX.red.slice(3, 5), 16) / 255,
  Number.parseInt(RICH_TEXT_COLOR_HEX.red.slice(5, 7), 16) / 255,
);
const CONTROL_RED_MUTED = rgb(155 / 255, 55 / 255, 50 / 255);
const SESSION_MIN_HEIGHT = 86;
const CONTROL_COLUMN_MAX = 280;

export function winAnsi(text: string): string {
  return normalizeExportControlChars(text)
    .replace(/\n/g, "")
    .replace(/[•●]/g, "-")
    .replace(/[—–]/g, "-")
    .replace(/[’‘]/g, "'")
    .replace(/[“”«»]/g, '"')
    .replace(/[☑✓]/g, "[x]")
    .replace(/[☐□]/g, "[ ]")
    .replace(/[^\u0020-\u007E\u00A0-\u00FF]/g, "?");
}

async function loadLogo(): Promise<Uint8Array | null> {
  try {
    return new Uint8Array(await readFile(new URL("../../../web/public/branding/campus-agenda-logo.png", import.meta.url)));
  } catch {
    return null;
  }
}

export function splitPlainTextLines(text: string): string[] {
  return normalizeExportControlChars(text).split("\n");
}

export function controlLineX(lineWidth: number, maxWidth: number): number {
  const capped = Math.min(Math.max(0, lineWidth), Math.max(0, maxWidth));
  return Math.max(MARGIN, PAGE_WIDTH - MARGIN - capped);
}

function wrapFittedWord(font: PDFFont, word: string, size: number, maxWidth: number): string[] {
  const safe = winAnsi(word);
  if (!safe) return [];
  if (font.widthOfTextAtSize(safe, size) <= maxWidth) return [safe];
  const chunks: string[] = [];
  let current = "";
  for (const char of safe) {
    const next = current + char;
    if (current && font.widthOfTextAtSize(next, size) > maxWidth) {
      chunks.push(current);
      current = char;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function wrap(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const words = winAnsi(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  const flush = () => {
    if (current) lines.push(current);
    current = "";
  };
  for (const word of words) {
    const pieces = wrapFittedWord(font, word, size, maxWidth);
    for (const piece of pieces) {
      const next = current ? `${current} ${piece}` : piece;
      if (current && font.widthOfTextAtSize(next, size) > maxWidth) {
        flush();
        current = piece;
      } else {
        current = next;
      }
    }
  }
  flush();
  return lines.length ? lines : [""];
}

export function wrapControlPlainText(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const width = Math.max(1, maxWidth);
  const rows: string[] = [];
  for (const hard of splitPlainTextLines(text)) {
    if (!hard) {
      rows.push("");
      continue;
    }
    rows.push(...wrap(font, hard, size, width));
  }
  return rows.length ? rows : [""];
}

function colorFromHex(hex: string) {
  const { r, g, b } = hexToRgbParts(hex);
  return rgb(r, g, b);
}

function sessionHeading(block: NotebookExportSessionBlock): string {
  return `${block.weekLabel.replace(/^Sem\b/i, "SEM").toUpperCase()} · ${block.dateLabel.toUpperCase()}`;
}

class PdfWriter {
  doc: PDFDocument;
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  boldItalic: PDFFont;
  logo: PDFImage | null;
  header: string;
  skipFirstFooter: boolean;
  pages: PDFPage[] = [];
  page: PDFPage | null = null;
  y = 0;

  constructor(
    doc: PDFDocument,
    regular: PDFFont,
    bold: PDFFont,
    italic: PDFFont,
    boldItalic: PDFFont,
    logo: PDFImage | null,
    header: string,
    skipFirstFooter: boolean,
  ) {
    this.doc = doc;
    this.regular = regular;
    this.bold = bold;
    this.italic = italic;
    this.boldItalic = boldItalic;
    this.logo = logo;
    this.header = header;
    this.skipFirstFooter = skipFirstFooter;
  }

  contentWidth(indent = 0): number {
    return PAGE_WIDTH - MARGIN * 2 - indent;
  }

  font(kind: NotebookExportFontKind): PDFFont {
    if (kind === "boldItalic") return this.boldItalic;
    if (kind === "bold") return this.bold;
    if (kind === "italic") return this.italic;
    return this.regular;
  }

  addPage(kind: "cover" | "content"): void {
    this.page = this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.pages.push(this.page);
    if (kind === "cover") {
      this.y = PAGE_HEIGHT - 72;
      return;
    }
    this.page.drawText(winAnsi(this.header), {
      x: MARGIN,
      y: PAGE_HEIGHT - 36,
      size: 8,
      font: this.regular,
      color: MUTED,
    });
    this.page.drawLine({
      start: { x: MARGIN, y: PAGE_HEIGHT - 42 },
      end: { x: PAGE_WIDTH - MARGIN, y: PAGE_HEIGHT - 42 },
      thickness: 0.4,
      color: RULE,
    });
    this.y = PAGE_HEIGHT - 58;
  }

  remaining(): number {
    return this.y - (MARGIN + 28);
  }

  ensure(height: number): void {
    if (!this.page || this.remaining() < height) {
      this.addPage("content");
    }
  }

  link(href: string, x: number, y: number, width: number, height: number): void {
    if (!this.page) return;
    const uri = href.trim();
    if (!/^https?:\/\//i.test(uri)) return;
    const annot = this.doc.context.register(
      this.doc.context.obj({
        Type: "Annot",
        Subtype: "Link",
        Rect: [x, y, x + Math.max(width, 8), y + height],
        Border: [0, 0, 0],
        A: { Type: "Action", S: "URI", URI: PDFString.of(uri) },
      }),
    );
    this.page.node.addAnnot(annot);
  }

  drawText(
    text: string,
    options: { size: number; font?: PDFFont; color?: ReturnType<typeof rgb>; gap?: number; href?: string; indent?: number },
  ): void {
    if (!this.page) return;
    const font = options.font ?? this.regular;
    const size = options.size;
    const indent = options.indent ?? 0;
    for (const line of wrap(font, text, size, this.contentWidth(indent))) {
      if (this.remaining() < size + 2) {
        this.addPage("content");
      }
      const y = this.y - size;
      this.page!.drawText(line, {
        x: MARGIN + indent,
        y,
        size,
        font,
        color: options.color ?? BLACK,
      });
      if (options.href) this.link(options.href, MARGIN + indent, y, font.widthOfTextAtSize(line, size), size + 2);
      this.y -= size + 3;
    }
    this.y -= options.gap ?? 4;
  }

  measure(text: string, marks: NotebookExportRun["marks"] | undefined, size: number, forceBold: boolean): number {
    const safe = winAnsi(text);
    if (!safe) return 0;
    return this.font(fontKindForMarks(marks, forceBold)).widthOfTextAtSize(safe, size);
  }

  wrapSoft(runs: readonly NotebookExportRun[], size: number, forceBold: boolean, indent: number): NotebookExportRun[][] {
    const maxWidth = this.contentWidth(indent);
    const tokens: NotebookExportRun[] = [];
    for (const run of runs) {
      const text = winAnsi(run.text);
      const parts = text.split(/(\s+)/);
      for (const part of parts) {
        if (!part) continue;
        tokens.push(run.marks ? { text: part, marks: run.marks } : { text: part });
      }
    }
    const rows: NotebookExportRun[][] = [];
    let current: NotebookExportRun[] = [];
    let width = 0;
    const pushRow = () => {
      if (current.length) rows.push(current);
      current = [];
      width = 0;
    };
    for (const token of tokens) {
      const tokenWidth = this.measure(token.text, token.marks, size, forceBold);
      if (current.length && width + tokenWidth > maxWidth && token.text.trim()) {
        pushRow();
      }
      if (!current.length && !token.text.trim()) continue;
      current.push(token);
      width += tokenWidth;
    }
    pushRow();
    return rows.length ? rows : [[{ text: "" }]];
  }

  wrapRuns(
    prefix: NotebookExportRun[],
    runs: readonly NotebookExportRun[],
    size: number,
    forceBold: boolean,
    indent = 0,
  ): NotebookExportRun[][] {
    const hardRows = splitRunsOnNewlines([...prefix, ...runs]);
    const wrapped: NotebookExportRun[][] = [];
    for (const hard of hardRows) {
      if (!hard.length) {
        wrapped.push([{ text: "" }]);
        continue;
      }
      wrapped.push(...this.wrapSoft(hard, size, forceBold, indent));
    }
    return wrapped.length ? wrapped : [[{ text: "" }]];
  }

  paintRun(run: NotebookExportRun, x: number, baseline: number, size: number, forceBold: boolean): number {
    if (!this.page) return 0;
    const text = winAnsi(run.text);
    if (!text) return 0;
    const font = this.font(fontKindForMarks(run.marks, forceBold));
    const width = font.widthOfTextAtSize(text, size);
    const highlight = highlightHexForMarks(run.marks);
    if (highlight && text.trim()) {
      this.page.drawRectangle({
        x,
        y: baseline - 1.5,
        width,
        height: size + 2,
        color: colorFromHex(highlight),
        opacity: 0.7,
      });
    }
    const colorHex = colorHexForMarks(run.marks);
    this.page.drawText(text, {
      x,
      y: baseline,
      size,
      font,
      color: colorHex ? colorFromHex(colorHex) : BLACK,
    });
    if (underlineForMarks(run.marks) || hrefForMarks(run.marks)) {
      this.page.drawLine({
        start: { x, y: baseline - 1.2 },
        end: { x: x + width, y: baseline - 1.2 },
        thickness: 0.6,
        color: colorHex ? colorFromHex(colorHex) : NAVY,
      });
    }
    const href = hrefForMarks(run.marks);
    if (href) this.link(href, x, baseline - 1, width, size + 2);
    return width;
  }

  drawRuns(
    runs: readonly NotebookExportRun[],
    options: {
      size: number;
      gap?: number;
      prefix?: NotebookExportRun[];
      forceBold?: boolean;
      indent?: number;
      rail?: boolean;
    },
  ): void {
    if (!this.page) return;
    const size = options.size;
    const forceBold = Boolean(options.forceBold);
    const indent = options.indent ?? 0;
    for (const row of this.wrapRuns(options.prefix ?? [], runs, size, forceBold, indent)) {
      if (this.remaining() < size + 4) this.addPage("content");
      const baseline = this.y - size;
      if (options.rail) {
        this.page!.drawRectangle({
          x: MARGIN,
          y: baseline - 2,
          width: 2,
          height: size + 4,
          color: NOTE_RAIL,
        });
      }
      let x = MARGIN + indent;
      for (const run of row) {
        x += this.paintRun(run, x, baseline, size, forceBold);
      }
      this.y -= size + 3;
    }
    this.y -= options.gap ?? 4;
  }

  rule(): void {
    if (!this.page) return;
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: PAGE_WIDTH - MARGIN, y: this.y },
      thickness: 0.4,
      color: RULE,
    });
    this.y -= 12;
  }

  cover(document: NotebookExportDocument): void {
    this.addPage("cover");
    if (this.logo && this.page) {
      const maxWidth = 120;
      const scale = maxWidth / this.logo.width;
      const width = this.logo.width * scale;
      const height = this.logo.height * scale;
      this.page.drawImage(this.logo, {
        x: (PAGE_WIDTH - width) / 2,
        y: this.y - height,
        width,
        height,
      });
      this.y -= height + 18;
    }
    this.drawText("CAMPUS AGENDA", { size: 11, font: this.bold, color: NAVY, gap: 8 });
    this.drawText("CARNET ANNUEL", { size: 22, font: this.bold, color: NAVY, gap: 22 });
    this.field("Classe", document.classLabel || document.classCode);
    this.field("Cours", document.branchLabel);
    this.field("Année scolaire", document.schoolYearLabel);
    this.field("Enseignant", document.teacherName);
    this.field("Horaire", document.scheduleSummary);
    this.y -= 8;
    this.drawText(formatNotebookExportCoverage(document), { size: 10, color: MUTED, gap: 24 });
    this.y = MARGIN + 36;
    this.drawText("Document généré avec Campus Agenda", { size: 9, color: MUTED, gap: 2 });
    this.drawText(document.generatedOn, { size: 9, color: MUTED, gap: 0 });
  }

  field(label: string, value: string): void {
    this.drawText(`${label} :`, { size: 8, color: MUTED, gap: 1 });
    this.drawText(value, { size: 12, font: this.bold, color: NAVY, gap: 10 });
  }

  section(title: string, indent = 0): void {
    this.drawText(title, { size: 8, font: this.bold, color: NAVY, gap: 6, indent });
  }

  chip(label: string): void {
    if (!this.page || !label.trim()) return;
    const size = 8;
    const paddingX = 6;
    const paddingY = 3;
    const text = winAnsi(label.toUpperCase());
    const lines = wrap(this.bold, text, size, this.contentWidth() - paddingX * 2);
    const widths = lines.map((line) => this.bold.widthOfTextAtSize(line, size));
    const boxWidth = Math.min(Math.max(...widths) + paddingX * 2, this.contentWidth());
    const boxHeight = lines.length * (size + 2) + paddingY * 2;
    this.ensure(boxHeight + 10);
    this.page.drawRectangle({
      x: MARGIN,
      y: this.y - boxHeight,
      width: boxWidth,
      height: boxHeight,
      color: CHIP_BG,
    });
    lines.forEach((line, index) => {
      this.page!.drawText(line, {
        x: MARGIN + paddingX,
        y: this.y - paddingY - size - index * (size + 2),
        size,
        font: this.bold,
        color: NAVY,
      });
    });
    this.y -= boxHeight + 10;
  }

  drawControlText(
    text: string,
    options: {
      size: number;
      font: PDFFont;
      color: ReturnType<typeof rgb>;
      maxWidth: number;
      gap?: number;
      firstBaseline?: number;
    },
  ): void {
    if (!this.page) return;
    const size = options.size;
    const maxWidth = Math.max(1, options.maxWidth);
    const rows = wrapControlPlainText(options.font, text, size, maxWidth);
    rows.forEach((row, index) => {
      if (this.remaining() < size + 4) this.addPage("content");
      const baseline = index === 0 && options.firstBaseline != null ? options.firstBaseline : this.y - size;
      const safe = winAnsi(row);
      if (safe) {
        const width = options.font.widthOfTextAtSize(safe, size);
        const x = controlLineX(width, maxWidth);
        this.page!.drawText(safe, {
          x,
          y: baseline,
          size,
          font: options.font,
          color: options.color,
        });
      }
      this.y = baseline - 3;
    });
    this.y -= options.gap ?? 2;
  }

  sessionHeader(block: NotebookExportSessionBlock): void {
    const header = winAnsi(sessionHeading(block));
    const size = 10;
    const headerWidth = this.bold.widthOfTextAtSize(header, size);
    const headerBaseline = this.y - size;
    this.page!.drawText(header, {
      x: MARGIN,
      y: headerBaseline,
      size,
      font: this.bold,
      color: NAVY,
    });
    this.y = headerBaseline - 3;

    const titles = block.controls.map((entry) => (entry.title.trim() || "Contrôle").toUpperCase());
    const gap = 16;
    const remaining = this.contentWidth() - headerWidth - gap;
    const columnWidth = Math.min(CONTROL_COLUMN_MAX, this.contentWidth());
    const joined = titles.join(" · ");
    const sameLineWidth = Math.min(remaining, columnWidth);
    const sameLineRows =
      titles.length && remaining >= 64 ? wrapControlPlainText(this.bold, joined, size, sameLineWidth) : [];
    const titleFitsBesideHeader = sameLineRows.length === 1 && Boolean(sameLineRows[0]);

    if (titleFitsBesideHeader) {
      this.y = headerBaseline + size;
      this.drawControlText(joined, {
        size,
        font: this.bold,
        color: CONTROL_RED,
        maxWidth: sameLineWidth,
        firstBaseline: headerBaseline,
        gap: 2,
      });
    } else if (titles.length) {
      for (const title of titles) {
        this.drawControlText(title, {
          size,
          font: this.bold,
          color: CONTROL_RED,
          maxWidth: columnWidth,
          gap: 1,
        });
      }
    }

    for (const control of block.controls) {
      if (!control.detail) continue;
      this.drawControlText(control.detail, {
        size: 8,
        font: this.regular,
        color: CONTROL_RED_MUTED,
        maxWidth: columnWidth,
        gap: 2,
      });
    }
    this.y -= 2;
  }

  rich(
    lines: readonly NotebookExportRichLine[],
    options: { indent?: number; rail?: boolean } = {},
  ): void {
    const indent = options.indent ?? 0;
    for (const line of lines) {
      if (line.kind === "heading") {
        this.drawRuns(line.runs, { size: 11, gap: 4, forceBold: true, indent, rail: options.rail });
      } else if (line.kind === "bullet") {
        this.drawRuns(line.runs, { size: 10, gap: 3, prefix: [{ text: "- " }], indent, rail: options.rail });
      } else if (line.kind === "ordered") {
        this.drawRuns(line.runs, {
          size: 10,
          gap: 3,
          prefix: [{ text: `${line.order ?? 1}. ` }],
          indent,
          rail: options.rail,
        });
      } else if (line.kind === "check") {
        this.drawRuns(line.runs, {
          size: 10,
          gap: 3,
          prefix: [{ text: `${line.checked ? "[x]" : "[ ]"} ` }],
          indent,
          rail: options.rail,
        });
      } else {
        this.drawRuns(line.runs, { size: 10, gap: 3, indent, rail: options.rail });
      }
    }
  }

  renderSession(block: NotebookExportSessionBlock, branchLabel: string): void {
    this.ensure(SESSION_MIN_HEIGHT);
    this.sessionHeader(block);
    this.chip(branchLabel);
    if (block.publications.length) {
      this.section("PUBLICATION ÉLÈVES");
      this.rich(block.publications);
      this.y -= 6;
    }
    if (block.notes.length) {
      this.section("NOTES PROFESSEUR", 10);
      this.rich(block.notes, { indent: 10, rail: true });
      this.y -= 4;
    }
    this.rule();
  }

  unmatchedControls(controls: readonly NotebookExportUnmatchedControl[]): void {
    if (!controls.length) return;
    this.ensure(48);
    this.section(NOTEBOOK_EXPORT_UNMATCHED_CONTROLS_TITLE);
    for (const control of controls) {
      const title = control.title.trim() || "Contrôle";
      this.drawText(title.toUpperCase(), { size: 10, font: this.bold, color: CONTROL_RED, gap: 1 });
      if (control.detail) this.drawText(control.detail, { size: 8, color: CONTROL_RED_MUTED, gap: 1 });
      if (control.dateLabel) this.drawText(control.dateLabel, { size: 8, color: MUTED, gap: 6 });
      else this.y -= 4;
    }
    this.y -= 8;
  }

  footers(): void {
    const total = this.pages.length;
    this.pages.forEach((page, index) => {
      if (this.skipFirstFooter && index === 0) return;
      page.drawLine({
        start: { x: MARGIN, y: 32 },
        end: { x: PAGE_WIDTH - MARGIN, y: 32 },
        thickness: 0.4,
        color: RULE,
      });
      page.drawText("Campus Agenda", {
        x: MARGIN,
        y: 18,
        size: 8,
        font: this.regular,
        color: MUTED,
      });
      const label = `Page ${index + 1} / ${total}`;
      const width = this.regular.widthOfTextAtSize(label, 8);
      page.drawText(label, {
        x: PAGE_WIDTH - MARGIN - width,
        y: 18,
        size: 8,
        font: this.regular,
        color: MUTED,
      });
    });
  }
}

export async function renderNotebookExportPdf(document: NotebookExportDocument): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const boldItalic = await pdf.embedFont(StandardFonts.HelveticaBoldOblique);
  const logoBytes = await loadLogo();
  const logo = logoBytes ? await pdf.embedPng(logoBytes).catch(() => null) : null;
  const header = `${document.classCode} · ${document.branchLabel} · ${document.schoolYearLabel}`;
  const writer = new PdfWriter(pdf, regular, bold, italic, boldItalic, logo, header, document.coverPage);
  if (document.coverPage) writer.cover(document);
  if (!writer.page || document.coverPage) writer.addPage("content");
  for (const session of document.sessions) {
    writer.renderSession(session, document.branchLabel);
  }
  writer.unmatchedControls(document.unmatchedControls);
  writer.footers();
  return pdf.save();
}
