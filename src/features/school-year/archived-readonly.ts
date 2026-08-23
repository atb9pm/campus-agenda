import type { PrototypeAgendaItem } from "../agenda/demo-items.ts";
import type { SchoolYearRecord } from "./types.ts";

export function getArchivedYearIds(years: SchoolYearRecord[]): Set<string> {
  return new Set(years.filter((year) => year.status === "archived").map((year) => year.id));
}

export function isArchivedYearItem(item: PrototypeAgendaItem, archivedYearIds: Set<string>): boolean {
  return Boolean(item.schoolYearId && archivedYearIds.has(item.schoolYearId));
}

export const ARCHIVED_YEAR_READONLY_REASON =
  "Cette publication appartient à une année archivée (lecture seule).";
