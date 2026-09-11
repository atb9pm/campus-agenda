import {
  buildSchoolDayPlan,
  countClassDays,
  listHolidayDays,
  valaisHolidaysForSchoolYear,
} from "@campus/features/school-days/index.ts";
import { assertCalendarYearWritable, resolveSchoolYearForPlan } from "@campus/features/school-year/working-year-plan.ts";
import { getSchoolYearStore } from "@campus/lib/persistence/store-factory.ts";
import { jsonResponse, requireAdminSession } from "../../../../../../lib/server/api.ts";
import { withApiObservability } from "../../../../../../lib/server/observability.ts";

async function handlePatch(request: Request) {
  const auth = await requireAdminSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const body = (await request.json()) as {
    schoolYearId?: unknown;
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
  const requestedId = typeof body.schoolYearId === "string" ? body.schoolYearId : new URL(request.url).searchParams.get("schoolYearId");
  const year = await resolveSchoolYearForPlan(store, requestedId);
  if (!year) {
    return jsonResponse({ ok: false, reason: "Année scolaire introuvable." }, { status: 404 });
  }

  const writable = assertCalendarYearWritable(year);
  if (!writable.ok) {
    return jsonResponse({ ok: false, reason: writable.reason }, { status: 400 });
  }

  try {
    const exceptions = await store.setDayException(
      year.id,
      body.date,
      body.state ? { state: body.state, label: body.label?.trim() ? body.label.trim() : null } : null,
    );

    const rows = buildSchoolDayPlan(year.weeks, valaisHolidaysForSchoolYear(year.label), exceptions);
    return jsonResponse({
      ok: true,
      rows,
      classDayCount: countClassDays(rows),
      holidays: listHolidayDays(rows),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Enregistrement impossible.";
    return jsonResponse({ ok: false, reason }, { status: 400 });
  }
}

export const PATCH = withApiObservability("/api/admin/school-year/active-plan/days", handlePatch);
