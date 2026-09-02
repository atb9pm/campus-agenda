import { getControlPlanning } from "@campus/features/control-planning/index.ts";
import {
  jsonResponse,
  reconcileRuntimeStructuredClassrooms,
  requireTeacherSession,
} from "../../../../../lib/server/api.ts";
import {
  getAnnualCourseStore,
  getRuntimeAgendaAdapterStore,
  getSchoolCatalogStore,
  getSchoolYearStore,
  getTeacherAccountStore,
} from "@campus/lib/persistence/store-factory.ts";
import { withApiObservability } from "../../../../../lib/server/observability.ts";

function parseWeek(value: string | null): number | null {
  if (!value) return null;
  const week = Number(value);
  return Number.isInteger(week) && week > 0 ? week : null;
}

async function handleGet(request: Request) {
  const auth = await requireTeacherSession(request);
  if ("error" in auth && auth.error) return auth.error;

  await reconcileRuntimeStructuredClassrooms();

  const url = new URL(request.url);
  const result = await getControlPlanning(
    {
      agenda: auth.store!,
      adapters: await getRuntimeAgendaAdapterStore(),
      catalog: await getSchoolCatalogStore(),
      courses: await getAnnualCourseStore(),
      years: await getSchoolYearStore(),
      teachers: await getTeacherAccountStore(),
    },
    {
      teacherId: auth.session!.teacherId,
      schoolYearId: url.searchParams.get("schoolYearId"),
      classroomId: url.searchParams.get("classroomId"),
      mode: url.searchParams.get("mode"),
      week: parseWeek(url.searchParams.get("week")),
    },
  );

  if (!result.ok) {
    return jsonResponse({ ok: false, reason: result.reason }, { status: result.status });
  }

  return jsonResponse({ ok: true, ...result.view });
}

export const GET = withApiObservability("/api/teacher/controls/planning", handleGet);
