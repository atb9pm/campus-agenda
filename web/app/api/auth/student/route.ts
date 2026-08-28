import {
  jsonResponse,
  jsonWithSession,
} from "../../../../lib/server/api.ts";
import { getStore } from "../../../../lib/server/api.ts";
import { enforceAuthRateLimit } from "../../../../lib/server/rate-limit.ts";

export async function POST(request: Request) {
  const limited = await enforceAuthRateLimit(request, "student");
  if (limited) return limited;

  const body = await request.json() as { code?: string; remember?: boolean };
  const code = String(body.code ?? "").trim();
  const store = await getStore();
  const access = await store.resolveStudentAccess(code);

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
    {},
    body.remember !== false,
  );
}
