import { formatTrainingYearLabel } from "./class-codes.ts";
import { trainingYearsForDuration } from "./profession-rules.ts";
import type { PedagogicalContextRecord, SchoolProfessionRecord } from "./profession-types.ts";
import type { SchoolBranchRecord } from "./types.ts";

/**
 * Libellé de présentation d’un CTX. Les identités restent `branchId` / `contextId`.
 * Ne jamais écrire ce texte dans `SchoolBranchRecord.label`.
 *
 * COURT : profession déjà connue par l’écran.
 * COMPLET : listes mélangeant plusieurs professions.
 *
 * Future CourseSession : rattachée à AnnualCourse (qui a `contextId`).
 * Aucun `trainingYear` supplémentaire dans CourseSession.
 */
export type PedagogicalContextLabelMode = "short" | "full";

export function formatPedagogicalContextLabel(options: {
  branchLabel: string;
  trainingYear: number;
  professionLabel?: string | null;
  mode?: PedagogicalContextLabelMode;
}): string {
  const branch = options.branchLabel.trim() || "Branche";
  const year = formatTrainingYearLabel(options.trainingYear);
  const profession = options.professionLabel?.trim() ?? "";
  if ((options.mode ?? "short") === "full" && profession) {
    return `${branch} · ${profession} · ${year}`;
  }
  return `${branch} · ${year}`;
}

export function isActiveTrainingPlanContext(context: PedagogicalContextRecord): boolean {
  return context.isActive && !context.isArchived;
}

export function findContextForCell(options: {
  contexts: PedagogicalContextRecord[];
  professionId: string;
  trainingYear: number;
  branchId: string;
}): PedagogicalContextRecord | null {
  return (
    options.contexts.find(
      (entry) =>
        entry.professionId === options.professionId &&
        entry.trainingYear === options.trainingYear &&
        entry.branchId === options.branchId,
    ) ?? null
  );
}

export function findActiveContextForCell(options: {
  contexts: PedagogicalContextRecord[];
  professionId: string;
  trainingYear: number;
  branchId: string;
}): PedagogicalContextRecord | null {
  const context = findContextForCell(options);
  if (!context || !isActiveTrainingPlanContext(context)) return null;
  return context;
}

export function sortBranchesForTrainingPlan(branches: SchoolBranchRecord[]): SchoolBranchRecord[] {
  return [...branches].sort((left, right) => {
    if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
    const byLabel = left.label.localeCompare(right.label, "fr-CH");
    if (byLabel !== 0) return byLabel;
    return left.adminCode.localeCompare(right.adminCode, "fr-CH");
  });
}

export function filterProfessionsForPlanSearch(
  professions: SchoolProfessionRecord[],
  query: string,
): SchoolProfessionRecord[] {
  const needle = query.trim().toLowerCase();
  const sorted = [...professions].sort((left, right) => {
    if (left.isArchived !== right.isArchived) return left.isArchived ? 1 : -1;
    if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
    return left.label.localeCompare(right.label, "fr-CH");
  });
  if (!needle) return sorted;
  return sorted.filter((entry) => {
    const prefix = entry.classCodePrefix?.toLowerCase() ?? "";
    return entry.label.toLowerCase().includes(needle) || prefix.includes(needle);
  });
}

export interface TrainingPlanMatrixCell {
  trainingYear: number;
  checked: boolean;
  context: PedagogicalContextRecord | null;
}

export interface TrainingPlanMatrixRow {
  branch: SchoolBranchRecord;
  cells: TrainingPlanMatrixCell[];
  /** Branche hors catalogue courant : historique seulement, pas de nouvelle case. */
  assignmentLocked: boolean;
}

export interface TrainingPlanMatrix {
  years: number[];
  rows: TrainingPlanMatrixRow[];
}

/**
 * Projection visuelle des CTX actifs d’une profession.
 * Les colonnes viennent de `durationYears` (jamais 1–4 en dur).
 */
export function projectTrainingPlanMatrix(options: {
  profession: SchoolProfessionRecord;
  branches: SchoolBranchRecord[];
  contexts: PedagogicalContextRecord[];
}): TrainingPlanMatrix {
  const years = trainingYearsForDuration(options.profession.durationYears);
  const professionContexts = options.contexts.filter(
    (entry) => entry.professionId === options.profession.id,
  );
  const usedBranchIds = new Set(professionContexts.map((entry) => entry.branchId));
  const rowsSource = options.branches.filter((branch) => {
    if (usedBranchIds.has(branch.id)) return true;
    return branch.isActive && !branch.isArchived;
  });

  const rows = sortBranchesForTrainingPlan(rowsSource).map((branch) => ({
    branch,
    assignmentLocked: branch.isArchived || !branch.isActive,
    cells: years.map((trainingYear) => {
      const context = findActiveContextForCell({
        contexts: professionContexts,
        professionId: options.profession.id,
        trainingYear,
        branchId: branch.id,
      });
      return {
        trainingYear,
        checked: context !== null,
        context,
      };
    }),
  }));

  return { years, rows };
}

export interface BranchUsageByProfession {
  professionId: string;
  professionLabel: string;
  professionPrefix: string | null;
  years: number[];
}

/** Synthèse calculée (non persistée) : années actives d’une branche par profession. */
export function summarizeBranchUsages(options: {
  branchId: string;
  professions: SchoolProfessionRecord[];
  contexts: PedagogicalContextRecord[];
}): BranchUsageByProfession[] {
  const byProfession = new Map<string, Set<number>>();
  for (const context of options.contexts) {
    if (context.branchId !== options.branchId || !isActiveTrainingPlanContext(context)) continue;
    const years = byProfession.get(context.professionId) ?? new Set<number>();
    years.add(context.trainingYear);
    byProfession.set(context.professionId, years);
  }
  const summaries: BranchUsageByProfession[] = [];
  for (const profession of options.professions) {
    const years = byProfession.get(profession.id);
    if (!years || years.size === 0) continue;
    summaries.push({
      professionId: profession.id,
      professionLabel: profession.label,
      professionPrefix: profession.classCodePrefix,
      years: [...years].sort((left, right) => left - right),
    });
  }
  return summaries.sort((left, right) =>
    left.professionLabel.localeCompare(right.professionLabel, "fr-CH"),
  );
}

export function formatBranchUsageLine(usage: BranchUsageByProfession): string {
  const code = usage.professionPrefix ?? usage.professionLabel;
  return `${code} · années ${usage.years.join(", ")}`;
}
