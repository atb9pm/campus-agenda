export type LoginTab = "student" | "teacher";

export const DEFAULT_LOGIN_TAB: LoginTab = "student";

/** Dernier code de classe utilisé sur cet appareil, pour éviter de le retaper. */
export const LAST_STUDENT_CODE_KEY = "campus-last-student-code";

/** Dernières initiales utilisées sur cet appareil. */
export const LAST_TEACHER_INITIALS_KEY = "campus-last-teacher-initials";

export function normalizeStudentCode(raw: string): string {
  return raw.trim().toLowerCase();
}

export function normalizeTeacherInitials(raw: string): string {
  return raw.trim();
}

/**
 * Lien direct par classe : `?classe=ma2` ouvre l'agenda sans rien taper.
 * `class` est accepté pour les liens rédigés en anglais.
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
