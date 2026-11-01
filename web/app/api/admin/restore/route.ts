import { restoreStoreSnapshot } from "@campus/lib/persistence/store-factory.ts";
import { logOperationalEvent, logOperationalWarning } from "@campus/lib/observability/index.ts";
import {
  isRestoreConfirmToken,
  RESTORE_CONFIRM_REQUIRED_REASON,
} from "@campus/features/admin-backup/index.ts";
import { jsonResponse, requireAdminSession } from "../../../../lib/server/api.ts";
import { withApiObservability } from "../../../../lib/server/observability.ts";
import { recordRequestSecurityEvent } from "../../../../lib/server/security-events.ts";

async function handlePost(request: Request) {
  const auth = await requireAdminSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const body = await request.json() as { snapshot?: unknown; confirmation?: unknown };
  if (!isRestoreConfirmToken(String(body.confirmation ?? ""))) {
    return jsonResponse(
      { ok: false, reason: RESTORE_CONFIRM_REQUIRED_REASON },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  const adminId = auth.session!.teacherId;
  const rawVersion = body.snapshot && typeof body.snapshot === "object" && "version" in body.snapshot
    ? (body.snapshot as { version?: number }).version
    : undefined;
  // Écrit avant la restauration : la trace survit même si la restauration échoue.
  await recordRequestSecurityEvent(request, {
    type: "BACKUP_RESTORE_STARTED",
    actorType: "TEACHER",
    actorId: adminId,
  });

  let result: Awaited<ReturnType<typeof restoreStoreSnapshot>>;
  try {
    result = await restoreStoreSnapshot(body.snapshot);
  } catch (error) {
    await recordRequestSecurityEvent(request, {
      type: "BACKUP_RESTORE_FAILED",
      severity: "CRITICAL",
      actorType: "TEACHER",
      actorId: adminId,
      httpStatus: 500,
      metadata: { failure: "unexpected-error" },
    });
    throw error;
  }

  if (!result.ok) {
    logOperationalWarning("agenda_backup_restore_rejected", { reason: result.reason, adminId });
    await recordRequestSecurityEvent(request, {
      type: "BACKUP_RESTORE_FAILED",
      actorType: "TEACHER",
      actorId: adminId,
      httpStatus: 400,
      metadata: { failure: "validation" },
    });
    return jsonResponse({ ok: false, reason: result.reason }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  await recordRequestSecurityEvent(request, {
    type: "BACKUP_RESTORE_SUCCEEDED",
    actorType: "TEACHER",
    actorId: adminId,
    httpStatus: 200,
    metadata: {
      ...(typeof rawVersion === "number" ? { formatVersion: rawVersion } : {}),
      restoredTables: result.restoredTables,
    },
  });

  logOperationalEvent("agenda_backup_restore", {
    version: rawVersion ?? 0,
    itemCount: result.itemCount,
    teacherSetupCount: result.teacherSetupCount,
    teacherNotesCount: result.teacherNotesCount,
    teacherAccountCount: result.teacherAccountCount,
    restoredTeacherData: result.restoredTeacherData,
    restoredTeacherAccounts: result.restoredTeacherAccounts,
    restoredTables: result.restoredTables,
    adminId: auth.session!.teacherId,
  });

  return jsonResponse({
    ok: true,
    itemCount: result.itemCount,
    teacherSetupCount: result.teacherSetupCount,
    teacherNotesCount: result.teacherNotesCount,
    teacherAccountCount: result.teacherAccountCount,
    restoredTeacherData: result.restoredTeacherData,
    restoredTeacherAccounts: result.restoredTeacherAccounts,
    restoredTables: result.restoredTables,
  }, { headers: { "Cache-Control": "no-store" } });
}

export const POST = withApiObservability("/api/admin/restore", handlePost);
