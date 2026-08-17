/** Mot de passe de démonstration documenté — ne jamais utiliser en production. */
export const DEMO_TEACHER_PASSWORD = "campus-demo";

export function isDemoTeacherPassword(password: string): boolean {
  return password === DEMO_TEACHER_PASSWORD;
}

export function getAuthSecret(): string {
  const secret = process.env.AUTH_SECRET?.trim();
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET est requis en production.");
  }
  return "dev-only-campus-agenda-secret";
}
