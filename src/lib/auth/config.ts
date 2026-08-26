/** Mot de passe de démonstration documenté — ne jamais utiliser en production. */
export const DEMO_TEACHER_PASSWORD = "campus-demo";

/** Mot de passe d'accueil du site (verrou de la page publique). */
export const SITE_GATE_PASSWORD = "campus-accueil";
export const SITE_GATE_STORAGE_KEY = "campus-site-unlocked";

export function isDemoTeacherPassword(password: string): boolean {
  return password.trim() === DEMO_TEACHER_PASSWORD;
}

export function isSiteGatePassword(password: string): boolean {
  return password.trim() === SITE_GATE_PASSWORD;
}

export function getAuthSecret(): string {
  const secret = process.env.AUTH_SECRET?.trim();
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET est requis en production.");
  }
  return "dev-only-campus-agenda-secret";
}
