import { getSchoolYearStore } from "@campus/lib/persistence/store-factory.ts";
import { jsonResponse, requireTeacherSession } from "../../../../lib/server/api.ts";
import { withApiObservability } from "../../../../lib/server/observability.ts";

async function handleGet(request: Request) {
  const auth = await requireTeacherSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const years = await getSchoolYearStore().then((store) => store.listSchoolYears());
  return jsonResponse({ ok: true, years });
}

export const GET = withApiObservability("/api/admin/school-year", handleGet);
