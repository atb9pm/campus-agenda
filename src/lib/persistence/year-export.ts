import type { PrototypeAgendaItem } from "../../features/agenda/demo-items.ts";
import { AGENDA_ITEM_TYPES } from "../../types/agenda.ts";
import type { AgendaStore } from "./types.ts";

export const SCHOOL_YEAR_EXPORT_VERSION = 1 as const;

export interface SchoolYearExportSnapshot {
  version: typeof SCHOOL_YEAR_EXPORT_VERSION;
  exportedAt: string;
  schoolYearId: string;
  schoolYearLabel: string;
  itemCount: number;
  items: PrototypeAgendaItem[];
}

export async function exportSchoolYearSnapshot(
  store: AgendaStore,
  schoolYearId: string,
  schoolYearLabel: string,
): Promise<SchoolYearExportSnapshot> {
  const items = (await store.exportAllItems()).filter((item) => item.schoolYearId === schoolYearId);
  return {
    version: SCHOOL_YEAR_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    schoolYearId,
    schoolYearLabel,
    itemCount: items.length,
    items,
  };
}

function escapeCsv(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function schoolYearExportToCsv(snapshot: SchoolYearExportSnapshot): string {
  const headers = [
    "id",
    "classroomId",
    "subjectId",
    "authorTeacherId",
    "schoolWeekNumber",
    "day",
    "hour",
    "type",
    "title",
    "detail",
    "templateId",
    "schoolYearId",
  ];
  const lines = [headers.join(",")];

  for (const item of snapshot.items) {
    lines.push([
      item.id,
      item.classroomId,
      item.subjectId,
      item.authorTeacherId,
      item.schoolWeekNumber,
      item.day,
      item.hour,
      item.type,
      escapeCsv(item.title),
      escapeCsv(item.detail),
      item.templateId ?? "",
      item.schoolYearId ?? "",
    ].join(","));
  }

  return lines.join("\n");
}

export function isValidSchoolYearExport(payload: unknown): payload is SchoolYearExportSnapshot {
  if (!payload || typeof payload !== "object") return false;
  const snapshot = payload as Partial<SchoolYearExportSnapshot>;
  if (snapshot.version !== SCHOOL_YEAR_EXPORT_VERSION) return false;
  if (typeof snapshot.schoolYearId !== "string") return false;
  if (!Array.isArray(snapshot.items)) return false;
  return snapshot.items.every((item) =>
    Number.isFinite(item.id)
    && typeof item.classroomId === "string"
    && typeof item.subjectId === "string"
    && AGENDA_ITEM_TYPES.includes(item.type),
  );
}
