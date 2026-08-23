import type { PrototypeAgendaItem } from "../agenda/demo-items.ts";
import { createPublication, isAllowedPublicationType } from "../agenda/publications.ts";
import type { AgendaItemType } from "../../types/agenda.ts";
import type { DuplicatePreviousYearOptions, PublicationTemplate, TemplateDeploymentInput } from "./types.ts";

export type { PublicationTemplate, TemplateDeploymentInput, DuplicatePreviousYearOptions };

export interface CreateTemplateInput {
  ownerTeacherId: string;
  title: string;
  detail: string;
  type: AgendaItemType;
  subjectId?: string | null;
  defaultSchoolWeekNumber?: number | null;
  defaultDay?: number | null;
  sourceSchoolYearId?: string | null;
  sourceItemId?: number | null;
}

export function canManageTemplate(template: PublicationTemplate, teacherId: string): boolean {
  return template.ownerTeacherId === teacherId;
}

export function buildTemplateFromItem(
  item: PrototypeAgendaItem,
  ownerTeacherId: string,
  id: string,
  schoolYearId: string | null,
  now = new Date().toISOString(),
): PublicationTemplate {
  return {
    id,
    ownerTeacherId,
    title: item.title,
    detail: item.detail,
    type: item.type,
    subjectId: item.subjectId,
    defaultSchoolWeekNumber: item.schoolWeekNumber,
    defaultDay: item.day,
    sourceSchoolYearId: schoolYearId,
    sourceItemId: item.id,
    createdAt: now,
    updatedAt: now,
  };
}

export function createTemplateFromItem(
  templates: PublicationTemplate[],
  item: PrototypeAgendaItem,
  ownerTeacherId: string,
  id: string,
  schoolYearId: string | null,
): { ok: true; templates: PublicationTemplate[]; template: PublicationTemplate } | { ok: false; reason: string } {
  if (item.authorTeacherId !== ownerTeacherId) {
    return { ok: false, reason: "Seul l'auteur peut enregistrer cette publication dans la bibliothèque." };
  }
  if (!isAllowedPublicationType(item.type)) {
    return { ok: false, reason: "Type de publication non autorisé." };
  }

  const template = buildTemplateFromItem(item, ownerTeacherId, id, schoolYearId);
  return { ok: true, templates: [...templates, template], template };
}

export function updateTemplateRecord(
  templates: PublicationTemplate[],
  templateId: string,
  ownerTeacherId: string,
  patch: Partial<Pick<PublicationTemplate, "title" | "detail" | "subjectId" | "defaultSchoolWeekNumber" | "defaultDay">>,
): { ok: true; templates: PublicationTemplate[]; template: PublicationTemplate } | { ok: false; reason: string } {
  const existing = templates.find((entry) => entry.id === templateId);
  if (!existing) return { ok: false, reason: "Modèle introuvable." };
  if (!canManageTemplate(existing, ownerTeacherId)) {
    return { ok: false, reason: "Vous ne pouvez pas modifier ce modèle." };
  }

  const title = patch.title !== undefined ? patch.title.trim() : existing.title;
  if (!title) return { ok: false, reason: "Le titre est obligatoire." };

  const updated: PublicationTemplate = {
    ...existing,
    title,
    detail: patch.detail !== undefined ? patch.detail.trim() || "Aucune précision" : existing.detail,
    subjectId: patch.subjectId !== undefined ? patch.subjectId : existing.subjectId,
    defaultSchoolWeekNumber:
      patch.defaultSchoolWeekNumber !== undefined ? patch.defaultSchoolWeekNumber : existing.defaultSchoolWeekNumber,
    defaultDay: patch.defaultDay !== undefined ? patch.defaultDay : existing.defaultDay,
    updatedAt: new Date().toISOString(),
  };

  return {
    ok: true,
    templates: templates.map((entry) => (entry.id === templateId ? updated : entry)),
    template: updated,
  };
}

/** Met à jour explicitement le modèle depuis une instance liée. */
export function syncTemplateFromItem(
  templates: PublicationTemplate[],
  item: PrototypeAgendaItem,
  ownerTeacherId: string,
): { ok: true; templates: PublicationTemplate[]; template: PublicationTemplate } | { ok: false; reason: string } {
  if (!item.templateId) {
    return { ok: false, reason: "Cette publication n'est pas liée à un modèle." };
  }
  if (item.authorTeacherId !== ownerTeacherId) {
    return { ok: false, reason: "Seul l'auteur peut mettre à jour le modèle." };
  }

  return updateTemplateRecord(templates, item.templateId, ownerTeacherId, {
    title: item.title,
    detail: item.detail,
    subjectId: item.subjectId,
    defaultSchoolWeekNumber: item.schoolWeekNumber,
    defaultDay: item.day,
  });
}

export function deleteTemplateRecord(
  templates: PublicationTemplate[],
  templateId: string,
  ownerTeacherId: string,
): { ok: true; templates: PublicationTemplate[] } | { ok: false; reason: string } {
  const existing = templates.find((entry) => entry.id === templateId);
  if (!existing) return { ok: false, reason: "Modèle introuvable." };
  if (!canManageTemplate(existing, ownerTeacherId)) {
    return { ok: false, reason: "Vous ne pouvez pas supprimer ce modèle." };
  }
  return { ok: true, templates: templates.filter((entry) => entry.id !== templateId) };
}

export function deployTemplatesToAgenda(
  items: PrototypeAgendaItem[],
  templates: PublicationTemplate[],
  deployments: TemplateDeploymentInput[],
  ownerTeacherId: string,
  activeSchoolYearId: string | null,
  nextIdStart: number,
): { ok: true; items: PrototypeAgendaItem[]; created: PrototypeAgendaItem[] } | { ok: false; reason: string } {
  let nextItems = items;
  let nextId = nextIdStart;
  const created: PrototypeAgendaItem[] = [];

  for (const deployment of deployments) {
    const template = templates.find((entry) => entry.id === deployment.templateId);
    if (!template) return { ok: false, reason: `Modèle ${deployment.templateId} introuvable.` };
    if (!canManageTemplate(template, ownerTeacherId)) {
      return { ok: false, reason: "Vous ne pouvez déployer que vos propres modèles." };
    }
    if (deployment.schoolWeekNumber < 1 || deployment.schoolWeekNumber > 38) {
      return { ok: false, reason: "Semaine scolaire invalide." };
    }
    if (deployment.day !== 0 && deployment.day !== 3) {
      return { ok: false, reason: "Jour de cours invalide." };
    }

    nextId += 1;
    nextItems = createPublication(nextItems, {
      id: nextId,
      classroomId: deployment.classroomId,
      subjectId: deployment.subjectId,
      authorTeacherId: ownerTeacherId,
      day: deployment.day,
      hour: deployment.hour ?? 8,
      weekOffset: 0,
      schoolWeekNumber: deployment.schoolWeekNumber,
      type: template.type,
      title: template.title,
      detail: template.detail,
      templateId: template.id,
      schoolYearId: activeSchoolYearId,
    });
    const item = nextItems.find((entry) => entry.id === nextId);
    if (item) created.push(item);
  }

  return { ok: true, items: nextItems, created };
}

export function duplicateItemsFromArchivedYear(
  items: PrototypeAgendaItem[],
  templates: PublicationTemplate[],
  options: DuplicatePreviousYearOptions,
  ownerTeacherId: string,
  activeSchoolYearId: string | null,
  nextIdStart: number,
  nextTemplateId: () => string,
): {
  ok: true;
  items: PrototypeAgendaItem[];
  templates: PublicationTemplate[];
  created: PrototypeAgendaItem[];
  templatesCreated: PublicationTemplate[];
} | { ok: false; reason: string } {
  const sourceItems = items.filter(
    (item) =>
      item.schoolYearId === options.archivedSchoolYearId
      && item.classroomId === options.classroomId
      && item.authorTeacherId === ownerTeacherId,
  );

  if (sourceItems.length === 0) {
    return { ok: false, reason: "Aucune publication trouvée pour cette année archivée et cette classe." };
  }

  let nextItems = items;
  let nextTemplates = templates;
  let nextId = nextIdStart;
  const created: PrototypeAgendaItem[] = [];
  const templatesCreated: PublicationTemplate[] = [];

  for (const source of sourceItems) {
    let templateId: string | null = source.templateId ?? null;

    if (options.alsoCreateTemplates) {
      const templateResult = createTemplateFromItem(
        nextTemplates,
        source,
        ownerTeacherId,
        nextTemplateId(),
        options.archivedSchoolYearId,
      );
      if (templateResult.ok) {
        nextTemplates = templateResult.templates;
        templateId = templateResult.template.id;
        templatesCreated.push(templateResult.template);
      }
    }

    nextId += 1;
    nextItems = createPublication(nextItems, {
      id: nextId,
      classroomId: source.classroomId,
      subjectId: source.subjectId,
      authorTeacherId: ownerTeacherId,
      day: source.day,
      hour: source.hour,
      weekOffset: source.weekOffset,
      schoolWeekNumber: source.schoolWeekNumber,
      type: source.type,
      title: source.title,
      detail: source.detail,
      templateId,
      schoolYearId: activeSchoolYearId,
    });
    const item = nextItems.find((entry) => entry.id === nextId);
    if (item) created.push(item);
  }

  return { ok: true, items: nextItems, templates: nextTemplates, created, templatesCreated };
}
