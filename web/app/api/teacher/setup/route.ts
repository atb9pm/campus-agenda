import { isTeacherSetupPayload, normalizeTeacherSetup } from "@campus/features/teacher-setup";
import {
  getTeacherSetupsStore,
  jsonResponse,
  requireTeacherSession,
} from "../../../../lib/server/api.ts";
import { withApiObservability } from "../../../../lib/server/observability.ts";

async function handleGet(request: Request) {
  const auth = await requireTeacherSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const setups = await getTeacherSetupsStore();
  const setup = await setups.getSetup(auth.session!.teacherId);
  return jsonResponse({ ok: true, setup });
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
    body && typeof body === "object" && "setup" in body
      ? (body as { setup: unknown }).setup
      : body;

  if (!isTeacherSetupPayload(candidate)) {
    return jsonResponse({ ok: false, reason: "Configuration enseignant invalide." }, { status: 400 });
  }

  const setups = await getTeacherSetupsStore();
  const setup = await setups.saveSetup(auth.session!.teacherId, normalizeTeacherSetup(candidate));
  return jsonResponse({ ok: true, setup });
}

export const GET = withApiObservability("/api/teacher/setup", handleGet);
export const PUT = withApiObservability("/api/teacher/setup", handlePut);
