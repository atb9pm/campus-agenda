import { listComputedCourseSessions } from "@campus/features/course-sessions/index.ts";
import { getCourseScheduleServiceDeps, jsonResponse, requireAdminSession } from "../../../../lib/server/api.ts";
import { withApiObservability } from "../../../../lib/server/observability.ts";

async function handleGet(request: Request) {
  const auth = await requireAdminSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const url = new URL(request.url);
  const result = await listComputedCourseSessions(await getCourseScheduleServiceDeps(), {
    schoolYearId: url.searchParams.get("schoolYearId") ?? "",
    classId: url.searchParams.get("classId"),
    annualCourseId: url.searchParams.get("annualCourseId"),
  });

  if (!result.ok) {
    return jsonResponse({ ok: false, reason: result.reason, code: result.code }, { status: result.status ?? 400 });
  }

  return jsonResponse({ ok: true, sessions: result.value });
}

export const GET = withApiObservability("/api/admin/course-sessions", handleGet);
