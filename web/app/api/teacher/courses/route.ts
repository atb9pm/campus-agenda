import {
  listTeacherCourses,
  schoolYearIdFromSearchParams,
  sessionTeacherIdForCoursesApi,
} from "@campus/features/teacher-workspace";
import { teacherClassAccessViews } from "@campus/features/student-access/index.ts";
import { getStudentAccessStore } from "@campus/lib/persistence/store-factory.ts";
import type { TeacherClassAccessView } from "@campus/types/student-access";
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

async function classAccessesForTeacherCourses(
  courses: readonly { classId: string; classCode: string }[],
): Promise<Record<string, TeacherClassAccessView>> {
  try {
    const assigned = courses.map((course) => ({
      schoolClassId: course.classId,
      classCode: course.classCode,
    }));
    const classAccesses = await teacherClassAccessViews(await getStudentAccessStore(), assigned);
    assertNoSecretLeak(classAccesses);
    return classAccesses;
  } catch {
    return {};
  }
}

async function handleGet(request: Request) {
  const auth = await requireTeacherSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const url = new URL(request.url);
  // teacherId fourni par le client est ignoré — seule la session fait foi.
  const teacherId = sessionTeacherIdForCoursesApi(auth.session!.teacherId);
  const schoolYearId = schoolYearIdFromSearchParams(url.searchParams);
  const adminConsult = url.searchParams.get("consult") === "1";
  const isAdmin = await auth.store!.teacherIsAdmin(teacherId);

  const deps = await getAnnualCourseServiceDeps();
  const result = await listTeacherCourses(deps, {
    teacherId,
    schoolYearId,
    isAdmin,
    adminConsult,
  });
  const classAccesses = await classAccessesForTeacherCourses(result.courses);

  const body = {
    ok: true,
    schoolYearId: result.schoolYearId,
    courses: result.courses,
    classAccesses,
  };
  try {
    assertNoSecretLeak(body);
    return jsonResponse(body);
  } catch {
    return jsonResponse({
      ok: true,
      schoolYearId: result.schoolYearId,
      courses: result.courses,
      classAccesses: {},
    });
  }
}

export const GET = withApiObservability("/api/teacher/courses", handleGet);
