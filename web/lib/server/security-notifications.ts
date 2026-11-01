import type { SecurityEvent } from "@campus/features/security-events/index.ts";
import { logOperationalError } from "@campus/lib/observability/index.ts";
import { dispatchSecurityEmail } from "./security-email.ts";
import { securitySmsDeps } from "./security-sms.ts";
import { notifySecurityEvent } from "@campus/features/security-notifications/index.ts";

/**
 * Branché sur `SecurityRecorderDeps.notify` : chaque canal part sans attente.
 * Une panne SMS ou SMTP n'affecte jamais la requête d'origine.
 */
export function notifySecurityEventInBackground(event: SecurityEvent): void {
  void (async () => {
    await notifySecurityEvent(await securitySmsDeps(), event);
  })().catch(() => {
    logOperationalError("security_sms_failed", {
      kind: "ALERT",
      eventType: event.eventType,
      failureCategory: "unexpected",
    });
  });
  void dispatchSecurityEmail(event).catch(() => {
    logOperationalError("security_email_delivery_failed", {
      kind: "ALERT",
      eventType: event.eventType,
      failure: "unexpected",
    });
  });
}
