import { NOTEBOOK_EXPORT_PERIODS, type NotebookExportOptions, type NotebookExportPeriod } from "./types.ts";

export const DEFAULT_NOTEBOOK_EXPORT_OPTIONS: NotebookExportOptions = {
  includePublications: true,
  includeControls: true,
  includeTeacherNotes: false,
  includeDrafts: false,
  period: "year",
  coverPage: true,
};

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** Ancien champ `layout` (synthèse / détaillé) : accepté puis ignoré. */
export function isLegacyNotebookExportLayout(value: unknown): boolean {
  return value === "summary" || value === "detailed";
}

export function parseNotebookExportOptions(body: unknown): NotebookExportOptions {
  const source = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const period = NOTEBOOK_EXPORT_PERIODS.includes(source.period as NotebookExportPeriod)
    ? (source.period as NotebookExportPeriod)
    : DEFAULT_NOTEBOOK_EXPORT_OPTIONS.period;
  void isLegacyNotebookExportLayout(source.layout);
  return {
    includePublications: asBoolean(source.includePublications, DEFAULT_NOTEBOOK_EXPORT_OPTIONS.includePublications),
    includeControls: asBoolean(source.includeControls, DEFAULT_NOTEBOOK_EXPORT_OPTIONS.includeControls),
    includeTeacherNotes: asBoolean(source.includeTeacherNotes, DEFAULT_NOTEBOOK_EXPORT_OPTIONS.includeTeacherNotes),
    includeDrafts: asBoolean(source.includeDrafts, DEFAULT_NOTEBOOK_EXPORT_OPTIONS.includeDrafts),
    period,
    coverPage: asBoolean(source.coverPage, DEFAULT_NOTEBOOK_EXPORT_OPTIONS.coverPage),
  };
}
