import { isClassNotesPayload, normalizeClassNotes } from "@campus/features/class-notebook";
import {
  loadTeacherNotebookDocument,
  persistTeacherNotebookDocument,
  notebookRevision,
} from "@campus/features/class-notebook/annual-private-notes.ts";
import { NotebookConflictError } from "@campus/lib/persistence/teacher-notes-types.ts";
import {
  getAnnualCourseNotesStore,
  getAnnualCourseStore,
  getSchoolCatalogStore,
  getSchoolYearStore,
} from "@campus/lib/persistence/store-factory.ts";
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

  const url = new URL(request.url);
  const teacherId = auth.session!.teacherId;
  const schoolYearId = url.searchParams.get("schoolYearId")?.trim() || null;
  const adminConsult = url.searchParams.get("consult") === "1";
  const isAdmin = await auth.store!.teacherIsAdmin(teacherId);
  const [deps, catalog, years] = await Promise.all([
    notebookDeps(),
    getSchoolCatalogStore(),
    getSchoolYearStore(),
  ]);
  const notes = await loadTeacherNotebookDocument(teacherId, deps, {
    schoolYearId,
    isAdmin,
    adminConsult,
    catalog,
    years,
  });
  return jsonResponse({ ok: true, notes, revision: notebookRevision(notes) }, { headers: { "Cache-Control": "no-store" } });
}

async function handlePut(request: Request) {
  const auth = await requireTeacherSession(request);
  if ("error" in auth && auth.error) return auth.error;
  if (new URL(request.url).searchParams.get("consult") === "1") {
    return jsonResponse(
      { ok: false, reason: "Consultation administrative en lecture seule." },
      { status: 403 },
    );
  }

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

  const revision = body && typeof body === "object" && "revision" in body ? body.revision : undefined;
  if (revision !== undefined && (typeof revision !== "string" || !/^[a-f0-9]{64}$/.test(revision))) {
    return jsonResponse({ ok: false, reason: "Version des notes invalide." }, { status: 400 });
  }
  try {
    const notes = await persistTeacherNotebookDocument(
      auth.session!.teacherId, normalizeClassNotes(candidate), await notebookDeps(), revision,
    );
    return jsonResponse({ ok: true, notes, revision: notebookRevision(notes) });
  } catch (error) {
    if (!(error instanceof NotebookConflictError)) throw error;
    return jsonResponse({ ok: false, code: "NOTES_CONFLICT", reason: error.message }, { status: 409 });
  }
}

export const GET = withApiObservability("/api/teacher/notes", handleGet);
export const PUT = withApiObservability("/api/teacher/notes", handlePut);
