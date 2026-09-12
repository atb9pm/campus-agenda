/**
 * Réinitialisation serveur de la 2FA administrateur.
 * Ne désactive pas durablement la MFA : place le compte en MFA_RESET_REQUIRED.
 *
 * Usage (depuis web/) :
 *   CAMPUS_STORE=sqlite CAMPUS_SQLITE_PATH=../.data/campus-agenda.sqlite \
 *     pnpm admin:reset-2fa -- ChF
 */
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { RESET_2FA_CONFIRM_TOKEN, isReset2faConfirmToken } from "../src/features/admin-mfa/types.ts";
import { resetAdminMfa } from "../src/features/admin-mfa/reset.ts";
import { getAdminMfaStore, getTeacherAccountStore } from "../src/lib/persistence/store-factory.ts";

const identifier = process.argv.slice(2).filter((value) => value !== "--").join(" ").trim();

if (!identifier) {
  console.error("Usage : pnpm admin:reset-2fa -- <id|initiales>");
  process.exit(1);
}

const accounts = await getTeacherAccountStore();
const byId = await accounts.findAccount(identifier);
const account = byId ?? await accounts.findAccountByInitials(identifier);

if (!account) {
  console.error("Compte introuvable.");
  process.exit(1);
}
if (!account.isAdmin) {
  console.error(`Le compte ${account.initials} n'est pas administrateur.`);
  process.exit(1);
}

console.log(`Compte administrateur : ${account.initials}`);
console.log(`Identifiant          : ${account.id}`);
console.log(`Nom                  : ${account.displayName}`);
console.log("");
console.log("ATTENTION");
console.log("Vous allez réinitialiser la double authentification");
console.log("de cet administrateur.");
console.log("");
console.log(`Tapez ${RESET_2FA_CONFIRM_TOKEN} pour confirmer :`);

const rl = createInterface({ input: stdin, output: stdout });
const confirmation = await rl.question("");
rl.close();

if (!isReset2faConfirmToken(confirmation)) {
  console.error("Confirmation invalide. Aucune modification.");
  process.exit(1);
}

const result = await resetAdminMfa(await getAdminMfaStore(), account.id);
if (!result.ok) {
  console.error(result.reason);
  process.exit(1);
}

console.log("Double authentification réinitialisée.");
console.log("État : MFA_RESET_REQUIRED — une nouvelle configuration TOTP est obligatoire à la prochaine connexion.");
process.exit(0);
