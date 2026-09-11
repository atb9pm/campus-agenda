import { openPdfDocument } from "../../lib/pdf/open-pdf-document.ts";

import { looksLikeOfficialPlanText, parseOfficialPlanFromLines } from "./official-plan-logic.ts";
import type { OfficialPlanParseResult } from "./official-plan-types.ts";

const Y_CLUSTER = 6;

interface TextItem {
  text: string;
  x: number;
  y: number;
}

function clusterLines(items: TextItem[]): string[] {
  const rows = new Map<number, TextItem[]>();
  for (const item of items) {
    const bucket = Math.round(item.y / Y_CLUSTER) * Y_CLUSTER;
    const row = rows.get(bucket) ?? [];
    row.push(item);
    rows.set(bucket, row);
  }

  return [...rows.entries()]
    .sort((left, right) => right[0] - left[0])
    .map(([, rowItems]) =>
      rowItems
        .sort((left, right) => left.x - right.x)
        .map((item) => item.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean);
}

export async function extractOfficialPlanLines(
  pdfBytes: Uint8Array,
): Promise<{ pageCount: number; lines: string[] }> {
  const document = await openPdfDocument(pdfBytes);
  const lines: string[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const items: TextItem[] = content.items
      .map((item) => {
        if (!("str" in item) || typeof item.str !== "string" || !item.str.trim()) {
          return null;
        }
        const transform = item.transform as number[];
        return {
          text: item.str.trim(),
          x: Math.round(transform[4] ?? 0),
          y: Math.round(transform[5] ?? 0),
        };
      })
      .filter((item): item is TextItem => item !== null);
    lines.push(...clusterLines(items));
  }

  return { pageCount: document.numPages, lines };
}

export async function parseOfficialPlanPdf(pdfBytes: Uint8Array): Promise<OfficialPlanParseResult> {
  const extracted = await extractOfficialPlanLines(pdfBytes);
  return parseOfficialPlanFromLines(extracted.lines, extracted.pageCount);
}

export function documentLooksLikeOfficialPlan(textOrLines: string | string[]): boolean {
  const text = Array.isArray(textOrLines) ? textOrLines.join("\n") : textOrLines;
  return looksLikeOfficialPlanText(text);
}
