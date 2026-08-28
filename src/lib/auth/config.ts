export { DEMO_TEACHER_PASSWORD, isDemoTeacherPassword } from "./password.ts";

export function getAuthSecret(): string {
  const secret = process.env.AUTH_SECRET?.trim();
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET est requis en production.");
  }
  return "dev-only-campus-agenda-secret";
}
