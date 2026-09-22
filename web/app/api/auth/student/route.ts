import {
  jsonResponse,
  jsonWithSession,
} from "../../../../lib/server/api.ts";
import {
  getRuntimeAgendaAdapterStore,
  getSchoolCatalogStore,
  getSchoolYearStore,
  getStudentAccessStore,
} from "@campus/lib/persistence/store-factory.ts";
import {
  authenticateStudentAccessCode,
  STUDENT_LOGIN_INVALID_REASON,
} from "@campus/features/student-access/index.ts";
import { authRateLimitTargetFromStudentCode } from "@campus/lib/security/rate-limit.ts";
import { enforceAuthRateLimit } from "../../../../lib/server/rate-limit.ts";
import { readBoundedJson } from "../../../../lib/server/read-bounded-json.ts";

export async function POST(request: Request) {
  const ipLimited = await enforceAuthRateLimit(request, "student", { layer: "ip" });
  if (ipLimited) return ipLimited;

  const parsed = await readBoundedJson<{ code?: string; remember?: boolean }>(request);
  if (!parsed.ok) {
    if (parsed.reason === "too-large") {
      return jsonResponse({ ok: false, reason: "Requête trop volumineuse." }, { status: 413 });
    }
    const targetLimited = await enforceAuthRateLimit(request, "student", {
      targetKey: authRateLimitTargetFromStudentCode(""),
      layer: "target",
    });
    if (targetLimited) return targetLimited;
    return jsonResponse({ ok: false, reason: STUDENT_LOGIN_INVALID_REASON }, { status: 401 });
  }

  const code = String(parsed.value.code ?? "");
  const targetLimited = await enforceAuthRateLimit(request, "student", {
    targetKey: authRateLimitTargetFromStudentCode(code),
    layer: "target",
  });
  if (targetLimited) return targetLimited;

  const [accesses, catalog, years, adapters] = await Promise.all([
    getStudentAccessStore(),
    getSchoolCatalogStore(),
    getSchoolYearStore(),
    getRuntimeAgendaAdapterStore(),
  ]);
  await catalog.ensureSeeded();

  const result = await authenticateStudentAccessCode(code, {
    getActiveSchoolYear: () => years.getActiveSchoolYear(),
    listClasses: () => catalog.listClasses(),
    getAccessBySchoolClassId: (schoolClassId) => accesses.getBySchoolClassId(schoolClassId),
    findClassroomBySchoolClassId: (schoolClassId) => adapters.findClassroomBySchoolClassId(schoolClassId),
  });

  if (!result.ok) {
    return jsonResponse({ ok: false, reason: STUDENT_LOGIN_INVALID_REASON }, { status: 401 });
  }

  return jsonWithSession(
    result.session,
    {
      ok: true,
      session: {
        kind: "student",
        accessId: result.session.accessId,
        label: result.session.label,
        classroomId: result.session.classroomId,
        classroomName: result.classroomName,
        schoolClassId: result.session.schoolClassId,
        schoolYearId: result.session.schoolYearId,
      },
    },
    {},
    parsed.value.remember !== false,
  );
}
