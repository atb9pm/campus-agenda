import { initialsKey, normalizeDisplayName, normalizeInitials } from "../../features/teacher-accounts/rules.ts";
import type { TeacherAccountRecord } from "../../features/teacher-accounts/types.ts";
import { checkPasswordStrength, demoPasswordAllowed, generateTemporaryPassword } from "../auth/password.ts";
import { isProductionEnv, MISSING_PRODUCTION_ADMIN_PASSWORD } from "./demo-seed-policy.ts";
import type { TeacherAccountStore } from "./teacher-account-types.ts";

export type BootstrapOutcome =
  | { action: "none" }
  | { action: "env-password"; teacherId: string; initials: string }
  | { action: "generated"; teacherId: string; initials: string; temporaryPassword: string }
  | { action: "created-bootstrap"; teacherId: string; initials: string }
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

function bootstrapIdentity(): { initials: string; displayName: string } {
  const initials = normalizeInitials(process.env.CAMPUS_ADMIN_INITIALS?.trim() || DEFAULT_ADMIN_INITIALS);
  const named = process.env.CAMPUS_ADMIN_DISPLAY_NAME?.trim();
  const displayName = normalizeDisplayName(named || initials || "Administrateur");
  return { initials: initials || DEFAULT_ADMIN_INITIALS, displayName };
}

async function createProductionBootstrapAdmin(store: TeacherAccountStore): Promise<BootstrapOutcome> {
  const password = process.env.CAMPUS_ADMIN_PASSWORD?.trim();
  if (!password) {
    throw new Error(MISSING_PRODUCTION_ADMIN_PASSWORD);
  }
  const strength = checkPasswordStrength(password);
  if (!strength.ok) {
    throw new Error(`Base Campus Agenda vierge : ${strength.reason}`);
  }
  const identity = bootstrapIdentity();
  const created = await store.createAccount({
    displayName: identity.displayName,
    initials: identity.initials,
    isAdmin: true,
  });
  if (!created.ok) {
    throw new Error(created.reason);
  }
  const saved = await store.setPassword(created.account.id, password, true);
  if (!saved) {
    throw new Error("Impossible d'enregistrer le mot de passe de l'administrateur initial.");
  }
  return {
    action: "created-bootstrap",
    teacherId: created.account.id,
    initials: created.account.initials,
  };
}

/**
 * Garantit qu'un administrateur peut se connecter.
 *
 * Base de production totalement vide : crée un unique admin si
 * `CAMPUS_ADMIN_PASSWORD` est défini — jamais de mot de passe de démonstration.
 *
 * Base déjà peuplée :
 * 1. `CAMPUS_ADMIN_PASSWORD` est appliqué au compte visé tant qu'il n'a pas
 *    encore de mot de passe personnel ;
 * 2. sinon, hors base vide, un mot de passe provisoire peut être tiré.
 *
 * Un mot de passe déjà choisi n'est jamais écrasé. Aucun compte n'est recréé
 * au redémarrage.
 */
export async function ensureTeacherAccountBootstrap(
  store: TeacherAccountStore,
): Promise<BootstrapOutcome> {
  const accounts = await store.listAccounts();
  if (accounts.length === 0) {
    if (isProductionEnv()) {
      return createProductionBootstrapAdmin(store);
    }
    return { action: "no-admin" };
  }

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
  if (outcome.action === "created-bootstrap") {
    return `[campus-agenda] Administrateur initial créé (${outcome.initials}). Mot de passe issu de CAMPUS_ADMIN_PASSWORD.`;
  }
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
