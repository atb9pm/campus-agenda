import { computeClassYearStats } from "@campus/features/memberships/year-stats.ts";
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
  const classroomId = url.searchParams.get("classroomId")?.trim();
  if (!classroomId) {
    return jsonResponse({ ok: false, reason: "Paramètre classroomId requis." }, { status: 400 });
  }

  const schoolYearStore = await getSchoolYearStore();
  const year = await schoolYearStore.getSchoolYearById(id);
  if (!year) {
    return jsonResponse({ ok: false, reason: "Année scolaire introuvable." }, { status: 404 });
  }

  const store = await getAgendaStore();
  const stats = computeClassYearStats(await store.exportAllItems(), classroomId, id);

  return jsonResponse({
    ok: true,
    stats,
    schoolYear: { id: year.id, label: year.label, status: year.status },
  });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return withApiObservability("/api/admin/school-year/[id]/stats", (req) => handleGet(req, context))(request);
}
