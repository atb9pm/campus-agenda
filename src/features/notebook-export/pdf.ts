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
import { summaryLinesForSession } from "./summary.ts";

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 50;
const NAVY = rgb(29 / 255, 53 / 255, 87 / 255);
const MUTED = rgb(81 / 255, 101 / 255, 130 / 255);
const RULE = rgb(210 / 255, 218 / 255, 230 / 255);
const BLACK = rgb(0.12, 0.14, 0.18);

function winAnsi(text: string): string {
  return text
    .replace(/[•●]/g, "-")
    .replace(/[—–]/g, "-")
    .replace(/[’‘]/g, "'")
    .replace(/[“”«»]/g, '"')
    .replace(/[☑✓]/g, "[x]")
    .replace(/[☐□]/g, "[ ]")
    .replace(/[^\u0009\u000A\u000D\u0020-\u007E\u00A0-\u00FF]/g, "?");
}

async function loadLogo(): Promise<Uint8Array | null> {
  try {
    return new Uint8Array(await readFile(new URL("../../../web/public/branding/campus-agenda-logo.png", import.meta.url)));
  } catch {
    return null;
  }
}

function wrap(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const words = winAnsi(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    current = word;
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function colorFromHex(hex: string) {
  const { r, g, b } = hexToRgbParts(hex);
  return rgb(r, g, b);
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

  contentWidth(): number {
    return PAGE_WIDTH - MARGIN * 2;
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

  drawText(text: string, options: { size: number; font?: PDFFont; color?: ReturnType<typeof rgb>; gap?: number; href?: string }): void {
    if (!this.page) return;
    const font = options.font ?? this.regular;
    const size = options.size;
    for (const line of wrap(font, text, size, this.contentWidth())) {
      if (this.remaining() < size + 2) {
        this.addPage("content");
      }
      const y = this.y - size;
      this.page!.drawText(line, {
        x: MARGIN,
        y,
        size,
        font,
        color: options.color ?? BLACK,
      });
      if (options.href) this.link(options.href, MARGIN, y, font.widthOfTextAtSize(line, size), size + 2);
      this.y -= size + 3;
    }
    this.y -= options.gap ?? 4;
  }

  measure(text: string, marks: NotebookExportRun["marks"] | undefined, size: number, forceBold: boolean): number {
    return this.font(fontKindForMarks(marks, forceBold)).widthOfTextAtSize(winAnsi(text), size);
  }

  wrapRuns(prefix: NotebookExportRun[], runs: readonly NotebookExportRun[], size: number, forceBold: boolean): NotebookExportRun[][] {
    const maxWidth = this.contentWidth();
    const tokens: NotebookExportRun[] = [];
    for (const run of [...prefix, ...runs]) {
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

  paintRun(run: NotebookExportRun, x: number, baseline: number, size: number, forceBold: boolean): number {
    if (!this.page) return 0;
    const text = winAnsi(run.text);
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
    options: { size: number; gap?: number; prefix?: NotebookExportRun[]; forceBold?: boolean },
  ): void {
    if (!this.page) return;
    const size = options.size;
    const forceBold = Boolean(options.forceBold);
    for (const row of this.wrapRuns(options.prefix ?? [], runs, size, forceBold)) {
      if (this.remaining() < size + 4) this.addPage("content");
      const baseline = this.y - size;
      let x = MARGIN;
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
    this.y -= 10;
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

  section(title: string): void {
    this.drawText(title, { size: 9, font: this.bold, color: NAVY, gap: 6 });
  }

  rich(lines: readonly NotebookExportRichLine[]): void {
    for (const line of lines) {
      if (line.kind === "heading") {
        this.drawRuns(line.runs, { size: 11, gap: 4, forceBold: true });
      } else if (line.kind === "bullet") {
        this.drawRuns(line.runs, { size: 10, gap: 3, prefix: [{ text: "- " }] });
      } else if (line.kind === "ordered") {
        this.drawRuns(line.runs, { size: 10, gap: 3, prefix: [{ text: `${line.order ?? 1}. ` }] });
      } else if (line.kind === "check") {
        this.drawRuns(line.runs, { size: 10, gap: 3, prefix: [{ text: `${line.checked ? "[x]" : "[ ]"} ` }] });
      } else if (line.kind === "callout") {
        this.drawRuns(line.runs, { size: 10, gap: 3 });
      } else {
        this.drawRuns(line.runs, { size: 10, gap: 3 });
      }
    }
  }

  sessionSummary(block: NotebookExportSessionBlock): void {
    const lines = summaryLinesForSession(block);
    this.ensure(16 * lines.length + 10);
    const header = lines[0] ?? "";
    this.drawText(header, { size: 10, font: this.bold, color: NAVY, gap: 2 });
    for (const line of lines.slice(1)) {
      this.drawText(line, { size: 9, color: BLACK, gap: 1 });
    }
    this.y -= 8;
  }

  sessionDetailed(block: NotebookExportSessionBlock): void {
    this.ensure(72);
    this.drawText(block.weekLabel.toUpperCase(), { size: 13, font: this.bold, color: NAVY, gap: 2 });
    this.drawText(block.longDateLabel, { size: 10, color: MUTED, gap: 8 });
    this.rule();
    if (block.publications.length) {
      this.section("PUBLICATION ÉLÈVES");
      this.rich(block.publications);
      this.y -= 4;
    }
    if (block.controls.length) {
      this.section("CONTRÔLE");
      for (const title of block.controls) this.drawText(title, { size: 10, gap: 3 });
      this.y -= 4;
    }
    if (block.notes.length) {
      this.section("NOTES PROF");
      this.rich(block.notes);
      this.y -= 4;
    }
    this.y -= 8;
  }

  unmatchedControls(controls: readonly NotebookExportUnmatchedControl[], layout: NotebookExportDocument["layout"]): void {
    if (!controls.length) return;
    this.ensure(48);
    if (layout === "detailed") {
      this.section(NOTEBOOK_EXPORT_UNMATCHED_CONTROLS_TITLE.toUpperCase());
      for (const control of controls) {
        const line = control.dateLabel ? `${control.title}  ·  ${control.dateLabel}` : control.title;
        this.drawText(line, { size: 10, gap: 3 });
      }
      this.y -= 8;
      return;
    }
    this.drawText(NOTEBOOK_EXPORT_UNMATCHED_CONTROLS_TITLE, { size: 10, font: this.bold, color: NAVY, gap: 2 });
    for (const control of controls) {
      const line = control.dateLabel
        ? `Contrôle — ${control.title}  ·  ${control.dateLabel}`
        : `Contrôle — ${control.title}`;
      this.drawText(line, { size: 9, color: BLACK, gap: 1 });
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
    if (document.layout === "detailed") writer.sessionDetailed(session);
    else writer.sessionSummary(session);
  }
  writer.unmatchedControls(document.unmatchedControls, document.layout);
  writer.footers();
  return pdf.save();
}
