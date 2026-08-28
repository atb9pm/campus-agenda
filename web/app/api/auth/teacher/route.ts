import { getTeacherById } from "@campus/features/classes/queries.ts";
import { DEMO_CATALOG } from "@campus/features/classes/demo-data.ts";
import {
  jsonResponse,
  jsonWithSession,
} from "../../../../lib/server/api.ts";
import { getStore } from "../../../../lib/server/api.ts";
import { enforceAuthRateLimit } from "../../../../lib/server/rate-limit.ts";

export async function POST(request: Request) {
  const limited = await enforceAuthRateLimit(request, "teacher");
  if (limited) return limited;

  const body = await request.json() as {
    teacherId?: string;
    initials?: string;
    password?: string;
    remember?: boolean;
  };
  const password = String(body.password ?? "").trim();
  const store = await getStore();

  // Connexion par initiales (ChF) ; l'identifiant interne reste accepté pour les appels existants.
  const initials = String(body.initials ?? "").trim();
  const teacherId = initials
    ? (await store.findTeacherIdByInitials(initials)) ?? ""
    : String(body.teacherId ?? "").trim();

  if (!teacherId || !(await store.verifyTeacherCredentials(teacherId, password))) {
    return jsonResponse({ ok: false, reason: "Initiales ou mot de passe incorrect." }, { status: 401 });
  }

  const teacher = getTeacherById(DEMO_CATALOG, teacherId);
  if (!teacher) {
    return jsonResponse({ ok: false, reason: "Enseignant introuvable." }, { status: 404 });
  }

  const isAdmin = await store.teacherIsAdmin(teacherId);

  return jsonWithSession(
    { kind: "teacher", teacherId, issuedAt: Date.now() },
    {
      ok: true,
      session: {
        kind: "teacher",
        teacherId,
        displayName: teacher.displayName,
        initials: teacher.initials,
        isAdmin,
      },
    },
    {},
    Boolean(body.remember),
  );
}
