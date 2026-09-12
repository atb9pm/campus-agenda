import {
  getTeacherAccountsStore,
  jsonResponse,
  jsonWithSession,
} from "../../../../lib/server/api.ts";
import { getStore } from "../../../../lib/server/api.ts";
import { buildTeacherClientSession } from "../../../../lib/server/teacher-session.ts";
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
  const store = await getStore();
  const isAdmin = await store.teacherIsAdmin(teacherId);
  const mfaPending = isAdmin;
  const session = { kind: "teacher" as const, teacherId, issuedAt: Date.now(), ...(mfaPending ? { mfaPending: true } : {}) };
  const client = await buildTeacherClientSession(teacherId, session);

  return jsonWithSession(
    session,
    {
      ok: true,
      session: client,
    },
    {},
    Boolean(body.remember),
  );
}
