import {
  contextBranchForCourse,
  ensureRuntimeSubjectForAnnualCourse,
} from "@campus/features/agenda-bridge/index.ts";
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
import {
  getAgendaStore,
  getAnnualCourseStore,
  getRuntimeAgendaAdapterStore,
  getSchoolCatalogStore,
} from "@campus/lib/persistence/store-factory.ts";
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

  const [agenda, catalog, courses, adapters] = await Promise.all([
    getAgendaStore(),
    getSchoolCatalogStore(),
    getAnnualCourseStore(),
    getRuntimeAgendaAdapterStore(),
  ]);
  await catalog.ensureSeeded();
  const [classes, branches, contexts] = await Promise.all([
    catalog.listClasses(),
    catalog.listBranches(),
    catalog.listContexts(),
  ]);
  const course = await courses.getCourse(result.course.annualCourseId);
  const schoolClass = course ? classes.find((entry) => entry.id === course.classId) ?? null : null;
  const branchInfo = course ? contextBranchForCourse({ course, contexts, branches }) : null;
  if (course && schoolClass && branchInfo) {
    const allCourses = await courses.listCourses();
    await ensureRuntimeSubjectForAnnualCourse(adapters, {
      schoolClass,
      course,
      branch: branchInfo.branch,
      allSchoolClasses: classes,
      courses: allCourses,
      contexts,
      branches,
    });
  }

  const publications = (await agenda.listAgendaItemsByAnnualCourse(result.course.annualCourseId)).map((item) => ({
    agendaItemId: item.id,
    referenceItemId: item.referenceItemId ?? null,
    courseSessionKey: item.courseSessionKey ?? null,
    courseSessionDate: item.courseSessionDate ?? null,
    type: item.type,
  }));

  return jsonResponse({
    ok: true,
    course: result.course,
    timeline: result.timeline,
    publications,
  });
}

export const GET = withApiObservability("/api/teacher/course-timeline", handleGet);
