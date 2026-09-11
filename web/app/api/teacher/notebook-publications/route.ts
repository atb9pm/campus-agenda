import {
  createNotebookPublication,
  notebookPublicationFromBody,
  resolveNotebookPublishContext,
} from "@campus/features/class-notebook";
import {
  getNotebookPublicationDeps,
  jsonResponse,
  requireTeacherSession,
} from "../../../../lib/server/api.ts";
import { withApiObservability } from "../../../../lib/server/observability.ts";

async function handlePost(request: Request) {
  const auth = await requireTeacherSession(request);
  if ("error" in auth && auth.error) return auth.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, reason: "Données de publication invalides." }, { status: 400 });
  }

  const parsed = notebookPublicationFromBody(body);
  const deps = await getNotebookPublicationDeps();
  const teacherId = auth.session!.teacherId;

  if (parsed.ensureOnly) {
    const resolved = await resolveNotebookPublishContext(deps, {
      teacherId,
      annualCourseId: parsed.annualCourseId,
    });
    if (!resolved.ok) {
      return jsonResponse({ ok: false, reason: resolved.reason }, { status: resolved.status });
    }
    return jsonResponse({
      ok: true,
      classroomId: resolved.value.classroom.id,
      subjectId: resolved.value.subject.id,
      annualCourseId: resolved.value.course.id,
    });
  }

  const result = await createNotebookPublication(deps, {
    teacherId,
    annualCourseId: parsed.annualCourseId,
    schoolWeekNumber: parsed.schoolWeekNumber,
    day: parsed.day,
    type: parsed.type,
    title: parsed.title,
    detail: parsed.detail,
  });

  if (!result.ok) {
    return jsonResponse({ ok: false, reason: result.reason }, { status: result.status });
  }

  return jsonResponse(
    {
      ok: true,
      item: result.value,
      classroomId: result.value.classroomId,
      subjectId: result.value.subjectId,
      annualCourseId: result.value.annualCourseId,
    },
    { status: 201 },
  );
}

export const POST = withApiObservability("/api/teacher/notebook-publications", handlePost);
