import { sendSecuritySmsTest, type SecuritySmsOutcome } from "@campus/features/security-notifications/index.ts";
import { checkInMemoryRateLimit, isAuthRateLimitBypassAllowed } from "@campus/lib/security/rate-limit.ts";

import { jsonResponse, requireAdminSession } from "../../../../../../lib/server/api.ts";
import { withApiObservability } from "../../../../../../lib/server/observability.ts";
import { recordRequestSecurityEvent } from "../../../../../../lib/server/security-events.ts";
import { getSecuritySmsRuntime, securitySmsDeps } from "../../../../../../lib/server/security-sms.ts";

/** Garde mémoire en plus du cooldown persistant de 10 minutes : quelques clics par minute au plus. */
const TEST_REQUESTS_PER_MINUTE = 3;

const RESPONSES: Record<SecuritySmsOutcome["outcome"], { status: number; reason: string }> = {
  sent: { status: 200, reason: "SMS de test envoyé." },
  "suppressed-cooldown": { status: 429, reason: "Un SMS de test a déjà été demandé il y a moins de 10 minutes." },
  "suppressed-quota": { status: 429, reason: "Limite d’envoi de SMS atteinte. Réessayez plus tard." },
  failed: { status: 502, reason: "L’envoi du SMS de test a échoué. Vérifiez la configuration du fournisseur." },
  disabled: { status: 409, reason: "Les alertes SMS ne sont pas configurées." },
  "not-eligible": { status: 409, reason: "Les alertes SMS ne sont pas configurées." },
};

async function handlePost(request: Request) {
  const auth = await requireAdminSession(request);
  if ("error" in auth && auth.error) return auth.error;

  let confirmed = false;
  try {
    confirmed = ((await request.json()) as { confirm?: unknown })?.confirm === true;
  } catch {
    confirmed = false;
  }
  if (!confirmed) return jsonResponse({ ok: false, reason: "Confirmation requise." }, { status: 400 });

  if (getSecuritySmsRuntime().config.status !== "enabled") {
    return jsonResponse({ ok: false, outcome: "disabled", reason: RESPONSES.disabled.reason }, { status: 409 });
  }
  if (
    !isAuthRateLimitBypassAllowed()
    && !checkInMemoryRateLimit(`security-sms-test:${auth.session!.teacherId}`, TEST_REQUESTS_PER_MINUTE)
  ) {
    return jsonResponse(
      { ok: false, outcome: "suppressed-cooldown", reason: "Trop de demandes. Réessayez dans une minute." },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  const result = await sendSecuritySmsTest(await securitySmsDeps());
  const outcome = result.outcome === "not-eligible" ? "disabled" : result.outcome;
  await recordRequestSecurityEvent(request, {
    type: "SECURITY_SMS_TEST_REQUESTED",
    actorType: "TEACHER",
    actorId: auth.session!.teacherId,
    httpStatus: RESPONSES[outcome].status,
    metadata: { outcome },
  });
  const response = RESPONSES[outcome];
  return jsonResponse(
    { ok: outcome === "sent", outcome, reason: response.reason },
    { status: response.status, headers: { "Cache-Control": "no-store" } },
  );
}

export const POST = withApiObservability("/api/admin/security/sms/test", handlePost);
