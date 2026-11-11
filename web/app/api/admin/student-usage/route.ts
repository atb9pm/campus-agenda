import {
  STUDENT_USAGE_LOOKBACK_DAYS,
  buildStudentUsageDashboard,
  isStudentUsagePeriod,
  maybePurgeStudentUsage,
  schoolCalendarDateIso,
  usageWindow,
} from "@campus/features/student-usage/index.ts";
import { getSchoolCatalogStore, getStudentUsageStore } from "@campus/lib/persistence/store-factory.ts";

import { jsonResponse, requireAdminSession } from "../../../../lib/server/api.ts";
import { withApiObservability } from "../../../../lib/server/observability.ts";

const CLASS_FILTER = /^[\w-]{1,80}$/;

async function handleGet(request: Request) {
  const auth = await requireAdminSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const url = new URL(request.url);
  const period = Number(url.searchParams.get("period") ?? "7");
  if (!isStudentUsagePeriod(period)) {
    return jsonResponse({ ok: false, reason: "Période inconnue." }, { status: 400 });
  }
  const classParam = (url.searchParams.get("schoolClassId") ?? "").trim();
  if (classParam && !CLASS_FILTER.test(classParam)) {
    return jsonResponse({ ok: false, reason: "Classe inconnue." }, { status: 400 });
  }

  const now = new Date();
  const today = schoolCalendarDateIso(now);
  const store = await getStudentUsageStore();
  await maybePurgeStudentUsage(store, now);
  const [rows, classes] = await Promise.all([
    store.listBetween(usageWindow(today, STUDENT_USAGE_LOOKBACK_DAYS).start, today),
    getSchoolCatalogStore().then((catalog) => catalog.listClasses()),
  ]);

  return jsonResponse(
    {
      ok: true,
      ...buildStudentUsageDashboard({
        rows,
        today,
        period,
        schoolClassId: classParam || null,
        classes: classes.map((entry) => ({
          id: entry.id,
          code: entry.code,
          isArchived: entry.isArchived,
          schoolYearLabel: entry.schoolYearLabel,
        })),
      }),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export const GET = withApiObservability("/api/admin/student-usage", handleGet);
