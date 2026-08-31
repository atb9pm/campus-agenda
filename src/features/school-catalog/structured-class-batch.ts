import { validateAdminClassCreate } from "./admin-class.ts";
import {
  buildStructuredClassBatch,
  normalizeClassCodePrefix,
  type StructuredClassDraft,
} from "./class-codes.ts";
import { assertClassCodeAvailable, assertStructuredGroupAvailable } from "./class-uniqueness.ts";
import type {
  PedagogicalContextRecord,
  PedagogyMutationResult,
  SchoolProfessionRecord,
} from "./profession-types.ts";
import type { SchoolYearRef } from "./school-year-attachment.ts";
import type { SchoolClassInput, SchoolClassRecord } from "./types.ts";

export interface StructuredClassBatchInput {
  schoolYearId: string;
  professionId: string;
  trainingYear: number;
  organization: "unique" | "parallel";
  parallelCodes?: string[];
}

export interface ValidatedStructuredClassBatch {
  schoolYearId: string;
  schoolYearLabel: string;
  professionId: string;
  trainingYear: number;
  drafts: StructuredClassDraft[];
}

export function countActiveContextsForYear(options: {
  professionId: string;
  trainingYear: number;
  contexts: PedagogicalContextRecord[];
}): number {
  return options.contexts.filter(
    (entry) =>
      entry.professionId === options.professionId &&
      entry.trainingYear === options.trainingYear &&
      entry.isActive &&
      !entry.isArchived,
  ).length;
}

/**
 * Valide tout le lot avant la première écriture.
 */
export function validateStructuredClassBatch(options: {
  input: StructuredClassBatchInput;
  years: SchoolYearRef[];
  professions: SchoolProfessionRecord[];
  classes: SchoolClassRecord[];
  contexts: PedagogicalContextRecord[];
}): PedagogyMutationResult<ValidatedStructuredClassBatch> {
  const year = options.years.find((entry) => entry.id === options.input.schoolYearId);
  if (!year) {
    return { ok: false, reason: "Année scolaire introuvable." };
  }
  if (year.status === "archived") {
    return { ok: false, reason: "Impossible de créer une classe sur une année scolaire archivée." };
  }
  if (year.status && year.status !== "draft" && year.status !== "active") {
    return { ok: false, reason: "L'année scolaire doit être brouillon ou active." };
  }

  const structured = validateAdminClassCreate({
    schoolYearId: options.input.schoolYearId,
    professionId: options.input.professionId,
    trainingYear: options.input.trainingYear,
    years: options.years,
    professions: options.professions,
  });
  if (!structured.ok) return structured;

  const profession = options.professions.find((entry) => entry.id === structured.value.professionId);
  if (!profession) {
    return { ok: false, reason: "Profession introuvable." };
  }
  if (!profession.isActive || profession.isArchived) {
    return { ok: false, reason: "La profession doit être active et non archivée." };
  }
  if (!profession.classCodePrefix) {
    return {
      ok: false,
      reason:
        "Configurez d'abord l'abréviation de cette profession dans l'onglet Professions.",
    };
  }
  const prefix = normalizeClassCodePrefix(profession.classCodePrefix);
  if (!prefix.ok) return prefix;

  const planned = countActiveContextsForYear({
    professionId: structured.value.professionId,
    trainingYear: structured.value.trainingYear,
    contexts: options.contexts,
  });
  if (planned === 0) {
    return {
      ok: false,
      reason:
        "Aucune branche n'est encore définie pour cette année de formation. Configurez d'abord le plan de formation.",
    };
  }

  const parallelCodes =
    options.input.organization === "unique"
      ? [null]
      : (options.input.parallelCodes ?? []);
  if (options.input.organization === "parallel" && parallelCodes.length < 2) {
    return { ok: false, reason: "Les classes parallèles nécessitent au moins deux groupes." };
  }

  const drafts = buildStructuredClassBatch({
    prefix: prefix.value,
    trainingYear: structured.value.trainingYear,
    parallelCodes,
  });
  if (!drafts.ok) return drafts;

  const pending = options.classes.slice();
  for (const draft of drafts.value) {
    const available = assertClassCodeAvailable({
      code: draft.code,
      schoolYearId: structured.value.schoolYearId,
      classes: pending,
    });
    if (!available.ok) return available;
    const group = assertStructuredGroupAvailable({
      schoolYearId: structured.value.schoolYearId,
      professionId: structured.value.professionId,
      trainingYear: structured.value.trainingYear,
      parallelCode: draft.parallelCode,
      classes: pending,
    });
    if (!group.ok) return group;
    pending.push({
      id: `pending-${draft.code}`,
      code: draft.code,
      label: draft.label,
      sortOrder: 0,
      isActive: true,
      schoolYearId: structured.value.schoolYearId,
      schoolYearLabel: structured.value.schoolYearLabel,
      professionId: structured.value.professionId,
      trainingYear: structured.value.trainingYear,
      parallelCode: draft.parallelCode,
      isArchived: false,
      archivedAt: null,
    });
  }

  const codes = drafts.value.map((draft) => draft.code);
  if (new Set(codes).size !== codes.length) {
    return { ok: false, reason: "Deux groupes identiques ne sont pas autorisés dans la même création." };
  }

  return {
    ok: true,
    value: {
      schoolYearId: structured.value.schoolYearId,
      schoolYearLabel: structured.value.schoolYearLabel,
      professionId: structured.value.professionId,
      trainingYear: structured.value.trainingYear,
      drafts: drafts.value,
    },
  };
}

export function structuredDraftsToInputs(
  batch: ValidatedStructuredClassBatch,
  sortOrderStart: number,
): SchoolClassInput[] {
  return batch.drafts.map((draft, index) => ({
    code: draft.code,
    label: draft.label,
    sortOrder: sortOrderStart + index,
    isActive: true,
    schoolYearId: batch.schoolYearId,
    schoolYearLabel: batch.schoolYearLabel,
    professionId: batch.professionId,
    trainingYear: batch.trainingYear,
    parallelCode: draft.parallelCode,
  }));
}

export interface StructuredClassWriter {
  listClasses(): Promise<SchoolClassRecord[]>;
  listProfessions(): Promise<SchoolProfessionRecord[]>;
  listContexts(): Promise<PedagogicalContextRecord[]>;
  createClassesBatch(inputs: SchoolClassInput[]): Promise<SchoolClassRecord[]>;
}

export function parseStructuredClassesRequest(body: {
  organization?: unknown;
  parallelCodes?: unknown;
}): PedagogyMutationResult<{ organization: "unique" | "parallel"; parallelCodes?: string[] }> {
  if (body.organization !== "unique" && body.organization !== "parallel") {
    return { ok: false, reason: "L'organisation doit être « unique » ou « parallel »." };
  }
  if (body.organization === "parallel") {
    if (
      !Array.isArray(body.parallelCodes) ||
      body.parallelCodes.some((entry) => typeof entry !== "string")
    ) {
      return { ok: false, reason: "parallelCodes doit être un tableau de chaînes." };
    }
    return { ok: true, value: { organization: "parallel", parallelCodes: body.parallelCodes } };
  }
  return { ok: true, value: { organization: "unique" } };
}

/**
 * Valide le lot entier puis persiste toutes les classes en une opération atomique.
 */
export async function createStructuredClasses(
  catalog: StructuredClassWriter,
  options: {
    input: StructuredClassBatchInput;
    years: SchoolYearRef[];
  },
): Promise<PedagogyMutationResult<SchoolClassRecord[]>> {
  const [classes, professions, contexts] = await Promise.all([
    catalog.listClasses(),
    catalog.listProfessions(),
    catalog.listContexts(),
  ]);
  const validated = validateStructuredClassBatch({
    input: options.input,
    years: options.years,
    professions,
    classes,
    contexts,
  });
  if (!validated.ok) return validated;

  const inputs = structuredDraftsToInputs(validated.value, classes.length + 1);
  try {
    return { ok: true, value: await catalog.createClassesBatch(inputs) };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Création des classes impossible.";
    return { ok: false, reason };
  }
}
