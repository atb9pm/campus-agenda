import {
  jsonResponse,
  jsonWithSession,
} from "../../../../lib/server/api.ts";
import { getStore } from "../../../../lib/server/api.ts";

export async function POST(request: Request) {
  const body = await request.json() as { code?: string };
  const code = String(body.code ?? "").trim();
  const store = getStore();
  const access = store.resolveStudentAccess(code);

  if (!access) {
    return jsonResponse({ ok: false, reason: "Code d'accès invalide." }, { status: 401 });
  }

  return jsonWithSession(
    {
      kind: "student",
      accessId: access.id,
      classroomId: access.classroomId,
      label: access.label,
      issuedAt: Date.now(),
    },
    {
      ok: true,
      session: {
        kind: "student",
        label: access.label,
        classroomId: access.classroomId,
      },
    },
  );
}
