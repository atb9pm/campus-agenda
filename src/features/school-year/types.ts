import type { SchoolWeekKind } from "../calendar/types.ts";

export type SchoolYearStatus = "draft" | "active" | "archived";

export interface SchoolWeekEntry {
  number: number;
  /** `A` / `B` selon le numéro pédagogique, ou `null` tant que le type n’est pas initialisé. */
  kind: SchoolWeekKind | null;
  monday: string;
}

export interface ParsedWeekPlan {
  label: string;
  startsOn: string;
  endsOn: string;
  weeks: SchoolWeekEntry[];
  warnings: string[];
}

export interface SchoolYearRecord {
  id: string;
  label: string;
  status: SchoolYearStatus;
  startsOn: string;
  endsOn: string;
  sourceFilename: string | null;
  importedAt: string | null;
  activatedAt: string | null;
  createdAt: string;
}

export interface SchoolYearWithWeeks extends SchoolYearRecord {
  weeks: SchoolWeekEntry[];
}
