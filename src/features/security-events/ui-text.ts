/**
 * Textes de l'écran « Activité de sécurité ».
 * Règle : ne jamais affirmer l'absence de fuite ou de vol de données.
 */
export const SECURITY_ACTIVITY_TITLE = "Activité de sécurité";
export const SECURITY_ACTIVITY_SUBTITLE = "Surveillance des connexions, accès refusés et opérations sensibles.";
export const SECURITY_ACTIVITY_SUMMARY_TITLE = "Sécurité – dernières 24 heures";
export const SECURITY_ACTIVITY_STATUS_NORMAL = "Aucune activité suspecte détectée sur les dernières 24 heures.";
export const SECURITY_ACTIVITY_STATUS_WARNING_DETAIL =
  "Une activité inhabituelle a été détectée. Consultez les événements ci-dessous.";
export const SECURITY_ACTIVITY_STATUS_CRITICAL = "Une activité inhabituelle importante a été détectée.";
export const SECURITY_ACTIVITY_DISCLAIMER =
  "Ce journal facilite la détection et l’analyse des incidents. Il ne constitue pas à lui seul une preuve absolue de l’absence de fuite de données.";
export const SECURITY_ACTIVITY_EVENTS_TITLE = "Derniers événements";
export const SECURITY_ACTIVITY_EMPTY_PERIOD = "Aucun événement enregistré sur la période sélectionnée.";
export const SECURITY_PROTECTION_TAB = "Protection";

export function securityReviewCountText(count: number): string {
  return count <= 1
    ? `${count} événement nécessite une vérification.`
    : `${count} événements nécessitent une vérification.`;
}

export const SECURITY_SUMMARY_CARD_LABELS = {
  loginSucceeded: "Connexions réussies",
  loginFailed: "Connexions échouées",
  blocked: "Blocages automatiques",
  denied: "Accès refusés",
  sensitive: "Opérations sensibles",
  alerts: "Alertes détectées",
} as const;

export const SECURITY_SEVERITY_LABELS = {
  INFO: "Information",
  WARNING: "À surveiller",
  CRITICAL: "Critique",
} as const;

export const SECURITY_PERIOD_LABELS = {
  "24h": "24 h",
  "7d": "7 jours",
  "30d": "30 jours",
} as const;

/** Formulations interdites : l'interface ne certifie jamais l'absence d'incident. */
export const SECURITY_FORBIDDEN_CLAIMS = [
  /aucune fuite/i,
  /pas de fuite/i,
  /aucune donnée n.a été volée/i,
  /garanti[rte]/i,
] as const;
