import { getTeacherById } from "@campus/features/classes/queries.ts";
import { DEMO_CATALOG } from "@campus/features/classes/demo-data.ts";
import {
  getTeacherAccountsStore,
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

  // Connexion par initiales (ChF) ; l'identifiant interne reste accepté pour les appels existants.
  const identifier = String(body.initials ?? "").trim() || String(body.teacherId ?? "").trim();
  const accounts = await getTeacherAccountsStore();
  const outcome = await accounts.authenticate(identifier, password);
  if (!outcome.ok || !outcome.teacherId) {
    return jsonResponse(
      { ok: false, reason: outcome.reason ?? "Initiales ou mot de passe incorrect." },
      { status: 401 },
    );
  }

  const teacherId = outcome.teacherId;
  const account = await accounts.findAccount(teacherId);
  const fallback = getTeacherById(DEMO_CATALOG, teacherId);
  const displayName = account?.displayName ?? fallback?.displayName;
  const initials = account?.initials ?? fallback?.initials;
  if (!displayName || !initials) {
    return jsonResponse({ ok: false, reason: "Enseignant introuvable." }, { status: 404 });
  }

  const store = await getStore();
  const isAdmin = await store.teacherIsAdmin(teacherId);

  return jsonWithSession(
    { kind: "teacher", teacherId, issuedAt: Date.now() },
    {
      ok: true,
      session: {
        kind: "teacher",
        teacherId,
        displayName,
        initials,
        isAdmin,
        mustChangePassword: Boolean(outcome.mustChangePassword),
      },
    },
    {},
    Boolean(body.remember),
  );
}
