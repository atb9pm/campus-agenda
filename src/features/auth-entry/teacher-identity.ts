export interface AuthenticatedTeacherIdentity {
  teacherId: string;
  displayName: string;
  initials: string;
}

export const UNKNOWN_TEACHER_INITIALS = "?";

/**
 * Fallback visuel uniquement si la session n’a pas d’initiales.
 * Ne jamais substituer une constante d’un autre enseignant (`FC`, `ChF`, …).
 */
export function initialsFromDisplayName(displayName: string): string {
  const parts = displayName
    .trim()
    .split(/\s+/)
    .map((part) => part.replace(/[^\p{L}]/gu, ""))
    .filter(Boolean);
  if (parts.length === 0) return UNKNOWN_TEACHER_INITIALS;
  if (parts.length === 1) {
    const word = parts[0]!;
    return (word.slice(0, Math.min(2, word.length)) || UNKNOWN_TEACHER_INITIALS).toUpperCase();
  }
  const first = parts[0]!.slice(0, 1);
  const last = parts[parts.length - 1]!.slice(0, 1);
  return `${first}${last}`.toUpperCase();
}

export function authenticatedTeacherFromSession(session: {
  teacherId: string;
  displayName: string;
  initials: string;
}): AuthenticatedTeacherIdentity {
  const stored = session.initials.trim();
  return {
    teacherId: session.teacherId,
    displayName: session.displayName,
    initials: stored || initialsFromDisplayName(session.displayName),
  };
}

/** Libellé du rond de profil : initiales de la session, jamais le catalogue démo. */
export function profileDiscInitials(teacher: AuthenticatedTeacherIdentity | null | undefined): string {
  if (!teacher) return UNKNOWN_TEACHER_INITIALS;
  const stored = teacher.initials.trim();
  if (stored) return stored;
  return initialsFromDisplayName(teacher.displayName);
}
