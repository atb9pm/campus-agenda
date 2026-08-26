import { setActiveSchoolWeekEntries } from "@campus/features/calendar/active-calendar.ts";
import { getSchoolYearStore } from "@campus/lib/persistence/store-factory.ts";
import { jsonResponse, requireTeacherSession } from "../../../../../lib/server/api.ts";
import { withApiObservability } from "../../../../../lib/server/observability.ts";

async function handlePost(request: Request) {
  const auth = await requireTeacherSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const body = (await request.json()) as { schoolYearId?: string };
  if (!body.schoolYearId) {
    return jsonResponse({ ok: false, reason: "Identifiant d'année scolaire requis." }, { status: 400 });
  }

  try {
    const store = await getSchoolYearStore();
    const active = await store.activateSchoolYear(body.schoolYearId);
    setActiveSchoolWeekEntries(active.weeks);
    return jsonResponse({ ok: true, active });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Activation impossible.";
    return jsonResponse({ ok: false, reason }, { status: 400 });
  }
}

export const POST = withApiObservability("/api/admin/school-year/activate", handlePost);
