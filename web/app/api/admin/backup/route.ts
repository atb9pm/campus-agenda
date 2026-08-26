import { exportAgendaSnapshot } from "@campus/lib/persistence/backup.ts";
import { logOperationalEvent } from "@campus/lib/observability/index.ts";
import { jsonResponse, requireTeacherSession } from "../../../../lib/server/api.ts";
import { withApiObservability } from "../../../../lib/server/observability.ts";

async function handleGet(request: Request) {
  const auth = await requireTeacherSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const snapshot = await exportAgendaSnapshot(auth.store!);
  logOperationalEvent("agenda_backup_export", {
    itemCount: snapshot.itemCount,
    teacherId: auth.session!.teacherId,
  });

  return jsonResponse({ ok: true, snapshot });
}

export const GET = withApiObservability("/api/admin/backup", handleGet);
