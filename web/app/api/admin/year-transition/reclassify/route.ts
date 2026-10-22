import {
  YearTransitionReclassifyAuthError,
  applyYearTransitionReclassify,
  listYearTransitionReclassifyQueue,
  parseYearTransitionReclassifyRequest,
} from "@campus/features/year-transition/index.ts";
import { getYearTransitionPrepareDeps } from "@campus/lib/persistence/store-factory.ts";
import { jsonResponse, requireAdminSession } from "../../../../../lib/server/api.ts";
import { withApiObservability } from "../../../../../lib/server/observability.ts";

async function reclassifyDeps() {
  const deps = await getYearTransitionPrepareDeps();
  if (!deps.notes) {
    throw new Error("Le magasin de notes n’est pas disponible.");
  }
  return {
    years: deps.years,
    catalog: deps.catalog,
    courses: deps.courses,
    agenda: deps.agenda,
    notes: deps.notes,
    schedules: deps.schedules,
  };
}

async function handleGet(request: Request) {
  const auth = await requireAdminSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const schoolYearId = new URL(request.url).searchParams.get("schoolYearId")?.trim() ?? "";
  if (!schoolYearId) {
    return jsonResponse({ ok: false, reason: "Année scolaire obligatoire." }, { status: 400 });
  }

  try {
    const queue = await listYearTransitionReclassifyQueue(await reclassifyDeps(), schoolYearId, {
      isAdmin: true,
      kind: "admin",
    });
    return jsonResponse({ ok: true, ...queue });
  } catch (error) {
    if (error instanceof YearTransitionReclassifyAuthError) {
      return jsonResponse({ ok: false, reason: error.message }, { status: 403 });
    }
    return jsonResponse(
      { ok: false, reason: error instanceof Error ? error.message : "Chargement impossible." },
      { status: 400 },
    );
  }
}

async function handlePost(request: Request) {
  const auth = await requireAdminSession(request);
  if ("error" in auth && auth.error) return auth.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, reason: "Corps JSON invalide." }, { status: 400 });
  }

  try {
    const parsed = parseYearTransitionReclassifyRequest(body);
    const result = await applyYearTransitionReclassify(await reclassifyDeps(), parsed, {
      isAdmin: true,
      kind: "admin",
    });
    if (!result.ok) {
      return jsonResponse(
        { ok: false, code: result.code, reason: result.reason, count: undefined },
        { status: result.status },
      );
    }
    return jsonResponse({
      ok: true,
      count: result.queue.count,
      complete: result.queue.complete,
      queue: result.queue,
    });
  } catch (error) {
    if (error instanceof YearTransitionReclassifyAuthError) {
      return jsonResponse({ ok: false, reason: error.message }, { status: 403 });
    }
    return jsonResponse(
      { ok: false, reason: error instanceof Error ? error.message : "Reclassement impossible." },
      { status: 400 },
    );
  }
}

export const GET = withApiObservability("/api/admin/year-transition/reclassify", handleGet);
export const POST = withApiObservability("/api/admin/year-transition/reclassify", handlePost);
