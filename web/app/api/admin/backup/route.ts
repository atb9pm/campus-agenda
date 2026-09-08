import { exportStoreSnapshot } from "@campus/lib/persistence/store-factory.ts";
import { backupDownloadFilename } from "@campus/lib/persistence/backup.ts";
import { logOperationalEvent } from "@campus/lib/observability/index.ts";
import { jsonResponse, requireAdminSession } from "../../../../lib/server/api.ts";
import { withApiObservability } from "../../../../lib/server/observability.ts";

async function handleGet(request: Request) {
  const auth = await requireAdminSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const snapshot = await exportStoreSnapshot();
  const filename = backupDownloadFilename(snapshot.exportedAt);

  logOperationalEvent("agenda_backup_export", {
    version: snapshot.version,
    itemCount: snapshot.itemCount,
    teacherSetupCount: snapshot.teacherSetupCount,
    teacherNotesCount: snapshot.teacherNotesCount,
    teacherAccountCount: snapshot.teacherAccountCount,
    tableCount: Object.keys(snapshot.tables ?? {}).length,
    adminId: auth.session!.teacherId,
  });

  return jsonResponse(
    { ok: true, snapshot },
    {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    },
  );
}

export const GET = withApiObservability("/api/admin/backup", handleGet);
