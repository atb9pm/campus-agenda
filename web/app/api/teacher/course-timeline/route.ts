import {
  annualCourseIdFromSearchParams,
  getTeacherCourseTimeline,
  sessionTeacherIdForTimelineApi,
} from "@campus/features/course-timeline/index.ts";
import {
  getCourseTimelineServiceDeps,
  jsonResponse,
  requireTeacherSession,
} from "../../../../lib/server/api.ts";
import { withApiObservability } from "../../../../lib/server/observability.ts";

async function handleGet(request: Request) {
  const auth = await requireTeacherSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const url = new URL(request.url);
  // teacherId fourni par le client est ignoré — seule la session fait foi.
  const teacherId = sessionTeacherIdForTimelineApi(auth.session!.teacherId);
  const annualCourseId = annualCourseIdFromSearchParams(url.searchParams);

  const result = await getTeacherCourseTimeline(await getCourseTimelineServiceDeps(), {
    teacherId,
    annualCourseId,
  });

  if (!result.ok) {
    return jsonResponse({ ok: false, reason: result.reason }, { status: result.status });
  }

  return jsonResponse({
    ok: true,
    course: result.course,
    timeline: result.timeline,
  });
}

export const GET = withApiObservability("/api/teacher/course-timeline", handleGet);
