import { exportSchoolYearSnapshot, schoolYearExportToCsv } from "@campus/lib/persistence/year-export.ts";
import { getAgendaStore, getSchoolYearStore } from "@campus/lib/persistence/store-factory.ts";
import { jsonResponse, requireAdminSession } from "../../../../../../lib/server/api.ts";
import { withApiObservability } from "../../../../../../lib/server/observability.ts";

async function handleGet(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const { id } = await context.params;
  const url = new URL(request.url);
  const format = url.searchParams.get("format")?.trim().toLowerCase() ?? "json";

  const schoolYearStore = await getSchoolYearStore();
  const year = await schoolYearStore.getSchoolYearById(id);
  if (!year) {
    return jsonResponse({ ok: false, reason: "Année scolaire introuvable." }, { status: 404 });
  }

  const store = await getAgendaStore();
  const snapshot = await exportSchoolYearSnapshot(store, id, year.label);

  if (format === "csv") {
    const csv = schoolYearExportToCsv(snapshot);
    const headers = new Headers({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="campus-agenda-${year.label}.csv"`,
    });
    return new Response(csv, { headers });
  }

  return jsonResponse({ ok: true, snapshot });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return withApiObservability("/api/admin/school-year/[id]/export", (req) => handleGet(req, context))(request);
}
