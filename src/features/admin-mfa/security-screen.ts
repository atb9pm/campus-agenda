/** Libellés de l’écran Administration → Sécurité. Importables par l’UI et les tests. */

export const ADMIN_SECURITY_TITLE = "Double authentification";
export const ADMIN_SECURITY_STATE_ENABLED = "Activée";
export const ADMIN_SECURITY_APP_CONFIGURED = "Configurée";

export const ADMIN_SECURITY_RECONFIGURE_TITLE = "Reconfigurer la double authentification";
export const ADMIN_SECURITY_RECONFIGURE_HINT =
  "À utiliser si vous avez encore accès à votre application d’authentification et souhaitez changer de téléphone ou d’application.";
export const ADMIN_SECURITY_RECONFIGURE_BUTTON = "Reconfigurer";

export const ADMIN_SECURITY_LOST_TITLE = "J’ai perdu l’accès à mon téléphone";
export const ADMIN_SECURITY_LOST_HINT =
  "Utilisez votre mot de passe et un code de récupération pour configurer une nouvelle application d’authentification.";
export const ADMIN_SECURITY_LOST_BUTTON = "Utiliser un code de récupération";
export const ADMIN_SECURITY_LOST_WARNING =
  "Cette opération remplacera votre configuration actuelle de double authentification. Après confirmation du nouveau code, vos anciens codes de récupération seront invalidés.";

export const ADMIN_SECURITY_REGEN_TITLE = "Régénérer les codes de récupération";
export const ADMIN_SECURITY_REGEN_HINT = "Crée une nouvelle série de codes. Tous les anciens codes seront invalidés.";
export const ADMIN_SECURITY_REGEN_BUTTON = "Régénérer";
export const ADMIN_SECURITY_REGEN_CONFIRM =
  "Les anciens codes de récupération seront invalidés. Continuer ?";

export const ADMIN_SECURITY_HELP_TITLE = "Plus aucun moyen de récupération ?";
export const ADMIN_SECURITY_HELP_TEXT =
  "Si vous avez perdu votre téléphone et vos codes de récupération, une réinitialisation de la double authentification reste possible depuis l’administration serveur Infomaniak. Cette opération nécessite un accès au serveur et ne désactive jamais définitivement la double authentification.";

export const ADMIN_SECURITY_ACK_CODES = "J’ai enregistré ces codes";
export const ADMIN_SECURITY_BACK = "Retour à la sécurité";
