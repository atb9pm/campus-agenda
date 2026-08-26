import type { AgendaItemType } from "../../types/agenda.ts";

export interface PublicationTemplate {
  id: string;
  ownerTeacherId: string;
  title: string;
  detail: string;
  type: AgendaItemType;
  subjectId: string | null;
  defaultSchoolWeekNumber: number | null;
  defaultDay: number | null;
  sourceSchoolYearId: string | null;
  sourceItemId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateDeploymentInput {
  templateId: string;
  classroomId: string;
  subjectId: string;
  schoolWeekNumber: number;
  day: number;
  hour?: number;
}

export interface DuplicatePreviousYearOptions {
  archivedSchoolYearId: string;
  classroomId: string;
  /** Si true, crée aussi des modèles dans la bibliothèque. */
  alsoCreateTemplates?: boolean;
}
