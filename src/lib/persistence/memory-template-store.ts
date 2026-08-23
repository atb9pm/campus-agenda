import { randomUUID } from "node:crypto";

import {
  createTemplateFromItem,
  deleteTemplateRecord,
  deployTemplatesToAgenda,
  duplicateItemsFromArchivedYear,
  syncTemplateFromItem,
  updateTemplateRecord,
} from "../../features/library/templates.ts";
import type { DuplicatePreviousYearOptions, PublicationTemplate, TemplateDeploymentInput } from "../../features/library/types.ts";
import { getMemoryAgendaStore, type MemoryAgendaStore } from "./memory-store.ts";
import type { TemplateStore } from "./types.ts";

let memoryTemplates: PublicationTemplate[] = [];

export function resetMemoryTemplates(seed: PublicationTemplate[] = []): void {
  memoryTemplates = seed.map((entry) => ({ ...entry }));
}

export class MemoryTemplateStore implements TemplateStore {
  private readonly agenda: MemoryAgendaStore;

  constructor(agenda: MemoryAgendaStore) {
    this.agenda = agenda;
  }

  async listTemplatesForTeacher(teacherId: string): Promise<PublicationTemplate[]> {
    return memoryTemplates
      .filter((entry) => entry.ownerTeacherId === teacherId)
      .map((entry) => ({ ...entry }));
  }

  async createTemplateFromItem(itemId: number, teacherId: string, activeSchoolYearId: string | null) {
    const item = await this.agenda.findAgendaItem(itemId);
    if (!item) return { ok: false as const, reason: "Publication introuvable.", status: 404 as const };

    const result = createTemplateFromItem(memoryTemplates, item, teacherId, randomUUID(), activeSchoolYearId);
    if (!result.ok) return { ok: false as const, reason: result.reason, status: 403 as const };

    memoryTemplates = result.templates;
    const items = await this.agenda.exportAllItems();
    await this.agenda.replaceAllItems(
      items.map((entry) => (entry.id === itemId ? { ...entry, templateId: result.template.id } : entry)),
    );
    const linked = (await this.agenda.findAgendaItem(itemId))!;

    return { ok: true as const, template: result.template, item: linked };
  }

  async updateTemplate(
    templateId: string,
    teacherId: string,
    patch: Partial<Pick<PublicationTemplate, "title" | "detail" | "subjectId" | "defaultSchoolWeekNumber" | "defaultDay">>,
  ) {
    const result = updateTemplateRecord(memoryTemplates, templateId, teacherId, patch);
    if (!result.ok) {
      const status = result.reason.includes("introuvable") ? 404 : 403;
      return { ok: false as const, reason: result.reason, status: status as 403 | 404 };
    }
    memoryTemplates = result.templates;
    return { ok: true as const, template: result.template };
  }

  async syncTemplateFromItem(itemId: number, teacherId: string) {
    const item = await this.agenda.findAgendaItem(itemId);
    if (!item) return { ok: false as const, reason: "Publication introuvable.", status: 404 as const };

    const result = syncTemplateFromItem(memoryTemplates, item, teacherId);
    if (!result.ok) {
      const status = result.reason.includes("introuvable") || result.reason.includes("liée") ? 404 : 403;
      return { ok: false as const, reason: result.reason, status: status as 403 | 404 };
    }
    memoryTemplates = result.templates;
    return { ok: true as const, template: result.template };
  }

  async deleteTemplate(templateId: string, teacherId: string) {
    const result = deleteTemplateRecord(memoryTemplates, templateId, teacherId);
    if (!result.ok) {
      const status = result.reason.includes("introuvable") ? 404 : 403;
      return { ok: false as const, reason: result.reason, status: status as 403 | 404 };
    }
    memoryTemplates = result.templates;
    return { ok: true as const };
  }

  async deployTemplates(teacherId: string, deployments: TemplateDeploymentInput[], activeSchoolYearId: string | null) {
    for (const deployment of deployments) {
      if (!(await this.agenda.teacherCanPublish(teacherId, deployment.classroomId, deployment.subjectId))) {
        return { ok: false as const, reason: "Vous ne pouvez pas publier dans cette branche.", status: 403 as const };
      }
    }

    const items = await this.agenda.exportAllItems();
    const nextId = Math.max(0, ...items.map((item) => item.id));
    const result = deployTemplatesToAgenda(items, memoryTemplates, deployments, teacherId, activeSchoolYearId, nextId);
    if (!result.ok) return { ok: false as const, reason: result.reason, status: 400 as const };

    await this.agenda.replaceAllItems(result.items);
    return { ok: true as const, created: result.created };
  }

  async duplicateFromArchivedYear(
    teacherId: string,
    options: DuplicatePreviousYearOptions,
    activeSchoolYearId: string | null,
  ) {
    const items = await this.agenda.exportAllItems();
    const nextId = Math.max(0, ...items.map((item) => item.id));
    const result = duplicateItemsFromArchivedYear(
      items,
      memoryTemplates,
      options,
      teacherId,
      activeSchoolYearId,
      nextId,
      () => randomUUID(),
    );
    if (!result.ok) return { ok: false as const, reason: result.reason, status: 404 as const };

    memoryTemplates = result.templates;
    await this.agenda.replaceAllItems(result.items);
    return { ok: true as const, created: result.created, templatesCreated: result.templatesCreated };
  }
}

let singletonTemplateStore: MemoryTemplateStore | null = null;

export function getMemoryTemplateStore(): MemoryTemplateStore {
  singletonTemplateStore ??= new MemoryTemplateStore(getMemoryAgendaStore());
  return singletonTemplateStore;
}

export function resetMemoryTemplateStore(): void {
  resetMemoryTemplates();
  singletonTemplateStore = null;
}
