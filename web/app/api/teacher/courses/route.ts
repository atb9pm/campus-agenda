import {
  listTeacherCourses,
  schoolYearIdFromSearchParams,
  sessionTeacherIdForCoursesApi,
} from "@campus/features/teacher-workspace";
import {
  getAnnualCourseServiceDeps,
  jsonResponse,
  requireTeacherSession,
} from "../../../../lib/server/api.ts";
import { withApiObservability } from "../../../../lib/server/observability.ts";

async function handleGet(request: Request) {
  const auth = await requireTeacherSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const url = new URL(request.url);
  // teacherId fourni par le client est ignoré — seule la session fait foi.
  const teacherId = sessionTeacherIdForCoursesApi(auth.session!.teacherId);
  const schoolYearId = schoolYearIdFromSearchParams(url.searchParams);

  const deps = await getAnnualCourseServiceDeps();
  const result = await listTeacherCourses(deps, { teacherId, schoolYearId });

  return jsonResponse({
    ok: true,
    schoolYearId: result.schoolYearId,
    courses: result.courses,
  });
}

export const GET = withApiObservability("/api/teacher/courses", handleGet);
