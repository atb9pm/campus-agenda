import type { SqlDatabase } from "../../lib/persistence/sql/types.ts";
import { applyCatalogDeleteInMemory } from "./apply-memory.ts";
import { previewFromPlan } from "./preview.ts";
import { buildCatalogDeletePlan } from "./plan.ts";
import { loadCatalogDeleteSnapshot, type CatalogDeleteSnapshotDeps } from "./snapshot.ts";
import { buildCatalogDeleteStatements, SQL_ROLLBACK_PROBE } from "./sql-statements.ts";
import {
  confirmationMatches,
  hasDestructiveDependencies,
  missingConfirmationReason,
  wrongConfirmationReason,
  type CatalogDeleteKind,
  type CatalogDeletePlan,
  type CatalogDeletePreview,
} from "./types.ts";

export interface CatalogDeleteServiceResult {
  ok: boolean;
  status: number;
  reason?: string;
  preview?: CatalogDeletePreview;
  plan?: CatalogDeletePlan;
}

export async function previewCatalogDelete(
  deps: CatalogDeleteSnapshotDeps,
  kind: CatalogDeleteKind,
  id: string,
): Promise<CatalogDeleteServiceResult> {
  const snapshot = await loadCatalogDeleteSnapshot(deps);
  const plan = buildCatalogDeletePlan(kind, id, snapshot);
  if (!plan) {
    return { ok: false, status: 404, reason: notFoundReason(kind) };
  }
  return { ok: true, status: 200, preview: previewFromPlan(plan), plan };
}

export async function deleteCatalogItemPermanently(
  deps: CatalogDeleteSnapshotDeps & { sqlDb?: SqlDatabase | null },
  options: {
    kind: CatalogDeleteKind;
    id: string;
    confirmationText?: string | null;
    injectFailure?: boolean;
  },
): Promise<CatalogDeleteServiceResult> {
  const snapshot = await loadCatalogDeleteSnapshot(deps);
  const plan = buildCatalogDeletePlan(options.kind, options.id, snapshot);
  if (!plan) {
    return { ok: false, status: 404, reason: notFoundReason(options.kind) };
  }

  const confirmed = confirmationMatches(plan.confirmationText, options.confirmationText);
  if (hasDestructiveDependencies(plan) && !confirmed) {
    if (options.confirmationText && options.confirmationText.trim()) {
      return {
        ok: false,
        status: 400,
        reason: wrongConfirmationReason(plan.confirmationText),
        preview: previewFromPlan(plan),
        plan,
      };
    }
    return {
      ok: false,
      status: 409,
      reason: missingConfirmationReason(plan.confirmationText),
      preview: previewFromPlan(plan),
      plan,
    };
  }

  if (deps.sqlDb) {
    const statements = buildCatalogDeleteStatements(plan, snapshot);
    if (options.injectFailure) {
      const pivot = Math.max(1, Math.floor(statements.length / 2));
      statements.splice(pivot, 0, SQL_ROLLBACK_PROBE);
    }
    await deps.sqlDb.batch(statements);
  } else {
    await applyCatalogDeleteInMemory(plan, deps);
  }

  return { ok: true, status: 200, preview: previewFromPlan(plan), plan };
}

function notFoundReason(kind: CatalogDeleteKind): string {
  if (kind === "class") return "Classe introuvable.";
  if (kind === "profession") return "Profession introuvable.";
  if (kind === "branch") return "Branche introuvable.";
  return "Contexte pédagogique introuvable.";
}
