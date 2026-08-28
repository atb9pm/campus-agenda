/** Politique de mot de passe partagée entre le serveur et les formulaires. */

/** Mot de passe de démonstration documenté — jamais accepté en production. */
export const DEMO_TEACHER_PASSWORD = "campus-demo";

/** Longueur minimale d'un mot de passe choisi par un enseignant. */
export const MIN_PASSWORD_LENGTH = 10;

export function isDemoTeacherPassword(password: string): boolean {
  return password.trim() === DEMO_TEACHER_PASSWORD;
}

export type PasswordCheck = { ok: true } | { ok: false; reason: string };

/** Règles minimales : longueur, variété, et refus explicite du mot de passe démo. */
export function checkPasswordStrength(password: string): PasswordCheck {
  const candidate = password.trim();
  if (candidate.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, reason: `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.` };
  }
  if (isDemoTeacherPassword(candidate)) {
    return { ok: false, reason: "Le mot de passe de démonstration est interdit." };
  }
  if (!/[A-Za-zÀ-ÿ]/.test(candidate) || !/[0-9]/.test(candidate)) {
    return { ok: false, reason: "Le mot de passe doit mêler au moins une lettre et un chiffre." };
  }
  return { ok: true };
}
