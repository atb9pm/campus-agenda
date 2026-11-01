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
import { recordRequestSecurityEvent } from "../../../../lib/server/security-events.ts";

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
    await recordRequestSecurityEvent(request, {
      type: "TEACHER_LOGIN_FAILED",
      actorType: "ANONYMOUS",
      httpStatus: 401,
      metadata: { accountKnown: false, reason: "malformed-request" },
      aggregateWindowMinutes: 15,
    });
    return jsonResponse({ ok: false, reason: TEACHER_LOGIN_INVALID_REASON }, { status: 401 });
  }

  const password = String(parsed.value.password ?? "").trim();
  const identifier = String(parsed.value.initials ?? "").trim() || String(parsed.value.teacherId ?? "").trim();

  const accounts = await getTeacherAccountsStore();
  const targetKey = await resolveTeacherAuthRateLimitTarget(identifier, accounts);
  // L'identifiant saisi n'est jamais journalisé : seul un compte existant est référencé.
  const knownTeacherId = (await accounts.findAccount(targetKey))?.id ?? null;
  const targetLimited = await enforceAuthRateLimit(request, "teacher", {
    targetKey,
    layer: "target",
    securityActor: { actorType: "ANONYMOUS", targetTeacherId: knownTeacherId },
  });
  if (targetLimited) return targetLimited;

  const outcome = await accounts.authenticate(identifier, password);
  if (!outcome.ok || !outcome.teacherId) {
    const blockedState = outcome.failure === "archived" || outcome.failure === "disabled" ? outcome.failure : null;
    const failedTeacherId = blockedState ? outcome.failedTeacherId ?? knownTeacherId : knownTeacherId;
    await recordRequestSecurityEvent(request, blockedState
      ? {
        type: "TEACHER_LOGIN_ACCOUNT_BLOCKED",
        actorType: "ANONYMOUS",
        targetType: failedTeacherId ? "TEACHER" : null,
        targetId: failedTeacherId,
        httpStatus: 401,
        metadata: { accountState: blockedState },
        aggregateWindowMinutes: 15,
      }
      : {
        type: "TEACHER_LOGIN_FAILED",
        actorType: "ANONYMOUS",
        targetType: failedTeacherId ? "TEACHER" : null,
        targetId: failedTeacherId,
        httpStatus: 401,
        metadata: { accountKnown: Boolean(failedTeacherId), reason: "invalid-credentials" },
        aggregateWindowMinutes: 15,
      });
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

  await recordRequestSecurityEvent(request, {
    type: "TEACHER_LOGIN_SUCCEEDED",
    actorType: "TEACHER",
    actorId: teacherId,
    httpStatus: 200,
    metadata: { mfaRequired: mfaPending, passwordChangeRequired: Boolean(outcome.mustChangePassword) },
  });

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
