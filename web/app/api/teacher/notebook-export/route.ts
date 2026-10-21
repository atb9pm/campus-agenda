import { loadTeacherNotebookDocument } from "@campus/features/class-notebook/annual-private-notes.ts";
import { exportTeacherNotebookPdf } from "@campus/features/notebook-export/index.ts";
import {
  getAgendaStore,
  getAnnualCourseNotesStore,
  getAnnualCourseStore,
} from "@campus/lib/persistence/store-factory.ts";
import {
  getCourseTimelineServiceDeps,
  getTeacherNotesStore,
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
    return jsonResponse({ ok: false, reason: "Corps JSON invalide." }, { status: 400 });
  }
  const annualCourseId =
    body && typeof body === "object" && "annualCourseId" in body
      ? String((body as { annualCourseId?: unknown }).annualCourseId ?? "").trim()
      : "";
  if (!annualCourseId) {
    return jsonResponse({ ok: false, reason: "Le cours à exporter est obligatoire." }, { status: 400 });
  }

  const [timelineDeps, agenda, teacherNotes, courseNotes, courses] = await Promise.all([
    getCourseTimelineServiceDeps(),
    getAgendaStore(),
    getTeacherNotesStore(),
    getAnnualCourseNotesStore(),
    getAnnualCourseStore(),
  ]);
  const notebookDeps = { teacherNotes, courseNotes, courses };

  const result = await exportTeacherNotebookPdf(
    {
      ...timelineDeps,
      agenda,
      notes: {
        getNotes: (teacherId) => loadTeacherNotebookDocument(teacherId, notebookDeps),
      },
    },
    {
      teacherId: auth.session!.teacherId,
      annualCourseId,
      options: body,
    },
  );

  if (!result.ok) {
    return jsonResponse({ ok: false, reason: result.reason }, { status: result.status });
  }

  return new Response(Buffer.from(result.pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Cache-Control": "no-store",
      "Content-Disposition": `inline; filename="${result.filename}"`,
    },
  });
}

export const POST = withApiObservability("/api/teacher/notebook-export", handlePost);
