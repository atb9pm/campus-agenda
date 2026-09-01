import { randomUUID } from "node:crypto";

import {
  createTemplateFromItem,
  deleteTemplateRecord,
  deployTemplatesToAgenda,
  duplicateItemsFromArchivedYear,
  syncTemplateFromItem,
  updateTemplateRecord,
} from "../../../features/library/templates.ts";
import type { DuplicatePreviousYearOptions, PublicationTemplate, TemplateDeploymentInput } from "../../../features/library/types.ts";
import type { PrototypeAgendaItem } from "../../../features/agenda/demo-items.ts";
import type { CreateAgendaInput, TemplateStore } from "../types.ts";
import type { SqlDatabase } from "./types.ts";

const TEMPLATE_COLUMNS =
  "id, owner_teacher_id, title, detail, type, subject_id, default_school_week_number, default_day, source_school_year_id, source_item_id, created_at, updated_at";

interface TemplateRow {
  id: string;
  owner_teacher_id: string;
  title: string;
  detail: string;
  type: string;
  subject_id: string | null;
  default_school_week_number: number | null;
  default_day: number | null;
  source_school_year_id: string | null;
  source_item_id: number | null;
  created_at: string;
  updated_at: string;
}

function rowToTemplate(row: TemplateRow): PublicationTemplate {
  return {
    id: row.id,
    ownerTeacherId: row.owner_teacher_id,
    title: row.title,
    detail: row.detail,
    type: row.type as PublicationTemplate["type"],
    subjectId: row.subject_id,
    defaultSchoolWeekNumber: row.default_school_week_number,
    defaultDay: row.default_day,
    sourceSchoolYearId: row.source_school_year_id,
    sourceItemId: row.source_item_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqlTemplateStore implements TemplateStore {
  private readonly db: SqlDatabase;
  private readonly agenda: {
    exportAllItems(): Promise<PrototypeAgendaItem[]>;
    findAgendaItem(itemId: number): Promise<PrototypeAgendaItem | undefined>;
    createAgendaItem(input: CreateAgendaInput): Promise<PrototypeAgendaItem>;
    replaceAllItems(items: PrototypeAgendaItem[]): Promise<void>;
    teacherCanPublish(teacherId: string, classroomId: string, subjectId: string): Promise<boolean>;
  };

  constructor(
    db: SqlDatabase,
    agenda: SqlTemplateStore["agenda"],
  ) {
    this.db = db;
    this.agenda = agenda;
  }

  async listTemplatesForTeacher(teacherId: string): Promise<PublicationTemplate[]> {
    const { results } = await this.db
      .prepare(`SELECT ${TEMPLATE_COLUMNS} FROM publication_templates WHERE owner_teacher_id = ? ORDER BY updated_at DESC`)
      .bind(teacherId)
      .all<TemplateRow>();
    return results.map(rowToTemplate);
  }

  private async exportAllTemplates(): Promise<PublicationTemplate[]> {
    const { results } = await this.db
      .prepare(`SELECT ${TEMPLATE_COLUMNS} FROM publication_templates ORDER BY created_at`)
      .bind()
      .all<TemplateRow>();
    return results.map(rowToTemplate);
  }

  private async insertTemplate(template: PublicationTemplate): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO publication_templates
          (id, owner_teacher_id, title, detail, type, subject_id, default_school_week_number, default_day, source_school_year_id, source_item_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        template.id,
        template.ownerTeacherId,
        template.title,
        template.detail,
        template.type,
        template.subjectId,
        template.defaultSchoolWeekNumber,
        template.defaultDay,
        template.sourceSchoolYearId,
        template.sourceItemId,
        template.createdAt,
        template.updatedAt,
      )
      .run();
  }

  private async persistItem(item: PrototypeAgendaItem): Promise<PrototypeAgendaItem> {
    const created = await this.agenda.createAgendaItem({
      classroomId: item.classroomId,
      subjectId: item.subjectId,
      authorTeacherId: item.authorTeacherId,
      day: item.day,
      hour: item.hour,
      weekOffset: item.weekOffset,
      schoolWeekNumber: item.schoolWeekNumber,
      type: item.type,
      title: item.title,
      detail: item.detail,
      templateId: item.templateId ?? null,
      schoolYearId: item.schoolYearId ?? null,
    });
    return created;
  }

  async createTemplateFromItem(itemId: number, teacherId: string, activeSchoolYearId: string | null) {
    const item = await this.agenda.findAgendaItem(itemId);
    if (!item) return { ok: false as const, reason: "Publication introuvable.", status: 404 as const };

    const templates = await this.exportAllTemplates();
    const result = createTemplateFromItem(templates, item, teacherId, randomUUID(), activeSchoolYearId);
    if (!result.ok) {
      return { ok: false as const, reason: result.reason, status: 403 as const };
    }

    await this.insertTemplate(result.template);
    await this.db
      .prepare("UPDATE agenda_items SET template_id = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(result.template.id, itemId)
      .run();

    const linked = { ...item, templateId: result.template.id };
    return { ok: true as const, template: result.template, item: linked };
  }

  async updateTemplate(
    templateId: string,
    teacherId: string,
    patch: Partial<Pick<PublicationTemplate, "title" | "detail" | "subjectId" | "defaultSchoolWeekNumber" | "defaultDay">>,
  ) {
    const templates = await this.exportAllTemplates();
    const result = updateTemplateRecord(templates, templateId, teacherId, patch);
    if (!result.ok) {
      const status = result.reason.includes("introuvable") ? 404 : 403;
      return { ok: false as const, reason: result.reason, status: status as 403 | 404 };
    }

    const updated = result.template;
    await this.db
      .prepare(
        `UPDATE publication_templates
         SET title = ?, detail = ?, subject_id = ?, default_school_week_number = ?, default_day = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(
        updated.title,
        updated.detail,
        updated.subjectId,
        updated.defaultSchoolWeekNumber,
        updated.defaultDay,
        updated.updatedAt,
        templateId,
      )
      .run();

    return { ok: true as const, template: updated };
  }

  async syncTemplateFromItem(itemId: number, teacherId: string) {
    const item = await this.agenda.findAgendaItem(itemId);
    if (!item) return { ok: false as const, reason: "Publication introuvable.", status: 404 as const };

    const templates = await this.exportAllTemplates();
    const result = syncTemplateFromItem(templates, item, teacherId);
    if (!result.ok) {
      const status = result.reason.includes("introuvable") || result.reason.includes("liée") ? 404 : 403;
      return { ok: false as const, reason: result.reason, status: status as 403 | 404 };
    }

    const updated = result.template;
    await this.db
      .prepare(
        `UPDATE publication_templates
         SET title = ?, detail = ?, subject_id = ?, default_school_week_number = ?, default_day = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(
        updated.title,
        updated.detail,
        updated.subjectId,
        updated.defaultSchoolWeekNumber,
        updated.defaultDay,
        updated.updatedAt,
        updated.id,
      )
      .run();

    return { ok: true as const, template: updated };
  }

  async deleteTemplate(templateId: string, teacherId: string) {
    const templates = await this.exportAllTemplates();
    const result = deleteTemplateRecord(templates, templateId, teacherId);
    if (!result.ok) {
      const status = result.reason.includes("introuvable") ? 404 : 403;
      return { ok: false as const, reason: result.reason, status: status as 403 | 404 };
    }

    await this.db.prepare("DELETE FROM publication_templates WHERE id = ?").bind(templateId).run();
    return { ok: true as const };
  }

  async deployTemplates(teacherId: string, deployments: TemplateDeploymentInput[], activeSchoolYearId: string | null) {
    for (const deployment of deployments) {
      if (!(await this.agenda.teacherCanPublish(teacherId, deployment.classroomId, deployment.subjectId))) {
        return { ok: false as const, reason: "Vous ne pouvez pas publier dans cette branche.", status: 403 as const };
      }
    }

    const items = await this.agenda.exportAllItems();
    const templates = await this.exportAllTemplates();
    const nextId = Math.max(0, ...items.map((item) => item.id));
    const result = deployTemplatesToAgenda(items, templates, deployments, teacherId, activeSchoolYearId, nextId);
    if (!result.ok) return { ok: false as const, reason: result.reason, status: 400 as const };

    const created: PrototypeAgendaItem[] = [];
    for (const item of result.created) {
      created.push(await this.persistItem(item));
    }

    return { ok: true as const, created };
  }

  async duplicateFromArchivedYear(
    teacherId: string,
    options: DuplicatePreviousYearOptions,
    activeSchoolYearId: string | null,
  ) {
    const items = await this.agenda.exportAllItems();
    const templates = await this.exportAllTemplates();
    const nextId = Math.max(0, ...items.map((item) => item.id));
    const result = duplicateItemsFromArchivedYear(
      items,
      templates,
      options,
      teacherId,
      activeSchoolYearId,
      nextId,
      () => randomUUID(),
    );
    if (!result.ok) return { ok: false as const, reason: result.reason, status: 404 as const };

    for (const template of result.templatesCreated) {
      await this.insertTemplate(template);
    }
    const created: PrototypeAgendaItem[] = [];
    for (const item of result.created) {
      created.push(await this.persistItem(item));
    }

    return {
      ok: true as const,
      created,
      templatesCreated: result.templatesCreated,
    };
  }
}
