/**
 * État UI après enrôlement MFA : les codes de récupération sont affichés
 * une seule fois, alors que la session admin est déjà validée côté serveur.
 *
 * Le bouton « J’ai enregistré ces codes » doit vider ces codes du state
 * avant d’entrer dans l’application. Sinon l’écran MFA reste affiché
 * (condition `mfaSetupRequired || recoveryCodes`).
 */

export interface MfaEnrollmentScreenState {
  mfaSetupRequired?: boolean;
  recoveryCodes: string[] | null;
}

export function shouldShowMfaEnrollmentScreen(state: MfaEnrollmentScreenState): boolean {
  return Boolean(state.mfaSetupRequired || state.recoveryCodes?.length);
}

export interface AcknowledgedMfaRecovery {
  recoveryCodes: null;
  qrDataUrl: null;
  manualKey: null;
  mfaPending: false;
  mfaSetupRequired: false;
  mfaChallengeRequired: false;
}

/** Après accusé de lecture : plus aucun code en mémoire, plus d’écran MFA. */
export function acknowledgeMfaRecoveryCodes(): AcknowledgedMfaRecovery {
  return {
    recoveryCodes: null,
    qrDataUrl: null,
    manualKey: null,
    mfaPending: false,
    mfaSetupRequired: false,
    mfaChallengeRequired: false,
  };
}
