import { isClassNotesPayload, normalizeClassNotes } from "@campus/features/class-notebook";
import {
  loadTeacherNotebookDocument,
  persistTeacherNotebookDocument,
} from "@campus/features/class-notebook/annual-private-notes.ts";
import { getAnnualCourseNotesStore, getAnnualCourseStore } from "@campus/lib/persistence/store-factory.ts";
import {
  getTeacherNotesStore,
  jsonResponse,
  requireTeacherSession,
} from "../../../../lib/server/api.ts";
import { withApiObservability } from "../../../../lib/server/observability.ts";

async function notebookDeps() {
  const [teacherNotes, courseNotes, courses] = await Promise.all([
    getTeacherNotesStore(),
    getAnnualCourseNotesStore(),
    getAnnualCourseStore(),
  ]);
  return { teacherNotes, courseNotes, courses };
}

async function handleGet(request: Request) {
  const auth = await requireTeacherSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const notes = await loadTeacherNotebookDocument(auth.session!.teacherId, await notebookDeps());
  return jsonResponse({ ok: true, notes });
}

async function handlePut(request: Request) {
  const auth = await requireTeacherSession(request);
  if ("error" in auth && auth.error) return auth.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, reason: "Corps JSON invalide." }, { status: 400 });
  }

  const candidate =
    body && typeof body === "object" && "notes" in body
      ? (body as { notes: unknown }).notes
      : body;

  if (!isClassNotesPayload(candidate)) {
    return jsonResponse({ ok: false, reason: "Document de notes invalide." }, { status: 400 });
  }

  const notes = await persistTeacherNotebookDocument(
    auth.session!.teacherId,
    normalizeClassNotes(candidate),
    await notebookDeps(),
  );
  return jsonResponse({ ok: true, notes });
}

export const GET = withApiObservability("/api/teacher/notes", handleGet);
export const PUT = withApiObservability("/api/teacher/notes", handlePut);
