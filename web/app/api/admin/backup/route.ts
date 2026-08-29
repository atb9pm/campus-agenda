import { exportAgendaSnapshot } from "@campus/lib/persistence/backup.ts";
import { logOperationalEvent } from "@campus/lib/observability/index.ts";
import {
  getTeacherAccountsStore,
  getTeacherNotesStore,
  getTeacherSetupsStore,
  jsonResponse,
  requireTeacherSession,
} from "../../../../lib/server/api.ts";
import { withApiObservability } from "../../../../lib/server/observability.ts";

async function handleGet(request: Request) {
  const auth = await requireTeacherSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const [teacherSetups, teacherNotes, teacherAccounts] = await Promise.all([
    getTeacherSetupsStore(),
    getTeacherNotesStore(),
    getTeacherAccountsStore(),
  ]);

  const snapshot = await exportAgendaSnapshot({
    agenda: auth.store!,
    teacherSetups,
    teacherNotes,
    teacherAccounts,
  });

  logOperationalEvent("agenda_backup_export", {
    itemCount: snapshot.itemCount,
    teacherSetupCount: snapshot.teacherSetupCount,
    teacherNotesCount: snapshot.teacherNotesCount,
    teacherAccountCount: snapshot.teacherAccountCount,
    teacherId: auth.session!.teacherId,
  });

  return jsonResponse({ ok: true, snapshot });
}

export const GET = withApiObservability("/api/admin/backup", handleGet);
