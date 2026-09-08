export type LoginTab = "student" | "teacher";

export const DEFAULT_LOGIN_TAB: LoginTab = "student";

/** Dernières initiales utilisées sur cet appareil. */
export const LAST_TEACHER_INITIALS_KEY = "campus-last-teacher-initials";

export function normalizeStudentCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

export function normalizeTeacherInitials(raw: string): string {
  return raw.trim();
}

/**
 * `?classe=` n'est plus un secret d'authentification.
 * Conservé uniquement comme préfixe public éventuel ; il ne suffit jamais à ouvrir l'agenda.
 */
export function readClassCodeFromQuery(search: string): string | null {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const raw = params.get("classe") ?? params.get("class");
  if (!raw) return null;
  const code = normalizeStudentCode(raw);
  return code || null;
}

export function readStoredValue(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStoredValue(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Stockage indisponible (navigation privée) : sans conséquence.
  }
}

export {
  UNKNOWN_TEACHER_INITIALS,
  authenticatedTeacherFromSession,
  initialsFromDisplayName,
  profileDiscInitials,
  type AuthenticatedTeacherIdentity,
} from "./teacher-identity.ts";
