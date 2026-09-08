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
import { enforceAuthRateLimit } from "../../../../lib/server/rate-limit.ts";

export async function POST(request: Request) {
  const limited = await enforceAuthRateLimit(request, "student");
  if (limited) return limited;

  const body = await request.json() as { code?: string; remember?: boolean };
  const [accesses, catalog, years, adapters] = await Promise.all([
    getStudentAccessStore(),
    getSchoolCatalogStore(),
    getSchoolYearStore(),
    getRuntimeAgendaAdapterStore(),
  ]);
  await catalog.ensureSeeded();

  const result = await authenticateStudentAccessCode(String(body.code ?? ""), {
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
    body.remember !== false,
  );
}
