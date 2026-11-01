/**
 * Textes SMS fixes : aucun paramètre issu de l'événement n'y est inséré.
 * Un téléphone peut afficher le SMS sur l'écran verrouillé.
 */
export const SECURITY_SMS_TEXT_WARNING =
  "Campus Agenda : une activité de sécurité inhabituelle a été détectée. Consultez Administration > Sécurité.";
export const SECURITY_SMS_TEXT_CRITICAL =
  "Campus Agenda : alerte de sécurité critique détectée. Consultez immédiatement Administration > Sécurité.";
export const SECURITY_SMS_TEXT_TEST = "Campus Agenda : test des alertes de sécurité réussi.";

export const SECURITY_SMS_TEXTS = [SECURITY_SMS_TEXT_WARNING, SECURITY_SMS_TEXT_CRITICAL, SECURITY_SMS_TEXT_TEST] as const;

export function securitySmsText(level: "WARNING" | "CRITICAL" | "TEST"): string {
  if (level === "CRITICAL") return SECURITY_SMS_TEXT_CRITICAL;
  if (level === "TEST") return SECURITY_SMS_TEXT_TEST;
  return SECURITY_SMS_TEXT_WARNING;
}
