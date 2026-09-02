import {
  STRUCTURED_CONTROL_MOVE_FREE_PLACEMENT_REASON,
  moveStructuredControlToCourseSession,
  structuredControlMoveIdsFromBody,
} from "@campus/features/course-publications/index.ts";
import {
  getStructuredPublishDeps,
  jsonResponse,
  reconcileRuntimeStructuredClassrooms,
  requireTeacherSession,
} from "../../../../../../lib/server/api.ts";
import { withApiObservability } from "../../../../../../lib/server/observability.ts";

async function handlePost(request: Request, context?: { params: Promise<{ agendaItemId: string }> }) {
  const auth = await requireTeacherSession(request);
  if ("error" in auth && auth.error) return auth.error;

  await reconcileRuntimeStructuredClassrooms();

  const { agendaItemId: rawId } = await (context?.params ?? Promise.resolve({ agendaItemId: "" }));
  const agendaItemId = Number(rawId);
  if (!Number.isInteger(agendaItemId) || agendaItemId <= 0) {
    return jsonResponse({ ok: false, reason: "Identifiant de contrôle invalide." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, reason: "Données de déplacement invalides." }, { status: 400 });
  }

  const parsed = structuredControlMoveIdsFromBody(body);
  if (parsed.rejectedFreePlacement) {
    return jsonResponse({ ok: false, reason: STRUCTURED_CONTROL_MOVE_FREE_PLACEMENT_REASON }, { status: 400 });
  }
  if (!parsed.annualCourseId || !parsed.courseSessionKey) {
    return jsonResponse({ ok: false, reason: "Identifiants de séance incomplets." }, { status: 400 });
  }

  const result = await moveStructuredControlToCourseSession(await getStructuredPublishDeps(), {
    teacherId: auth.session!.teacherId,
    agendaItemId,
    annualCourseId: parsed.annualCourseId,
    courseSessionKey: parsed.courseSessionKey,
    confirmCoordination: parsed.confirmCoordination,
  });

  if (!result.ok) {
    return jsonResponse(
      {
        ok: false,
        reason: result.reason,
        code: result.code,
        coordination: result.coordination,
      },
      { status: result.status },
    );
  }

  return jsonResponse({
    ok: true,
    item: result.item,
    coordination: result.coordination,
    moved: result.moved,
  });
}

export const POST = withApiObservability("/api/teacher/controls/[agendaItemId]/move", handlePost);
