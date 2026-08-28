import type { TeacherAccountRecord } from "./types.ts";

/** Initiales de la grille horaire : lettres uniquement, casse d'origine conservée. */
export function normalizeInitials(value: string): string {
  return value
    .normalize("NFC")
    .replace(/[^\p{L}]/gu, "")
    .slice(0, 8);
}

export function initialsKey(value: string): string {
  return normalizeInitials(value).toLowerCase();
}

export function sameInitials(left: string, right: string): boolean {
  return initialsKey(left) === initialsKey(right);
}

export function normalizeDisplayName(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 120);
}

/** Identifiant stable dérivé des initiales, suffixé si déjà pris. */
export function buildTeacherId(initials: string, taken: Iterable<string>): string {
  const base = `teacher-${initialsKey(initials) || "compte"}`;
  const used = new Set(taken);
  if (!used.has(base)) return base;
  let index = 2;
  while (used.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

export type AccountInputCheck = { ok: true } | { ok: false; reason: string };

export function checkAccountInput(displayName: string, initials: string): AccountInputCheck {
  if (normalizeDisplayName(displayName).length < 2) {
    return { ok: false, reason: "Le nom affiché est requis." };
  }
  if (normalizeInitials(initials).length < 2) {
    return { ok: false, reason: "Les initiales doivent contenir au moins deux lettres." };
  }
  return { ok: true };
}

export function sortAccounts(accounts: TeacherAccountRecord[]): TeacherAccountRecord[] {
  return [...accounts].sort((left, right) => {
    if (left.isActive !== right.isActive) return left.isActive ? -1 : 1;
    return left.displayName.localeCompare(right.displayName, "fr");
  });
}

/**
 * Garde-fou anti-verrouillage : il doit toujours rester un administrateur actif
 * capable de se connecter.
 */
export function wouldRemoveLastAdmin(
  accounts: TeacherAccountRecord[],
  targetId: string,
  patch: { isAdmin?: boolean; isActive?: boolean },
): boolean {
  const stillAdmin = (account: TeacherAccountRecord) => {
    if (account.id !== targetId) return account.isAdmin && account.isActive;
    const isAdmin = patch.isAdmin ?? account.isAdmin;
    const isActive = patch.isActive ?? account.isActive;
    return isAdmin && isActive;
  };
  return !accounts.some(stillAdmin);
}
