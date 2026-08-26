import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import type { ParsedWeekPlan } from "./types.ts";
import {
  MONTH_COLUMNS,
  buildWeekPlanFromGrid,
  parseSchoolYearLabel,
  type GridTableRow,
  type GridTextItem,
} from "./week-plan-logic.ts";

const Y_CLUSTER = 8;
const DAY_COLUMN_MAX_X = 55;

interface MonthColumnBounds {
  minX: number;
  maxX: number;
}

function clusterRows(items: GridTextItem[]): Map<number, GridTextItem[]> {
  const rows = new Map<number, GridTextItem[]>();
  for (const item of items) {
    const bucket = Math.round(item.y / Y_CLUSTER) * Y_CLUSTER;
    const row = rows.get(bucket) ?? [];
    row.push(item);
    rows.set(bucket, row);
  }
  for (const row of rows.values()) {
    row.sort((left, right) => left.x - right.x);
  }
  return rows;
}

function findMonthColumns(headerRow: GridTextItem[]): Map<string, number> {
  const positions = new Map<string, number>();
  for (const item of headerRow) {
    const month = MONTH_COLUMNS.find((column) => column.name === item.text.trim());
    if (month) {
      positions.set(month.name, item.x);
    }
  }
  return positions;
}

function buildMonthColumnBounds(monthPositions: Map<string, number>): Map<string, MonthColumnBounds> {
  const sorted = MONTH_COLUMNS.map((column) => ({
    name: column.name,
    x: monthPositions.get(column.name) ?? 0,
  }))
    .filter((column) => column.x > 0)
    .sort((left, right) => left.x - right.x);

  const bounds = new Map<string, MonthColumnBounds>();
  for (let index = 0; index < sorted.length; index += 1) {
    const current = sorted[index];
    const previous = sorted[index - 1]?.x ?? current.x - 60;
    const next = sorted[index + 1]?.x ?? current.x + 60;
    bounds.set(current.name, {
      minX: current.x - (current.x - previous) / 2,
      maxX: current.x + (next - current.x) / 2,
    });
  }

  const juinX = monthPositions.get("Juin");
  if (juinX !== undefined) {
    bounds.set("Juin", {
      minX: bounds.get("Juin")?.minX ?? juinX - 30,
      maxX: juinX + 45,
    });
  }

  return bounds;
}

function monthForPosition(x: number, columnBounds: Map<string, MonthColumnBounds>): string | null {
  for (const [name, bounds] of columnBounds.entries()) {
    if (x >= bounds.minX && x <= bounds.maxX) {
      return name;
    }
  }
  return null;
}

function buildGridRows(
  rowBuckets: Map<number, GridTextItem[]>,
  columnBounds: Map<string, MonthColumnBounds>,
): GridTableRow[] {
  const rows: GridTableRow[] = [];

  for (const [, items] of [...rowBuckets.entries()].sort((left, right) => right[0] - left[0])) {
    if (items.length === 0) continue;

    const dayCandidate = items.find((item) => item.x <= DAY_COLUMN_MAX_X && /^\d{1,2}$/.test(item.text.trim()));
    if (!dayCandidate) continue;

    const dayOfMonth = Number(dayCandidate.text.trim());
    if (dayOfMonth < 1 || dayOfMonth > 31) continue;

    const cells = new Map<string, string>();
    for (const item of items) {
      if (item.x <= DAY_COLUMN_MAX_X) continue;
      const month = monthForPosition(item.x, columnBounds);
      if (!month) continue;
      const existing = cells.get(month);
      cells.set(month, existing ? `${existing} ${item.text}`.trim() : item.text.trim());
    }

    rows.push({ dayOfMonth, cells });
  }

  return rows;
}

export async function parseWeekPlanPdf(pdfBytes: Uint8Array): Promise<ParsedWeekPlan> {
  const document = await getDocument({ data: pdfBytes, useSystemFonts: true }).promise;
  const page = await document.getPage(1);
  const content = await page.getTextContent();

  const items: GridTextItem[] = content.items
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
    .filter((item): item is GridTextItem => item !== null);

  const fullText = items.map((item) => item.text).join(" ");
  const label = parseSchoolYearLabel(fullText);
  if (!label) {
    throw new Error("Format PDF non reconnu : titre « Année scolaire YYYY-YYYY » introuvable.");
  }

  const startYear = Number(label.split("-")[0]);
  if (!Number.isFinite(startYear)) {
    throw new Error("Format PDF non reconnu : année de début invalide.");
  }

  const rowBuckets = clusterRows(items);
  const headerRow = [...rowBuckets.values()].find((row) =>
    row.some((item) => item.text === "Août") && row.some((item) => item.text === "Juin"),
  );
  if (!headerRow) {
    throw new Error("Format PDF non reconnu : en-tête des mois (Août … Juin) introuvable.");
  }

  const monthPositions = findMonthColumns(headerRow);
  if (monthPositions.size < MONTH_COLUMNS.length) {
    throw new Error("Format PDF non reconnu : calendrier mensuel incomplet.");
  }

  const columnBounds = buildMonthColumnBounds(monthPositions);
  const gridRows = buildGridRows(rowBuckets, columnBounds);
  return buildWeekPlanFromGrid(label, gridRows, startYear);
}

export { isReceivableWeekPlan } from "./week-plan-logic.ts";
