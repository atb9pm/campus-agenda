import {
  publishReferenceItemToAgenda,
  structuredPublishIdsFromBody,
} from "@campus/features/course-publications/index.ts";
import {
  getStructuredPublishDeps,
  jsonResponse,
  requireTeacherSession,
} from "../../../../lib/server/api.ts";
import { withApiObservability } from "../../../../lib/server/observability.ts";

async function handlePost(request: Request) {
  const auth = await requireTeacherSession(request);
  if ("error" in auth && auth.error) return auth.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, reason: "Données de publication invalides." }, { status: 400 });
  }

  const ids = structuredPublishIdsFromBody(body);
  if (!ids.annualCourseId || !ids.courseSessionKey || !ids.referenceItemId) {
    return jsonResponse({ ok: false, reason: "Données de publication invalides." }, { status: 400 });
  }

  const result = await publishReferenceItemToAgenda(await getStructuredPublishDeps(), {
    teacherId: auth.session!.teacherId,
    annualCourseId: ids.annualCourseId,
    courseSessionKey: ids.courseSessionKey,
    referenceItemId: ids.referenceItemId,
  });

  if (!result.ok) {
    return jsonResponse({ ok: false, reason: result.reason }, { status: result.status });
  }

  return jsonResponse({ ok: true, item: result.item }, { status: 201 });
}

export const POST = withApiObservability("/api/teacher/course-publications", handlePost);
