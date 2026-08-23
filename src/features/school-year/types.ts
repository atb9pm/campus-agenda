import type { SchoolWeekKind } from "../calendar/types.ts";

export type SchoolYearStatus = "draft" | "active" | "archived";

export interface SchoolWeekEntry {
  number: number;
  kind: SchoolWeekKind;
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
