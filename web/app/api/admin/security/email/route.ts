import {
  SECURITY_CRITICAL_EMAIL_COOLDOWN_MINUTES,
  SECURITY_EMAIL_TEST_COOLDOWN_MINUTES,
  SECURITY_WARNING_EMAIL_COOLDOWN_MINUTES,
  readSecurityEmailActivity,
  securityEmailConfigView,
} from "@campus/features/security-notifications/index.ts";
import { getSecurityNotificationStore } from "@campus/lib/persistence/store-factory.ts";

import { jsonResponse, requireAdminSession } from "../../../../../lib/server/api.ts";
import { withApiObservability } from "../../../../../lib/server/observability.ts";
import { getSecurityEmailRuntime } from "../../../../../lib/server/security-email.ts";

/** État des alertes e-mail : destinataire masqué, jamais de mot de passe SMTP. */
async function handleGet(request: Request) {
  const auth = await requireAdminSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const { config } = getSecurityEmailRuntime();
  const activity = await readSecurityEmailActivity(await getSecurityNotificationStore(), new Date());
  return jsonResponse(
    {
      ok: true,
      ...securityEmailConfigView(config),
      policy: {
        warning: true,
        critical: true,
        warningCooldownMinutes: SECURITY_WARNING_EMAIL_COOLDOWN_MINUTES,
        criticalCooldownMinutes: SECURITY_CRITICAL_EMAIL_COOLDOWN_MINUTES,
        testCooldownMinutes: SECURITY_EMAIL_TEST_COOLDOWN_MINUTES,
      },
      activity,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export const GET = withApiObservability("/api/admin/security/email", handleGet);
