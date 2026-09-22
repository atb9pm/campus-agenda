import { resolveTeacherAuthRateLimitTarget } from "@campus/lib/security/rate-limit.ts";
import {
  getTeacherAccountsStore,
  jsonResponse,
  jsonWithSession,
} from "../../../../lib/server/api.ts";
import { getStore } from "../../../../lib/server/api.ts";
import { buildTeacherClientSession } from "../../../../lib/server/teacher-session.ts";
import { enforceAuthRateLimit } from "../../../../lib/server/rate-limit.ts";
import { readBoundedJson } from "../../../../lib/server/read-bounded-json.ts";

const TEACHER_LOGIN_INVALID_REASON = "Initiales ou mot de passe incorrect.";

export async function POST(request: Request) {
  const ipLimited = await enforceAuthRateLimit(request, "teacher", { layer: "ip" });
  if (ipLimited) return ipLimited;

  const parsed = await readBoundedJson<{
    teacherId?: string;
    initials?: string;
    password?: string;
    remember?: boolean;
  }>(request);
  if (!parsed.ok) {
    if (parsed.reason === "too-large") {
      return jsonResponse({ ok: false, reason: "Requête trop volumineuse." }, { status: 413 });
    }
    const targetLimited = await enforceAuthRateLimit(request, "teacher", { targetKey: "empty", layer: "target" });
    if (targetLimited) return targetLimited;
    return jsonResponse({ ok: false, reason: TEACHER_LOGIN_INVALID_REASON }, { status: 401 });
  }

  const password = String(parsed.value.password ?? "").trim();
  const identifier = String(parsed.value.initials ?? "").trim() || String(parsed.value.teacherId ?? "").trim();

  const accounts = await getTeacherAccountsStore();
  const targetKey = await resolveTeacherAuthRateLimitTarget(identifier, accounts);
  const targetLimited = await enforceAuthRateLimit(request, "teacher", { targetKey, layer: "target" });
  if (targetLimited) return targetLimited;

  const outcome = await accounts.authenticate(identifier, password);
  if (!outcome.ok || !outcome.teacherId) {
    return jsonResponse(
      { ok: false, reason: outcome.reason ?? TEACHER_LOGIN_INVALID_REASON },
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
    Boolean(parsed.value.remember),
  );
}
