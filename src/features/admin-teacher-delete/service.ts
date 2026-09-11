import {
  confirmationMatches,
  LAST_ADMIN_DELETE_REASON,
  missingConfirmationReason,
  TEACHER_NOT_FOUND_REASON,
  wrongConfirmationReason,
  type TeacherDeletePlan,
  type TeacherDeletePreview,
} from "./types.ts";
import { previewFromTeacherPlan } from "./preview.ts";
import { applyTeacherDeleteInMemory } from "./apply-memory.ts";
import { buildTeacherDeletePlan, type TeacherDeleteSnapshotDeps } from "./snapshot.ts";
import { buildTeacherDeleteStatements, SQL_TEACHER_DELETE_ROLLBACK_PROBE } from "./sql-statements.ts";

export interface TeacherDeleteServiceResult {
  ok: boolean;
  status: number;
  reason?: string;
  preview?: TeacherDeletePreview;
  plan?: TeacherDeletePlan;
}

export async function previewTeacherDelete(
  deps: TeacherDeleteSnapshotDeps,
  teacherId: string,
): Promise<TeacherDeleteServiceResult> {
  const plan = await buildTeacherDeletePlan(deps, teacherId);
  if (!plan) {
    return { ok: false, status: 404, reason: TEACHER_NOT_FOUND_REASON };
  }
  return { ok: true, status: 200, preview: previewFromTeacherPlan(plan), plan };
}

export async function deleteTeacherPermanently(
  deps: TeacherDeleteSnapshotDeps,
  options: {
    teacherId: string;
    confirmationText?: string | null;
    injectFailure?: boolean;
  },
): Promise<TeacherDeleteServiceResult> {
  const plan = await buildTeacherDeletePlan(deps, options.teacherId);
  if (!plan) {
    return { ok: false, status: 404, reason: TEACHER_NOT_FOUND_REASON };
  }

  const preview = previewFromTeacherPlan(plan);

  if (plan.lastAdminBlocked) {
    return {
      ok: false,
      status: 409,
      reason: LAST_ADMIN_DELETE_REASON,
      preview,
      plan,
    };
  }

  const confirmed = confirmationMatches(plan.confirmationText, options.confirmationText);
  if (!confirmed) {
    if (options.confirmationText?.trim()) {
      return {
        ok: false,
        status: 400,
        reason: wrongConfirmationReason(plan.confirmationText),
        preview,
        plan,
      };
    }
    return {
      ok: false,
      status: 409,
      reason: missingConfirmationReason(plan.confirmationText),
      preview,
      plan,
    };
  }

  if (deps.sqlDb) {
    const statements = buildTeacherDeleteStatements(plan.target.id);
    if (options.injectFailure) {
      const pivot = Math.max(1, Math.floor(statements.length / 2));
      statements.splice(pivot, 0, SQL_TEACHER_DELETE_ROLLBACK_PROBE);
    }
    await deps.sqlDb.batch(statements);
  } else {
    await applyTeacherDeleteInMemory(plan, deps);
  }

  return { ok: true, status: 200, preview, plan };
}
