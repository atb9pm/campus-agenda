import { isClassNotesPayload, normalizeClassNotes } from "@campus/features/class-notebook";
import {
  getTeacherNotesStore,
  jsonResponse,
  requireTeacherSession,
} from "../../../../lib/server/api.ts";
import { withApiObservability } from "../../../../lib/server/observability.ts";

async function handleGet(request: Request) {
  const auth = await requireTeacherSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const notesStore = await getTeacherNotesStore();
  const notes = await notesStore.getNotes(auth.session!.teacherId);
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

  const notesStore = await getTeacherNotesStore();
  const notes = await notesStore.saveNotes(auth.session!.teacherId, normalizeClassNotes(candidate));
  return jsonResponse({ ok: true, notes });
}

export const GET = withApiObservability("/api/teacher/notes", handleGet);
export const PUT = withApiObservability("/api/teacher/notes", handlePut);
