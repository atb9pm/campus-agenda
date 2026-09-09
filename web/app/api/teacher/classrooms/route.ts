import {
  listAccessibleRuntimeClassroomsForTeacher,
} from "@campus/features/control-planning/index.ts";
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

  const accessible = await listAccessibleRuntimeClassroomsForTeacher({
    teacherId,
    classrooms,
    classes,
    courses,
    assignments,
    years,
    teacherCanAccessClassroom: (id, classroomId) => auth.store!.teacherCanAccessClassroom(id, classroomId),
  });

  const accessibleIds = new Set(accessible.map((entry) => entry.id));
  const subjects = (await adapters.listSubjects())
    .filter((subject) => accessibleIds.has(subject.classroomId))
    .map((subject) => ({
      id: subject.id,
      name: subject.name,
      classroomId: subject.classroomId,
      annualCourseId: subject.annualCourseId ?? null,
    }));

  return jsonResponse({
    ok: true,
    classrooms: accessible.map((entry) => {
      const runtime = classrooms.find((row) => row.id === entry.id);
      return {
        id: entry.id,
        name: entry.name,
        schoolClassId: runtime?.schoolClassId ?? null,
        subjects: subjects.filter((subject) => subject.classroomId === entry.id),
      };
    }),
  });
}

export const GET = withApiObservability("/api/teacher/classrooms", handleGet);
