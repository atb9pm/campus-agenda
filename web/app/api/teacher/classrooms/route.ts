import {
  teacherHasStructuredClassroomReadAccess,
} from "@campus/features/agenda-bridge/index.ts";
import {
  getAnnualCourseStore,
  getRuntimeAgendaAdapterStore,
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
  const [classrooms, classes, courses, assignments, years, adapters] = await Promise.all([
    listRuntimeClassrooms(),
    catalog.listClasses(),
    getAnnualCourseStore().then((entry) => entry.listCourses()),
    getAnnualCourseStore().then((entry) => entry.listAssignments()),
    getSchoolYearStore().then((entry) => entry.listSchoolYears()),
    getRuntimeAgendaAdapterStore(),
  ]);

  const accessible = [];
  const seen = new Set<string>();
  for (const classroom of classrooms) {
    if (seen.has(classroom.id)) continue;
    const linked = classroom.schoolClassId
      ? classes.find((entry) => entry.id === classroom.schoolClassId) ?? null
      : await adapters.findClassroomById(classroom.id).then((entry) =>
          entry?.schoolClassId
            ? classes.find((schoolClass) => schoolClass.id === entry.schoolClassId) ?? null
            : null,
        );
    const allowed = linked
      ? teacherHasStructuredClassroomReadAccess({
          teacherId,
          schoolClass: linked,
          courses,
          assignments,
          years,
        })
      : await auth.store!.teacherCanAccessClassroom(teacherId, classroom.id);
    if (!allowed) continue;
    seen.add(classroom.id);
    accessible.push({ id: classroom.id, name: classroom.name });
  }
  return jsonResponse({ ok: true, classrooms: accessible });
}

export const GET = withApiObservability("/api/teacher/classrooms", handleGet);
