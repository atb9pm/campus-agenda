import {
  deleteStructuredControl,
  structuredControlContentFromBody,
  updateStructuredControlContent,
} from "@campus/features/course-publications/index.ts";
import {
  getStructuredPublishDeps,
  jsonResponse,
  reconcileRuntimeStructuredClassrooms,
  requireTeacherSession,
} from "../../../../../lib/server/api.ts";
import { withApiObservability } from "../../../../../lib/server/observability.ts";

async function parseAgendaItemId(context?: { params: Promise<{ agendaItemId: string }> }) {
  const { agendaItemId: rawId } = await (context?.params ?? Promise.resolve({ agendaItemId: "" }));
  const agendaItemId = Number(rawId);
  if (!Number.isInteger(agendaItemId) || agendaItemId <= 0) {
    return { ok: false as const, response: jsonResponse({ ok: false, reason: "Identifiant de contrôle invalide." }, { status: 400 }) };
  }
  return { ok: true as const, agendaItemId };
}

async function handlePatch(request: Request, context?: { params: Promise<{ agendaItemId: string }> }) {
  const auth = await requireTeacherSession(request);
  if ("error" in auth && auth.error) return auth.error;

  await reconcileRuntimeStructuredClassrooms();

  const parsedId = await parseAgendaItemId(context);
  if (!parsedId.ok) return parsedId.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, reason: "Données de modification invalides." }, { status: 400 });
  }

  const parsed = structuredControlContentFromBody(body);
  if (!parsed.ok) {
    return jsonResponse({ ok: false, reason: parsed.reason }, { status: 400 });
  }

  const result = await updateStructuredControlContent(await getStructuredPublishDeps(), {
    teacherId: auth.session!.teacherId,
    agendaItemId: parsedId.agendaItemId,
    title: parsed.title,
    detail: parsed.detail,
  });

  if (!result.ok) {
    return jsonResponse({ ok: false, reason: result.reason }, { status: result.status });
  }

  return jsonResponse({ ok: true, item: result.item });
}

async function handleDelete(request: Request, context?: { params: Promise<{ agendaItemId: string }> }) {
  const auth = await requireTeacherSession(request);
  if ("error" in auth && auth.error) return auth.error;

  await reconcileRuntimeStructuredClassrooms();

  const parsedId = await parseAgendaItemId(context);
  if (!parsedId.ok) return parsedId.response;

  const result = await deleteStructuredControl(await getStructuredPublishDeps(), {
    teacherId: auth.session!.teacherId,
    agendaItemId: parsedId.agendaItemId,
  });

  if (!result.ok) {
    return jsonResponse({ ok: false, reason: result.reason }, { status: result.status });
  }

  return jsonResponse({ ok: true, item: result.item });
}

export const PATCH = withApiObservability("/api/teacher/controls/[agendaItemId]", handlePatch);
export const DELETE = withApiObservability("/api/teacher/controls/[agendaItemId]", handleDelete);
