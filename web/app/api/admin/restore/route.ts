import { restoreStoreSnapshot } from "@campus/lib/persistence/store-factory.ts";
import { logOperationalEvent, logOperationalWarning } from "@campus/lib/observability/index.ts";
import { jsonResponse, requireAdminSession } from "../../../../lib/server/api.ts";
import { withApiObservability } from "../../../../lib/server/observability.ts";

async function handlePost(request: Request) {
  const auth = await requireAdminSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const body = await request.json() as { snapshot?: unknown };
  const result = await restoreStoreSnapshot(body.snapshot);

  if (!result.ok) {
    logOperationalWarning("agenda_backup_restore_rejected", { reason: result.reason, adminId: auth.session!.teacherId });
    return jsonResponse({ ok: false, reason: result.reason }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  const rawVersion = body.snapshot && typeof body.snapshot === "object" && "version" in body.snapshot
    ? (body.snapshot as { version?: number }).version
    : undefined;

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
