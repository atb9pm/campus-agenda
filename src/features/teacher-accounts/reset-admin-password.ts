import { logOperationalEvent } from "../../lib/observability/index.ts";
import type { TeacherAccountStore } from "../../lib/persistence/teacher-account-types.ts";
import type { TeacherAccountRecord, TeacherAccountSecretResult } from "./types.ts";

export const RESET_PASSWORD_CONFIRM_TOKEN = "RESET-PASSWORD";

export function isResetPasswordConfirmToken(value: string): boolean {
  return value.trim() === RESET_PASSWORD_CONFIRM_TOKEN;
}

export type ResolveAdminAccountResult =
  | { ok: true; account: TeacherAccountRecord }
  | { ok: false; reason: string };

export async function resolveAdminAccountForServerReset(
  accounts: TeacherAccountStore,
  identifier: string,
): Promise<ResolveAdminAccountResult> {
  const candidate = identifier.trim();
  if (!candidate) return { ok: false, reason: "Compte introuvable." };
  const byId = await accounts.findAccount(candidate);
  const account = byId ?? await accounts.findAccountByInitials(candidate);
  if (!account) return { ok: false, reason: "Compte introuvable." };
  if (!account.isAdmin) {
    return { ok: false, reason: `Le compte ${account.initials} n'est pas administrateur.` };
  }
  return { ok: true, account };
}

/**
 * Reset serveur du mot de passe admin. Ne touche jamais à la MFA.
 * N’agit que si la confirmation est exactement RESET-PASSWORD.
 */
export async function resetAdminPasswordWithConfirmation(
  accounts: TeacherAccountStore,
  identifier: string,
  confirmation: string,
): Promise<TeacherAccountSecretResult | { ok: false; reason: string; status: 400 | 404 }> {
  if (!isResetPasswordConfirmToken(confirmation)) {
    return { ok: false, reason: "Confirmation invalide. Aucune modification.", status: 400 };
  }
  const resolved = await resolveAdminAccountForServerReset(accounts, identifier);
  if (!resolved.ok) {
    const status = resolved.reason === "Compte introuvable." ? 404 : 400;
    return { ok: false, reason: resolved.reason, status };
  }
  const result = await accounts.resetPassword(resolved.account.id);
  if (result.ok) {
    logOperationalEvent("admin_password_server_reset", { teacherId: resolved.account.id });
  }
  return result;
}
