import type { SchoolClassRecord } from "../school-catalog/types.ts";
import type { YearTransitionClassMapping } from "./types.ts";

export type ContinuationIdentity = {
  professionId: string;
  trainingYear: number;
  parallelCode: string;
};

export type ContinuationPlanRow = {
  sourceClassId: string;
  action: "reuse" | "create" | "skip" | "conflict" | "incomplete";
  targetClassId: string | null;
  identity: ContinuationIdentity | null;
  message: string | null;
};

export type ContinuationResolution = {
  mappings: YearTransitionClassMapping[];
  selectedSourceClassIds: string[];
  planned: ContinuationPlanRow[];
  issues: string[];
  blocking: boolean;
};

export function classContinuationIdentity(
  schoolClass: Pick<SchoolClassRecord, "professionId" | "trainingYear" | "parallelCode">,
): ContinuationIdentity | null {
  const professionId = schoolClass.professionId?.trim() || "";
  const parallelCode = schoolClass.parallelCode?.trim() || "";
  if (!professionId || schoolClass.trainingYear == null || !parallelCode) return null;
  return {
    professionId,
    trainingYear: schoolClass.trainingYear,
    parallelCode,
  };
}

export function continuationIdentityKey(identity: ContinuationIdentity): string {
  return `${identity.professionId}|${identity.trainingYear}|${identity.parallelCode}`;
}

export function identitiesEqual(left: ContinuationIdentity, right: ContinuationIdentity): boolean {
  return continuationIdentityKey(left) === continuationIdentityKey(right);
}

function operationalTarget(entry: SchoolClassRecord, targetSchoolYearId: string): boolean {
  if (entry.isArchived) return false;
  return (entry.schoolYearId?.trim() || null) === targetSchoolYearId;
}

/**
 * Construit les correspondances techniques à partir des classes cochées.
 * Jamais déduit du code ou du libellé : profession + année de formation + groupe.
 * Une classe décochée devient une non-continuation, sans erreur.
 */
export function resolveClassContinuations(options: {
  selectedSourceClassIds: readonly string[];
  sourceClasses: readonly SchoolClassRecord[];
  targetClasses: readonly SchoolClassRecord[];
  sourceSchoolYearId: string;
  targetSchoolYearId: string;
}): ContinuationResolution {
  const selected = new Set(
    options.selectedSourceClassIds.map((id) => id.trim()).filter(Boolean),
  );
  const sourceInYear = options.sourceClasses.filter(
    (entry) => (entry.schoolYearId?.trim() || null) === options.sourceSchoolYearId && !entry.isArchived,
  );
  const targets = options.targetClasses.filter((entry) =>
    operationalTarget(entry, options.targetSchoolYearId),
  );

  const mappings: YearTransitionClassMapping[] = [];
  const planned: ContinuationPlanRow[] = [];
  const issues: string[] = [];
  let blocking = false;

  for (const source of sourceInYear) {
    if (!selected.has(source.id)) {
      mappings.push({ sourceClassId: source.id, targetClassId: null });
      planned.push({
        sourceClassId: source.id,
        action: "skip",
        targetClassId: null,
        identity: classContinuationIdentity(source),
        message: null,
      });
      continue;
    }

    const identity = classContinuationIdentity(source);
    if (!identity) {
      mappings.push({ sourceClassId: source.id, targetClassId: null });
      const message =
        "Cette classe n’a pas une identité complète (profession, année de formation et groupe). Elle ne peut pas être reprise automatiquement.";
      planned.push({
        sourceClassId: source.id,
        action: "incomplete",
        targetClassId: null,
        identity: null,
        message,
      });
      issues.push(message);
      blocking = true;
      continue;
    }

    const matches = targets.filter((target) => {
      const targetIdentity = classContinuationIdentity(target);
      return targetIdentity ? identitiesEqual(identity, targetIdentity) : false;
    });

    if (matches.length > 1) {
      mappings.push({ sourceClassId: source.id, targetClassId: null });
      const message =
        "Plusieurs classes cibles ont la même profession, la même année de formation et le même groupe. Aucune fusion n’est faite automatiquement.";
      planned.push({
        sourceClassId: source.id,
        action: "conflict",
        targetClassId: null,
        identity,
        message,
      });
      issues.push(message);
      blocking = true;
      continue;
    }

    if (matches.length === 1) {
      const targetClassId = matches[0]!.id;
      mappings.push({ sourceClassId: source.id, targetClassId });
      planned.push({
        sourceClassId: source.id,
        action: "reuse",
        targetClassId,
        identity,
        message: null,
      });
      continue;
    }

    mappings.push({ sourceClassId: source.id, targetClassId: null });
    planned.push({
      sourceClassId: source.id,
      action: "create",
      targetClassId: null,
      identity,
      message:
        "Cette classe sera créée dans l’année cible à la confirmation du transfert, avec la même profession, année de formation et groupe.",
    });
  }

  for (const id of selected) {
    if (!sourceInYear.some((entry) => entry.id === id)) {
      issues.push("Une classe sélectionnée n’appartient pas à l’année source.");
      blocking = true;
    }
  }

  return {
    mappings,
    selectedSourceClassIds: [...selected],
    planned,
    issues,
    blocking,
  };
}
