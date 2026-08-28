import { initialsKey } from "../../features/teacher-accounts/rules.ts";
import type { TeacherAccountRecord } from "../../features/teacher-accounts/types.ts";
import { demoPasswordAllowed, generateTemporaryPassword } from "../auth/password.ts";
import type { TeacherAccountStore } from "./teacher-account-types.ts";

export type BootstrapOutcome =
  | { action: "none" }
  | { action: "env-password"; teacherId: string; initials: string }
  | { action: "generated"; teacherId: string; initials: string; temporaryPassword: string }
  | { action: "no-admin" };

const DEFAULT_ADMIN_INITIALS = "ChF";

function pickAdmin(accounts: TeacherAccountRecord[], initials: string): TeacherAccountRecord | undefined {
  const key = initialsKey(initials);
  return (
    accounts.find((account) => initialsKey(account.initials) === key) ??
    accounts.find((account) => account.isAdmin && account.isActive) ??
    accounts.find((account) => account.isAdmin)
  );
}

/**
 * Garantit qu'un administrateur peut se connecter sans le mot de passe de
 * démonstration :
 *
 * 1. `CAMPUS_ADMIN_PASSWORD` (avec `CAMPUS_ADMIN_INITIALS`, `ChF` par défaut) est
 *    appliqué au compte visé tant qu'il n'a pas encore de mot de passe personnel ;
 * 2. sinon, en production, un mot de passe provisoire est tiré au hasard et
 *    inscrit dans les journaux du serveur — l'administrateur le change à sa
 *    première connexion.
 *
 * Un mot de passe déjà choisi par un enseignant n'est jamais écrasé.
 */
export async function ensureTeacherAccountBootstrap(
  store: TeacherAccountStore,
): Promise<BootstrapOutcome> {
  const accounts = await store.listAccounts();
  if (accounts.length === 0) return { action: "no-admin" };

  const wantedInitials = process.env.CAMPUS_ADMIN_INITIALS?.trim() || DEFAULT_ADMIN_INITIALS;
  const envPassword = process.env.CAMPUS_ADMIN_PASSWORD?.trim();
  const target = pickAdmin(accounts, wantedInitials);
  if (!target) return { action: "no-admin" };

  if (envPassword && !target.hasPassword) {
    await store.setPassword(target.id, envPassword, true);
    return { action: "env-password", teacherId: target.id, initials: target.initials };
  }

  const anyAdminCanLogIn = accounts.some((account) => account.isAdmin && account.isActive && account.hasPassword);
  if (anyAdminCanLogIn || demoPasswordAllowed()) return { action: "none" };

  const temporaryPassword = generateTemporaryPassword();
  await store.setPassword(target.id, temporaryPassword, true);
  return { action: "generated", teacherId: target.id, initials: target.initials, temporaryPassword };
}

export function describeBootstrapOutcome(outcome: BootstrapOutcome): string | null {
  if (outcome.action === "env-password") {
    return `[campus-agenda] Mot de passe administrateur appliqué depuis CAMPUS_ADMIN_PASSWORD pour ${outcome.initials}. À changer à la première connexion.`;
  }
  if (outcome.action === "generated") {
    return [
      "",
      "==================== CAMPUS AGENDA — ACCÈS ADMINISTRATEUR ====================",
      `  Initiales        : ${outcome.initials}`,
      `  Mot de passe     : ${outcome.temporaryPassword}`,
      "  Ce mot de passe provisoire doit être changé à la première connexion.",
      "  Définissez CAMPUS_ADMIN_PASSWORD pour choisir vous-même ce mot de passe.",
      "==============================================================================",
      "",
    ].join("\n");
  }
  if (outcome.action === "no-admin") {
    return "[campus-agenda] Aucun compte enseignant en base : impossible d'amorcer un accès administrateur.";
  }
  return null;
}
