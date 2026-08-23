import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import { parseTimetableCell, summarizeTimetableSlots } from "./slot-logic.ts";
import type { ParsedTimetable, TimetableDayOfWeek, TimetableSlot } from "./types.ts";

interface TextItem {
  x: number;
  y: number;
  text: string;
}

interface ClassColumn {
  classCode: string;
  centerX: number;
  minX: number;
  maxX: number;
}

const CLASS_CODE = /^(COND\d|MMA\d[A-Z0-9-]*|MA[0-9][A-Z0-9-]*|AMA\d[A-Z]*|MAG\d|MEC[A-Z0-9]+|MACAM\d|CONDVL\d|PAI\d?)$/i;

const Y_CLUSTER = 6;
const COLUMN_HALF_WIDTH = 48;

function clusterRows(items: TextItem[]): Map<number, TextItem[]> {
  const rows = new Map<number, TextItem[]>();
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

function rowText(row: TextItem[]): string {
  return row.map((item) => item.text).join(" ").replace(/\s+/g, " ").trim();
}

function detectClassColumns(row: TextItem[]): ClassColumn[] {
  const candidates = row.filter((item) => CLASS_CODE.test(item.text.trim()));
  if (candidates.length < 2) return [];

  const columns: ClassColumn[] = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const current = candidates[index]!;
    const previous = candidates[index - 1];
    const next = candidates[index + 1];
    const minX = previous ? (previous.x + current.x) / 2 : current.x - COLUMN_HALF_WIDTH;
    const maxX = next ? (current.x + next.x) / 2 : current.x + COLUMN_HALF_WIDTH;
    columns.push({
      classCode: current.text.trim().toUpperCase(),
      centerX: current.x,
      minX,
      maxX,
    });
  }
  return columns;
}

function extractCellText(row: TextItem[], column: ClassColumn): string {
  const cellItems = row.filter((item) => item.x >= column.minX && item.x <= column.maxX);
  return cellItems.map((item) => item.text).join(" ").replace(/\s+/g, " ").trim();
}

function parsePeriodRow(row: TextItem[]): number | null {
  const periodItem = row.find((item) => item.x < 70 && /^[1-9]|10$/.test(item.text.trim()));
  if (!periodItem) return null;
  const period = Number(periodItem.text.trim());
  return Number.isFinite(period) && period >= 1 && period <= 10 ? period : null;
}

function findDayBands(rows: Map<number, TextItem[]>): Array<{ day: TimetableDayOfWeek; maxY: number; minY: number }> {
  const periodOneRows = [...rows.entries()]
    .filter(([, row]) => parsePeriodRow(row) === 1)
    .sort(([leftY], [rightY]) => rightY - leftY);

  if (periodOneRows.length === 0) {
    return [];
  }

  const bands: Array<{ maxY: number; minY: number }> = [];
  for (let index = 0; index < periodOneRows.length; index += 1) {
    const [startY] = periodOneRows[index]!;
    const nextStartY = periodOneRows[index + 1]?.[0];
    const minY = nextStartY !== undefined ? nextStartY + 12 : 0;
    bands.push({ maxY: startY + 14, minY });
  }

  return bands.slice(0, 5).map((band, index) => ({
    day: index as TimetableDayOfWeek,
    maxY: band.maxY,
    minY: band.minY,
  }));
}

function parseDaySection(
  rows: Map<number, TextItem[]>,
  section: { day: TimetableDayOfWeek; maxY: number; minY: number },
  warnings: string[],
): TimetableSlot[] {
  const sectionRows = [...rows.entries()]
    .filter(([y]) => y <= section.maxY && y >= section.minY)
    .sort(([leftY], [rightY]) => rightY - leftY);

  let columns: ClassColumn[] = [];
  for (const [, row] of sectionRows) {
    if (parsePeriodRow(row) !== null) continue;
    const detected = detectClassColumns(row);
    if (detected.length >= 2) {
      columns = detected;
    }
  }

  if (columns.length === 0) {
    warnings.push(`Aucune colonne classe détectée pour ${section.day}.`);
    return [];
  }

  const slots: TimetableSlot[] = [];
  let excludedSps = 0;

  for (const [, row] of sectionRows) {
    const period = parsePeriodRow(row);
    if (!period) continue;

    for (const column of columns) {
      const cell = extractCellText(row, column);
      if (!cell) continue;

      const parsedCells = parseTimetableCell(cell);
      for (const parsed of parsedCells) {
        if (parsed.skip) {
          excludedSps += 1;
          continue;
        }
        slots.push({
          classCode: column.classCode,
          dayOfWeek: section.day,
          period,
          branchLabel: parsed.branchLabel,
          teacherCode: parsed.teacherCode,
          weekKind: parsed.weekKind,
        });
      }
    }
  }

  if (excludedSps > 0) {
    warnings.push(`Jour ${section.day} : ${excludedSps} cellule(s) SPS ignorée(s).`);
  }

  return slots;
}

function extractHeaderMetadata(items: TextItem[]): { schoolYearLabel: string; sourceVersion: string | null } {
  const joined = items.map((item) => item.text).join(" ");
  const yearMatch = joined.match(/Année scolaire\s+(\d{4}-\d{4})/i);
  const versionMatch = joined.match(/version du :\s*(\d{2}\.\d{2}\.\d{4})/i);
  return {
    schoolYearLabel: yearMatch?.[1] ?? "inconnue",
    sourceVersion: versionMatch?.[1] ?? null,
  };
}

export async function parseTimetablePdf(bytes: Uint8Array): Promise<ParsedTimetable> {
  const doc = await getDocument({ data: bytes, useSystemFonts: true }).promise;
  const page = await doc.getPage(1);
  const content = await page.getTextContent();
  const items: TextItem[] = content.items
    .map((item) => ({
      x: item.transform[4],
      y: item.transform[5],
      text: ("str" in item ? item.str : "").trim(),
    }))
    .filter((item) => item.text.length > 0);

  const { schoolYearLabel, sourceVersion } = extractHeaderMetadata(items);
  const rows = clusterRows(items);
  const warnings: string[] = [];
  const daySections = findDayBands(rows);

  if (daySections.length === 0) {
    warnings.push("Aucun jour de cours (Lu–Ve) détecté dans le PDF.");
  }

  const slots = daySections.flatMap((section) => parseDaySection(rows, section, warnings));
  const excludedSpsCount = warnings
    .filter((warning) => warning.includes("SPS ignorée"))
    .reduce((total, warning) => {
      const match = warning.match(/(\d+) cellule/);
      return total + Number(match?.[1] ?? 0);
    }, 0);

  return {
    schoolYearLabel,
    sourceVersion,
    slots,
    classes: summarizeTimetableSlots(slots),
    warnings,
    excludedSpsCount,
  };
}

export function isReceivableTimetable(parsed: ParsedTimetable): boolean {
  return parsed.slots.length >= 20 && parsed.classes.length >= 3 && parsed.warnings.length < 20;
}
