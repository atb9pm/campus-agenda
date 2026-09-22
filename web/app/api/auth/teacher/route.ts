import { authRateLimitTargetFromTeacherIdentifier } from "@campus/lib/security/rate-limit.ts";
import {
  getTeacherAccountsStore,
  jsonResponse,
  jsonWithSession,
} from "../../../../lib/server/api.ts";
import { getStore } from "../../../../lib/server/api.ts";
import { buildTeacherClientSession } from "../../../../lib/server/teacher-session.ts";
import { enforceAuthRateLimit } from "../../../../lib/server/rate-limit.ts";

export async function POST(request: Request) {
  let body: {
    teacherId?: string;
    initials?: string;
    password?: string;
    remember?: boolean;
  };
  try {
    body = await request.json() as typeof body;
  } catch {
    const limited = await enforceAuthRateLimit(request, "teacher", "empty");
    if (limited) return limited;
    return jsonResponse({ ok: false, reason: "Initiales ou mot de passe incorrect." }, { status: 401 });
  }

  const password = String(body.password ?? "").trim();

  // Connexion par initiales (ChF) ; l'identifiant interne reste accepté pour les appels existants.
  const identifier = String(body.initials ?? "").trim() || String(body.teacherId ?? "").trim();
  const limited = await enforceAuthRateLimit(
    request,
    "teacher",
    authRateLimitTargetFromTeacherIdentifier(identifier),
  );
  if (limited) return limited;

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
