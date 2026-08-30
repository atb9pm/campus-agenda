import type { PedagogyMutationResult } from "./profession-types.ts";

export const CLASS_CODE_PREFIX_MIN = 2;
export const CLASS_CODE_PREFIX_MAX = 10;

/** Lettres A–Z pour préremplir les groupes parallèles. */
export const PARALLEL_GROUP_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

/**
 * Abréviation métier d'une profession (MMA, MA, AGRI).
 * Distincte de l'identifiant système PRF-0001.
 */
export function normalizeClassCodePrefix(
  raw: string | null | undefined,
): PedagogyMutationResult<string> {
  if (raw === null || raw === undefined) {
    return { ok: false, reason: "L'abréviation des classes est obligatoire." };
  }
  const normalized = raw
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (normalized.length < CLASS_CODE_PREFIX_MIN || normalized.length > CLASS_CODE_PREFIX_MAX) {
    return {
      ok: false,
      reason: `L'abréviation doit contenir entre ${CLASS_CODE_PREFIX_MIN} et ${CLASS_CODE_PREFIX_MAX} lettres ou chiffres.`,
    };
  }
  if (/^PRF\d+$/.test(normalized)) {
    return {
      ok: false,
      reason: "PRF-0001 est l'identifiant système. Utilisez une abréviation métier (ex. MMA, MA).",
    };
  }
  return { ok: true, value: normalized };
}

/** Legacy / bootstrap : chaîne vide → null. Sinon normalisée. */
export function parseOptionalClassCodePrefix(
  raw: string | null | undefined,
): PedagogyMutationResult<string | null> {
  if (raw === null || raw === undefined || raw.trim() === "") {
    return { ok: true, value: null };
  }
  const normalized = normalizeClassCodePrefix(raw);
  if (!normalized.ok) return normalized;
  return { ok: true, value: normalized.value };
}

export function normalizeParallelCode(
  raw: string | null | undefined,
): PedagogyMutationResult<string | null> {
  if (raw === null || raw === undefined || raw.trim() === "") {
    return { ok: true, value: null };
  }
  const normalized = raw
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (!normalized || normalized.length > 4) {
    return { ok: false, reason: "Le groupe parallèle doit contenir 1 à 4 lettres ou chiffres." };
  }
  return { ok: true, value: normalized };
}

export function buildClassCode(options: {
  prefix: string;
  trainingYear: number;
  parallelCode: string | null;
}): string {
  const prefix = options.prefix.trim().toUpperCase();
  const year = String(options.trainingYear);
  const group = options.parallelCode?.trim().toUpperCase() ?? "";
  return `${prefix}${year}${group}`;
}

export function buildClassLabel(options: {
  prefix: string;
  trainingYear: number;
  parallelCode: string | null;
}): string {
  const prefix = options.prefix.trim().toUpperCase();
  const year = String(options.trainingYear);
  const group = options.parallelCode?.trim().toUpperCase() ?? "";
  return `${prefix} ${year}${group}`;
}

export function defaultParallelCodes(count: number): string[] {
  const safe = Math.max(2, Math.min(count, PARALLEL_GROUP_LETTERS.length));
  return PARALLEL_GROUP_LETTERS.slice(0, safe);
}

export function formatTrainingYearLabel(year: number): string {
  if (year === 1) return "1re année";
  return `${year}e année`;
}

export function formatProfessionOptionLabel(options: {
  label: string;
  classCodePrefix: string | null;
}): string {
  return options.classCodePrefix
    ? `${options.label} (${options.classCodePrefix})`
    : `${options.label} (abréviation à configurer)`;
}

export function formatRecoveryKey(options: {
  contextAdminCode: string;
  parallelCode: string | null;
}): string {
  if (!options.parallelCode) return options.contextAdminCode;
  return `${options.contextAdminCode}-${options.parallelCode}`;
}

export interface StructuredClassDraft {
  code: string;
  label: string;
  parallelCode: string | null;
}

/**
 * Construit le lot de classes (codes + libellés + groupes) sans écrire.
 */
export function buildStructuredClassBatch(options: {
  prefix: string;
  trainingYear: number;
  parallelCodes: Array<string | null>;
}): PedagogyMutationResult<StructuredClassDraft[]> {
  const prefix = normalizeClassCodePrefix(options.prefix);
  if (!prefix.ok) return prefix;
  if (!Number.isInteger(options.trainingYear) || options.trainingYear < 1) {
    return { ok: false, reason: "L'année de formation doit être un entier ≥ 1." };
  }
  if (options.parallelCodes.length === 0) {
    return { ok: false, reason: "Au moins une classe doit être prévue." };
  }

  const seen = new Set<string>();
  const drafts: StructuredClassDraft[] = [];
  for (const raw of options.parallelCodes) {
    const group = normalizeParallelCode(raw);
    if (!group.ok) return group;
    const key = group.value ?? "";
    if (seen.has(key)) {
      return { ok: false, reason: "Deux groupes identiques ne sont pas autorisés dans la même création." };
    }
    seen.add(key);
    drafts.push({
      code: buildClassCode({
        prefix: prefix.value,
        trainingYear: options.trainingYear,
        parallelCode: group.value,
      }),
      label: buildClassLabel({
        prefix: prefix.value,
        trainingYear: options.trainingYear,
        parallelCode: group.value,
      }),
      parallelCode: group.value,
    });
  }
  return { ok: true, value: drafts };
}
