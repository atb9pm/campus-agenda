import {
  buildSchoolDayPlan,
  countClassDays,
  listHolidayDays,
  valaisHolidaysForSchoolYear,
} from "@campus/features/school-days/index.ts";
import { getSchoolYearStore } from "@campus/lib/persistence/store-factory.ts";
import { jsonResponse, requireAdminSession } from "../../../../../../lib/server/api.ts";
import { withApiObservability } from "../../../../../../lib/server/observability.ts";

async function handlePatch(request: Request) {
  const auth = await requireAdminSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const body = (await request.json()) as {
    date?: string;
    state?: "class" | "holiday" | null;
    label?: string | null;
  };

  if (typeof body.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
    return jsonResponse({ ok: false, reason: "Date invalide." }, { status: 400 });
  }
  if (body.state !== null && body.state !== "class" && body.state !== "holiday") {
    return jsonResponse({ ok: false, reason: "État invalide (class, holiday ou null)." }, { status: 400 });
  }

  const store = await getSchoolYearStore();
  const active = await store.getActiveSchoolYear();
  if (!active) {
    return jsonResponse({ ok: false, reason: "Aucune année scolaire active." }, { status: 404 });
  }

  const exceptions = await store.setDayException(
    active.id,
    body.date,
    body.state ? { state: body.state, label: body.label?.trim() ? body.label.trim() : null } : null,
  );

  const rows = buildSchoolDayPlan(active.weeks, valaisHolidaysForSchoolYear(active.label), exceptions);
  return jsonResponse({
    ok: true,
    rows,
    classDayCount: countClassDays(rows),
    holidays: listHolidayDays(rows),
  });
}

export const PATCH = withApiObservability("/api/admin/school-year/active-plan/days", handlePatch);
