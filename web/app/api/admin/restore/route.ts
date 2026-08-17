import { restoreAgendaSnapshot } from "@campus/lib/persistence/backup.ts";
import { logOperationalEvent, logOperationalWarning } from "@campus/lib/observability/index.ts";
import { jsonResponse, requireTeacherSession } from "../../../../lib/server/api.ts";
import { withApiObservability } from "../../../../lib/server/observability.ts";

async function handlePost(request: Request) {
  const auth = await requireTeacherSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const body = await request.json() as { snapshot?: unknown };
  const result = restoreAgendaSnapshot(auth.store!, body.snapshot);
  if (!result.ok) {
    logOperationalWarning("agenda_backup_restore_rejected", { reason: result.reason });
    return jsonResponse({ ok: false, reason: result.reason }, { status: 400 });
  }

  logOperationalEvent("agenda_backup_restore", {
    itemCount: result.itemCount,
    teacherId: auth.session!.teacherId,
  });

  return jsonResponse({ ok: true, itemCount: result.itemCount });
}

export const POST = withApiObservability("/api/admin/restore", handlePost);
