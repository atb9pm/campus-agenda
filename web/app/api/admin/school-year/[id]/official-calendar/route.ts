import { officialEventsFromExceptions } from "@campus/features/school-year";
import { getSchoolYearStore } from "@campus/lib/persistence/store-factory.ts";
import { jsonResponse, requireAdminSession } from "../../../../../../lib/server/api.ts";
import { withApiObservability } from "../../../../../../lib/server/observability.ts";

async function handleGet(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const { id } = await context.params;
  const store = await getSchoolYearStore();
  const year = await store.getSchoolYearById(id);
  if (!year) {
    return jsonResponse({ ok: false, reason: "Année scolaire introuvable." }, { status: 404 });
  }

  const exceptions = await store.listDayExceptions(id);
  const events = officialEventsFromExceptions(exceptions);

  return jsonResponse({
    ok: true,
    year: {
      id: year.id,
      label: year.label,
      status: year.status,
      startsOn: year.startsOn,
      endsOn: year.endsOn,
    },
    weeks: year.weeks,
    events,
    eventCount: events.length,
  });
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return withApiObservability("/api/admin/school-year/[id]/official-calendar", (req) =>
    handleGet(req, context),
  )(request);
}
