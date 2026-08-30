import { validateAdminClassCreate } from "./admin-class.ts";
import {
  buildStructuredClassBatch,
  normalizeClassCodePrefix,
  type StructuredClassDraft,
} from "./class-codes.ts";
import { assertClassCodeAvailable } from "./class-uniqueness.ts";
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

  for (const draft of drafts.value) {
    const available = assertClassCodeAvailable({
      code: draft.code,
      schoolYearId: structured.value.schoolYearId,
      classes: options.classes,
    });
    if (!available.ok) return available;
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
  createClass(input: SchoolClassInput): Promise<SchoolClassRecord>;
}

/**
 * Valide le lot entier puis crée toutes les classes (aucune écriture partielle).
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
  const created: SchoolClassRecord[] = [];
  try {
    for (const input of inputs) {
      created.push(await catalog.createClass(input));
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Création des classes impossible.";
    return { ok: false, reason };
  }
  return { ok: true, value: created };
}
