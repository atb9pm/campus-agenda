/**
 * Textes de la section « Alertes SMS ».
 * Règle : ne jamais promettre que toutes les attaques seront signalées.
 */
export const SECURITY_SMS_TITLE = "Alertes SMS";
export const SECURITY_SMS_DESCRIPTION =
  "Recevez une notification lorsqu’une activité de sécurité importante est détectée.";
export const SECURITY_SMS_STATE_ACTIVE_LABEL = "Actives";
export const SECURITY_SMS_STATE_INACTIVE_LABEL = "Non configurées";
export const SECURITY_SMS_STATE_MISCONFIGURED_LABEL = "Configuration incomplète";
export const SECURITY_SMS_STATE_ENVIRONMENT_LABEL = "Désactivées (hors production)";
export const SECURITY_SMS_STATE_ACTIVE = "Les alertes SMS critiques sont activées.";
export const SECURITY_SMS_STATE_INACTIVE = "Les alertes SMS ne sont pas configurées.";
export const SECURITY_SMS_STATE_MISCONFIGURED =
  "La configuration serveur des alertes SMS est incomplète : aucun SMS n’est envoyé.";
export const SECURITY_SMS_STATE_ENVIRONMENT =
  "Les alertes SMS sont désactivées dans cet environnement : elles ne fonctionnent qu’en production.";
export const SECURITY_SMS_PRIVACY = "Les SMS ne contiennent aucune donnée pédagogique ni information sensible.";
export const SECURITY_SMS_SCOPE =
  "Campus Agenda peut envoyer une alerte lorsqu’un événement de sécurité significatif est détecté. Les alertes améliorent la rapidité de réaction mais ne garantissent pas la détection de toutes les attaques ou fuites de données.";
export const SECURITY_SMS_SERVER_CONFIG =
  "Le numéro de destination est une configuration du serveur : il ne se modifie pas depuis cet écran.";
export const SECURITY_SMS_NO_RECENT_ALERT = "Aucune alerte SMS envoyée récemment.";
export const SECURITY_SMS_TEST_BUTTON = "Envoyer un SMS de test";
export const SECURITY_SMS_TEST_CONFIRM_TITLE = "Envoyer un SMS de test ?";
export const SECURITY_SMS_TEST_CONFIRM_BODY =
  "Un SMS de test sera envoyé au numéro configuré. Il compte dans la limite d’envoi et un seul test est possible toutes les 10 minutes.";

export const SECURITY_SMS_SETUP_TITLE = "Comment activer les alertes SMS";
export const SECURITY_SMS_SETUP_INTRO =
  "L’activation se fait sur le serveur, pas depuis cet écran : le numéro et les identifiants du fournisseur ne sont jamais enregistrés dans Campus Agenda ni dans GitHub.";
export const SECURITY_SMS_SETUP_STEPS = [
  "Créer un compte Twilio et relever l’Account SID, l’Auth Token et un expéditeur (numéro Twilio ou nom court, par exemple CampusAg).",
  "Dans le Manager Infomaniak, ajouter les variables ci-dessous au début de la commande de lancement du site Node.js, avant npm run start:infomaniak.",
  "Enregistrer puis cliquer sur « Redémarrer ». En revenant ici, l’état doit indiquer « Actives ».",
  "Cliquer sur « Envoyer un SMS de test » pour vérifier la réception.",
] as const;
/** Noms et exemples factices : aucune vraie valeur. */
export const SECURITY_SMS_SETUP_VARIABLES = [
  { name: "CAMPUS_SECURITY_SMS_ENABLED", example: "true" },
  { name: "CAMPUS_SECURITY_SMS_TO", example: "+41… (votre numéro, format international)" },
  { name: "CAMPUS_SMS_PROVIDER", example: "twilio" },
  { name: "CAMPUS_SMS_TWILIO_ACCOUNT_SID", example: "AC… (Twilio)" },
  { name: "CAMPUS_SMS_TWILIO_AUTH_TOKEN", example: "… (Twilio, secret)" },
  { name: "CAMPUS_SMS_TWILIO_FROM", example: "CampusAg ou numéro Twilio" },
] as const;
export const SECURITY_SMS_SETUP_ENVIRONMENT_NOTE =
  "Cet environnement n’est pas la production : les SMS y restent désactivés même si les variables sont présentes.";

/** Formulations interdites : l'écran ne garantit jamais une détection exhaustive. */
export const SECURITY_SMS_FORBIDDEN_CLAIMS = [
  /toutes les attaques vous seront signalées/i,
  /aucune attaque ne passera/i,
  /détecte toutes les attaques/i,
] as const;
