import type { CourseSession } from "../course-sessions/types.ts";
import type { QuickBlockKind } from "../class-notebook/rich-doc.ts";

export const NOTEBOOK_EXPORT_PERIODS = ["year", "semester-1", "semester-2"] as const;
export type NotebookExportPeriod = (typeof NOTEBOOK_EXPORT_PERIODS)[number];

export const NOTEBOOK_EXPORT_LAYOUTS = ["summary", "detailed"] as const;
export type NotebookExportLayout = (typeof NOTEBOOK_EXPORT_LAYOUTS)[number];

export interface NotebookExportOptions {
  includePublications: boolean;
  includeControls: boolean;
  includeTeacherNotes: boolean;
  includeDrafts: boolean;
  period: NotebookExportPeriod;
  layout: NotebookExportLayout;
  coverPage: boolean;
}

export interface NotebookExportRichLine {
  kind: "heading" | "paragraph" | "bullet" | "ordered" | "check" | "callout";
  text: string;
  order?: number;
  checked?: boolean;
  calloutKind?: QuickBlockKind;
  href?: string;
}

export interface NotebookExportSessionBlock {
  session: CourseSession;
  weekLabel: string;
  dateLabel: string;
  longDateLabel: string;
  publications: NotebookExportRichLine[];
  controls: string[];
  notes: NotebookExportRichLine[];
}

export interface NotebookExportDocument {
  classCode: string;
  classLabel: string;
  branchLabel: string;
  schoolYearLabel: string;
  teacherName: string;
  scheduleSummary: string;
  generatedOn: string;
  layout: NotebookExportLayout;
  coverPage: boolean;
  sessionCount: number;
  publicationCount: number;
  controlCount: number;
  noteCount: number;
  sessions: NotebookExportSessionBlock[];
}

export const NOTEBOOK_EXPORT_EMPTY_REASON = "Aucun contenu à exporter avec les options sélectionnées.";
export const NOTEBOOK_EXPORT_FAILED_REASON = "Impossible de générer le PDF. Veuillez réessayer.";
