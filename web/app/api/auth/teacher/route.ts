import { getTeacherById } from "@campus/features/classes/queries.ts";
import { DEMO_CATALOG } from "@campus/features/classes/demo-data.ts";
import {
  jsonResponse,
  jsonWithSession,
} from "../../../../lib/server/api.ts";
import { getStore } from "../../../../lib/server/api.ts";

export async function POST(request: Request) {
  const body = await request.json() as { teacherId?: string; password?: string };
  const teacherId = String(body.teacherId ?? "").trim();
  const password = String(body.password ?? "");

  const store = getStore();
  if (!store.verifyTeacherCredentials(teacherId, password)) {
    return jsonResponse({ ok: false, reason: "Identifiants de démonstration invalides." }, { status: 401 });
  }

  const teacher = getTeacherById(DEMO_CATALOG, teacherId);
  if (!teacher) {
    return jsonResponse({ ok: false, reason: "Enseignant introuvable." }, { status: 404 });
  }

  return jsonWithSession(
    { kind: "teacher", teacherId, issuedAt: Date.now() },
    {
      ok: true,
      session: { kind: "teacher", teacherId, displayName: teacher.displayName, initials: teacher.initials },
    },
  );
}
