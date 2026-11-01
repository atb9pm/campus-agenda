import {
  SECURITY_SMS_COOLDOWN_MINUTES,
  SECURITY_SMS_MAX_PER_DAY,
  SECURITY_SMS_MAX_PER_HOUR,
  SECURITY_SMS_TEST_COOLDOWN_MINUTES,
  SECURITY_SMS_WARNING_ELIGIBLE_TYPES,
  readSecuritySmsActivity,
  securitySmsConfigView,
} from "@campus/features/security-notifications/index.ts";
import { getSecurityNotificationStore } from "@campus/lib/persistence/store-factory.ts";

import { jsonResponse, requireAdminSession } from "../../../../../lib/server/api.ts";
import { withApiObservability } from "../../../../../lib/server/observability.ts";
import { getSecuritySmsRuntime } from "../../../../../lib/server/security-sms.ts";

/** État des alertes SMS : numéro masqué, jamais d'identifiant ni de secret fournisseur. */
async function handleGet(request: Request) {
  const auth = await requireAdminSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const { config } = getSecuritySmsRuntime();
  const activity = await readSecuritySmsActivity(await getSecurityNotificationStore(), new Date());
  return jsonResponse(
    {
      ok: true,
      ...securitySmsConfigView(config),
      policy: {
        criticalAlerts: true,
        warningTypes: SECURITY_SMS_WARNING_ELIGIBLE_TYPES.length,
        cooldownMinutes: SECURITY_SMS_COOLDOWN_MINUTES,
        maxPerHour: SECURITY_SMS_MAX_PER_HOUR,
        maxPerDay: SECURITY_SMS_MAX_PER_DAY,
        testCooldownMinutes: SECURITY_SMS_TEST_COOLDOWN_MINUTES,
      },
      activity,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export const GET = withApiObservability("/api/admin/security/sms", handleGet);
