import { getSchoolWeekEntries } from "@campus/features/calendar";
import { getSchoolYearStore } from "@campus/lib/persistence/store-factory.ts";
import { jsonResponse } from "../../../../lib/server/api.ts";
import { withApiObservability } from "../../../../lib/server/observability.ts";

async function handleGet() {
  const store = await getSchoolYearStore();
  const active = await store.getActiveSchoolYear();
  const weeks = active?.weeks ?? [...getSchoolWeekEntries()];

  return jsonResponse({
    ok: true,
    calendar: {
      label: active?.label ?? "2026-2027",
      status: active?.status ?? "active",
      weeks,
    },
  });
}

export const GET = withApiObservability("/api/school-year/calendar", handleGet);
