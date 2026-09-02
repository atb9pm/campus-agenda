import {
  listAccessibleRuntimeClassroomsForTeacher,
} from "@campus/features/control-planning/index.ts";
import {
  getAnnualCourseStore,
  getSchoolCatalogStore,
  getSchoolYearStore,
  listRuntimeClassrooms,
} from "@campus/lib/persistence/store-factory.ts";
import {
  jsonResponse,
  reconcileRuntimeStructuredClassrooms,
  requireTeacherSession,
} from "../../../../lib/server/api.ts";
import { withApiObservability } from "../../../../lib/server/observability.ts";

async function handleGet(request: Request) {
  const auth = await requireTeacherSession(request);
  if ("error" in auth && auth.error) return auth.error;

  await reconcileRuntimeStructuredClassrooms();

  const teacherId = auth.session!.teacherId;
  const catalog = await getSchoolCatalogStore();
  await catalog.ensureSeeded();
  const [classrooms, classes, courses, assignments, years] = await Promise.all([
    listRuntimeClassrooms(),
    catalog.listClasses(),
    getAnnualCourseStore().then((entry) => entry.listCourses()),
    getAnnualCourseStore().then((entry) => entry.listAssignments()),
    getSchoolYearStore().then((entry) => entry.listSchoolYears()),
  ]);

  const accessible = await listAccessibleRuntimeClassroomsForTeacher({
    teacherId,
    classrooms,
    classes,
    courses,
    assignments,
    years,
    teacherCanAccessClassroom: (id, classroomId) => auth.store!.teacherCanAccessClassroom(id, classroomId),
  });

  return jsonResponse({ ok: true, classrooms: accessible });
}

export const GET = withApiObservability("/api/teacher/classrooms", handleGet);
