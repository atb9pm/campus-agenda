import assert from "node:assert/strict";
import test from "node:test";

import { DEMO_PROTOTYPE_ITEMS } from "../src/features/agenda/demo-items.ts";
import { updatePublication } from "../src/features/agenda/publications.ts";
import { TEACHER_DEMO_ID } from "../src/features/classes/index.ts";
import {
  createTemplateFromItem,
  deployTemplatesToAgenda,
  duplicateItemsFromArchivedYear,
  syncTemplateFromItem,
  updateTemplateRecord,
} from "../src/features/library/templates.ts";
import type { PublicationTemplate } from "../src/features/library/types.ts";

const ARCHIVED_YEAR_ID = "year-archived-demo";
const ACTIVE_YEAR_ID = "year-active-demo";

test("phase 2.1 — enregistrer une publication dans la bibliothèque", () => {
  const item = DEMO_PROTOTYPE_ITEMS[0];
  const result = createTemplateFromItem([], item, item.authorTeacherId, "tpl-1", ACTIVE_YEAR_ID);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.template.title, item.title);
  assert.equal(result.template.defaultSchoolWeekNumber, item.schoolWeekNumber);
  assert.equal(result.template.sourceItemId, item.id);
});

test("phase 2.1 — modifier une instance n'altère pas le modèle", () => {
  const item = DEMO_PROTOTYPE_ITEMS[0];
  const templateResult = createTemplateFromItem([], item, item.authorTeacherId, "tpl-1", ACTIVE_YEAR_ID);
  assert.equal(templateResult.ok, true);
  if (!templateResult.ok) return;

  const linkedItem = { ...item, templateId: templateResult.template.id };
  const updated = updatePublication([linkedItem], item.id, item.authorTeacherId, {
    title: "Titre modifié sur l'instance",
  });
  assert.equal(updated.ok, true);
  if (!updated.ok) return;

  const instance = updated.items[0];
  assert.equal(instance.title, "Titre modifié sur l'instance");
  assert.equal(templateResult.template.title, item.title);
});

test("phase 2.1 — mettre à jour le modèle depuis l'instance (action explicite)", () => {
  const item = DEMO_PROTOTYPE_ITEMS[0];
  const templates: PublicationTemplate[] = [{
    id: "tpl-1",
    ownerTeacherId: item.authorTeacherId,
    title: item.title,
    detail: item.detail,
    type: item.type,
    subjectId: item.subjectId,
    defaultSchoolWeekNumber: item.schoolWeekNumber,
    defaultDay: item.day,
    sourceSchoolYearId: ACTIVE_YEAR_ID,
    sourceItemId: item.id,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }];

  const linkedItem = { ...item, templateId: "tpl-1", title: "Nouveau titre instance" };
  const syncResult = syncTemplateFromItem(templates, linkedItem, item.authorTeacherId);
  assert.equal(syncResult.ok, true);
  if (!syncResult.ok) return;

  assert.equal(syncResult.template.title, "Nouveau titre instance");
});

test("phase 2.1 — déployer des modèles sur l'année", () => {
  const item = DEMO_PROTOTYPE_ITEMS[0];
  const templateResult = createTemplateFromItem([], item, item.authorTeacherId, "tpl-deploy", ACTIVE_YEAR_ID);
  assert.equal(templateResult.ok, true);
  if (!templateResult.ok) return;

  const deployResult = deployTemplatesToAgenda(
    DEMO_PROTOTYPE_ITEMS,
    templateResult.templates,
    [{
      templateId: "tpl-deploy",
      classroomId: item.classroomId,
      subjectId: item.subjectId,
      schoolWeekNumber: 20,
      day: 0,
    }],
    item.authorTeacherId,
    ACTIVE_YEAR_ID,
    100,
  );

  assert.equal(deployResult.ok, true);
  if (!deployResult.ok) return;

  assert.equal(deployResult.created.length, 1);
  assert.equal(deployResult.created[0]?.templateId, "tpl-deploy");
  assert.equal(deployResult.created[0]?.schoolYearId, ACTIVE_YEAR_ID);
  assert.equal(deployResult.created[0]?.schoolWeekNumber, 20);
});

test("phase 2.1 — dupliquer depuis une année archivée", () => {
  // Les items de démo sont signés TEACHER_DEMO_ID (pas le compte ChF admin).
  const archivedItems = DEMO_PROTOTYPE_ITEMS
    .filter((item) => item.authorTeacherId === TEACHER_DEMO_ID)
    .slice(0, 2)
    .map((item) => ({ ...item, schoolYearId: ARCHIVED_YEAR_ID }));

  assert.ok(archivedItems.length > 0, "au moins un item de démo à dupliquer");

  const duplicateResult = duplicateItemsFromArchivedYear(
    archivedItems,
    [],
    {
      archivedSchoolYearId: ARCHIVED_YEAR_ID,
      classroomId: archivedItems[0]!.classroomId,
      alsoCreateTemplates: true,
    },
    TEACHER_DEMO_ID,
    ACTIVE_YEAR_ID,
    200,
    () => "tpl-dup",
  );

  assert.equal(duplicateResult.ok, true);
  if (!duplicateResult.ok) return;

  assert.equal(duplicateResult.created.length, archivedItems.length);
  assert.equal(duplicateResult.templatesCreated.length, archivedItems.length);
  assert.ok(duplicateResult.created.every((item) => item.schoolYearId === ACTIVE_YEAR_ID));
});

test("phase 2.1 — mise à jour directe du modèle par son auteur", () => {
  const item = DEMO_PROTOTYPE_ITEMS[0];
  const created = createTemplateFromItem([], item, item.authorTeacherId, "tpl-edit", ACTIVE_YEAR_ID);
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const updated = updateTemplateRecord(created.templates, "tpl-edit", item.authorTeacherId, {
    title: "Modèle révisé",
    defaultSchoolWeekNumber: 15,
  });
  assert.equal(updated.ok, true);
  if (!updated.ok) return;

  assert.equal(updated.template.title, "Modèle révisé");
  assert.equal(updated.template.defaultSchoolWeekNumber, 15);
});
