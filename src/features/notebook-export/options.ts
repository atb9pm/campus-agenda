import {
  NOTEBOOK_EXPORT_LAYOUTS,
  NOTEBOOK_EXPORT_PERIODS,
  type NotebookExportLayout,
  type NotebookExportOptions,
  type NotebookExportPeriod,
} from "./types.ts";

export const DEFAULT_NOTEBOOK_EXPORT_OPTIONS: NotebookExportOptions = {
  includePublications: true,
  includeControls: true,
  includeTeacherNotes: false,
  includeDrafts: false,
  period: "year",
  layout: "summary",
  coverPage: true,
};

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function parseNotebookExportOptions(body: unknown): NotebookExportOptions {
  const source = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const period = NOTEBOOK_EXPORT_PERIODS.includes(source.period as NotebookExportPeriod)
    ? (source.period as NotebookExportPeriod)
    : DEFAULT_NOTEBOOK_EXPORT_OPTIONS.period;
  const layout = NOTEBOOK_EXPORT_LAYOUTS.includes(source.layout as NotebookExportLayout)
    ? (source.layout as NotebookExportLayout)
    : DEFAULT_NOTEBOOK_EXPORT_OPTIONS.layout;
  return {
    includePublications: asBoolean(source.includePublications, DEFAULT_NOTEBOOK_EXPORT_OPTIONS.includePublications),
    includeControls: asBoolean(source.includeControls, DEFAULT_NOTEBOOK_EXPORT_OPTIONS.includeControls),
    includeTeacherNotes: asBoolean(source.includeTeacherNotes, DEFAULT_NOTEBOOK_EXPORT_OPTIONS.includeTeacherNotes),
    includeDrafts: asBoolean(source.includeDrafts, DEFAULT_NOTEBOOK_EXPORT_OPTIONS.includeDrafts),
    period,
    layout,
    coverPage: asBoolean(source.coverPage, DEFAULT_NOTEBOOK_EXPORT_OPTIONS.coverPage),
  };
}
