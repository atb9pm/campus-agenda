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

import type { NotebookExportDocument, NotebookExportRichLine, NotebookExportSessionBlock } from "./types.ts";

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
  const candidates = [
    new URL("../../../web/public/branding/campus-agenda-logo.png", import.meta.url),
  ];
  for (const url of candidates) {
    try {
      return new Uint8Array(await readFile(url));
    } catch {
      // try next
    }
  }
  return null;
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

class PdfWriter {
  doc: PDFDocument;
  regular: PDFFont;
  bold: PDFFont;
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
    logo: PDFImage | null,
    header: string,
    skipFirstFooter: boolean,
  ) {
    this.doc = doc;
    this.regular = regular;
    this.bold = bold;
    this.logo = logo;
    this.header = header;
    this.skipFirstFooter = skipFirstFooter;
  }

  contentWidth(): number {
    return PAGE_WIDTH - MARGIN * 2;
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
    this.drawText(
      `${document.sessionCount} séance${document.sessionCount > 1 ? "s" : ""}  ·  ${document.publicationCount} publication${document.publicationCount > 1 ? "s" : ""} élèves  ·  ${document.controlCount} contrôle${document.controlCount > 1 ? "s" : ""}`,
      { size: 10, color: MUTED, gap: 24 },
    );
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
        this.drawText(line.text, { size: 11, font: this.bold, gap: 4, href: line.href });
      } else if (line.kind === "bullet") {
        this.drawText(`- ${line.text}`, { size: 10, gap: 3, href: line.href });
      } else if (line.kind === "ordered") {
        this.drawText(`${line.order ?? 1}. ${line.text}`, { size: 10, gap: 3, href: line.href });
      } else if (line.kind === "check") {
        this.drawText(`${line.checked ? "[x]" : "[ ]"} ${line.text}`, { size: 10, gap: 3, href: line.href });
      } else if (line.kind === "callout") {
        this.drawText(line.text, { size: 10, font: this.bold, gap: 3, href: line.href });
      } else {
        this.drawText(line.text, { size: 10, gap: 3, href: line.href });
      }
      if (line.href) this.drawText(line.href, { size: 8, color: MUTED, gap: 4, href: line.href });
    }
  }

  session(block: NotebookExportSessionBlock, detailed: boolean): void {
    this.ensure(72);
    if (detailed) {
      this.drawText(block.weekLabel.toUpperCase(), { size: 13, font: this.bold, color: NAVY, gap: 2 });
      this.drawText(block.longDateLabel, { size: 10, color: MUTED, gap: 8 });
      this.rule();
    } else {
      this.drawText(`${block.weekLabel} - ${block.dateLabel}`, { size: 11, font: this.bold, color: NAVY, gap: 8 });
    }
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
  const logoBytes = await loadLogo();
  const logo = logoBytes ? await pdf.embedPng(logoBytes).catch(() => null) : null;
  const header = `${document.classCode} · ${document.branchLabel} · ${document.schoolYearLabel}`;
  const writer = new PdfWriter(pdf, regular, bold, logo, header, document.coverPage);
  if (document.coverPage) writer.cover(document);
  if (!writer.page || document.coverPage) writer.addPage("content");
  for (const session of document.sessions) {
    writer.session(session, document.layout === "detailed");
  }
  writer.footers();
  return pdf.save();
}
