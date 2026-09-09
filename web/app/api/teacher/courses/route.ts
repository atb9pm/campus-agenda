import {
  listTeacherCourses,
  schoolYearIdFromSearchParams,
  sessionTeacherIdForCoursesApi,
} from "@campus/features/teacher-workspace";
import { teacherClassAccessViews } from "@campus/features/student-access/index.ts";
import { getStudentAccessStore } from "@campus/lib/persistence/store-factory.ts";
import {
  getAnnualCourseServiceDeps,
  jsonResponse,
  requireTeacherSession,
} from "../../../../lib/server/api.ts";
import { withApiObservability } from "../../../../lib/server/observability.ts";

function assertNoSecretLeak(body: unknown): void {
  const serialized = JSON.stringify(body);
  if (
    serialized.includes("accessCodeHash")
    || serialized.includes("access_code_hash")
    || serialized.includes("accessCodeCiphertext")
    || serialized.includes("access_code_ciphertext")
    || serialized.includes("aes-gcm-v1$")
  ) {
    throw new Error("Le secret d'accès apprentis stocké ne doit jamais être envoyé brut au client enseignant.");
  }
}

async function handleGet(request: Request) {
  const auth = await requireTeacherSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const url = new URL(request.url);
  // teacherId fourni par le client est ignoré — seule la session fait foi.
  const teacherId = sessionTeacherIdForCoursesApi(auth.session!.teacherId);
  const schoolYearId = schoolYearIdFromSearchParams(url.searchParams);

  const deps = await getAnnualCourseServiceDeps();
  const result = await listTeacherCourses(deps, { teacherId, schoolYearId });
  const classIds = [...new Set(result.courses.map((course) => course.classId))];
  const classAccesses = await teacherClassAccessViews(await getStudentAccessStore(), classIds);

  const body = {
    ok: true,
    schoolYearId: result.schoolYearId,
    courses: result.courses,
    classAccesses,
  };
  assertNoSecretLeak(body);
  return jsonResponse(body);
}

export const GET = withApiObservability("/api/teacher/courses", handleGet);
