import {
  manualControlIdsFromBody,
  publishManualControlToAgenda,
} from "@campus/features/course-publications/index.ts";
import {
  getStructuredPublishDeps,
  jsonResponse,
  reconcileRuntimeStructuredClassrooms,
  requireTeacherSession,
} from "../../../../lib/server/api.ts";
import { withApiObservability } from "../../../../lib/server/observability.ts";

async function handlePost(request: Request) {
  const auth = await requireTeacherSession(request);
  if ("error" in auth && auth.error) return auth.error;

  await reconcileRuntimeStructuredClassrooms();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, reason: "Données de publication invalides." }, { status: 400 });
  }

  const parsed = manualControlIdsFromBody(body);
  if (!parsed.annualCourseId || !parsed.courseSessionKey) {
    return jsonResponse({ ok: false, reason: "Identifiants de séance incomplets." }, { status: 400 });
  }

  const result = await publishManualControlToAgenda(await getStructuredPublishDeps(), {
    teacherId: auth.session!.teacherId,
    annualCourseId: parsed.annualCourseId,
    courseSessionKey: parsed.courseSessionKey,
    title: parsed.title,
    detail: parsed.detail,
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

  return jsonResponse({ ok: true, item: result.item, coordination: result.coordination }, { status: 201 });
}

export const POST = withApiObservability("/api/teacher/controls", handlePost);
