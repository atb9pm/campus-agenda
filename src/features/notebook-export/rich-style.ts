import {
  RICH_HIGHLIGHT_HEX,
  RICH_TEXT_COLOR_HEX,
  type RichMarks,
  type RichTextColorId,
} from "../class-notebook/rich-doc.ts";

export type NotebookExportFontKind = "regular" | "bold" | "italic" | "boldItalic";

export function fontKindForMarks(marks?: RichMarks, forceBold = false): NotebookExportFontKind {
  const bold = Boolean(marks?.bold || forceBold);
  const italic = Boolean(marks?.italic);
  if (bold && italic) return "boldItalic";
  if (bold) return "bold";
  if (italic) return "italic";
  return "regular";
}

export function colorIdForMarks(marks?: RichMarks): RichTextColorId | undefined {
  return marks?.color;
}

export function colorHexForMarks(marks?: RichMarks): string | undefined {
  const id = colorIdForMarks(marks);
  return id ? RICH_TEXT_COLOR_HEX[id] : undefined;
}

export function highlightHexForMarks(marks?: RichMarks): string | undefined {
  return marks?.highlight ? RICH_HIGHLIGHT_HEX : undefined;
}

export function underlineForMarks(marks?: RichMarks): boolean {
  return Boolean(marks?.underline);
}

export function hrefForMarks(marks?: RichMarks): string | undefined {
  return marks?.href;
}

export function hexToRgbParts(hex: string): { r: number; g: number; b: number } {
  const raw = hex.replace("#", "");
  return {
    r: Number.parseInt(raw.slice(0, 2), 16) / 255,
    g: Number.parseInt(raw.slice(2, 4), 16) / 255,
    b: Number.parseInt(raw.slice(4, 6), 16) / 255,
  };
}
