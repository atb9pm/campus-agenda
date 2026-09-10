import { getSchoolYearStore } from "@campus/lib/persistence/store-factory.ts";
import { jsonResponse } from "../../../../lib/server/api.ts";
import { withApiObservability } from "../../../../lib/server/observability.ts";

async function handleGet() {
  const store = await getSchoolYearStore();
  const active = await store.getActiveSchoolYear();
  if (!active) {
    return jsonResponse({
      ok: true,
      calendar: {
        label: null,
        status: null,
        weeks: [],
        configured: false,
      },
    });
  }

  return jsonResponse({
    ok: true,
    calendar: {
      label: active.label,
      status: active.status,
      weeks: active.weeks,
      configured: true,
    },
  });
}

export const GET = withApiObservability("/api/school-year/calendar", handleGet);
