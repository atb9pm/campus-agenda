/**
 * Réinitialisation serveur du mot de passe administrateur.
 * Ne touche pas à la 2FA (secret TOTP, recovery codes, état MFA).
 *
 * Usage (depuis web/) :
 *   CAMPUS_STORE=sqlite CAMPUS_SQLITE_PATH=../.data/campus-agenda.sqlite \
 *     pnpm admin:reset-password -- ChF
 */
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import {
  RESET_PASSWORD_CONFIRM_TOKEN,
  resetAdminPasswordWithConfirmation,
  resolveAdminAccountForServerReset,
} from "../src/features/teacher-accounts/reset-admin-password.ts";
import { getTeacherAccountStore } from "../src/lib/persistence/store-factory.ts";

const identifier = process.argv.slice(2).filter((value) => value !== "--").join(" ").trim();

if (!identifier) {
  console.error("Usage : pnpm admin:reset-password -- <id|initiales>");
  process.exit(1);
}

const accounts = await getTeacherAccountStore();
const resolved = await resolveAdminAccountForServerReset(accounts, identifier);
if (!resolved.ok) {
  console.error(resolved.reason);
  process.exit(1);
}

console.log(`Administrateur ciblé : ${resolved.account.initials}`);
console.log(`Identifiant          : ${resolved.account.id}`);
console.log(`Nom                  : ${resolved.account.displayName}`);
console.log("");
console.log("ATTENTION");
console.log("Vous allez réinitialiser le mot de passe de cet administrateur.");
console.log("La double authentification n'est pas modifiée.");
console.log("");
console.log(`Tapez ${RESET_PASSWORD_CONFIRM_TOKEN} pour confirmer :`);

const rl = createInterface({ input: stdin, output: stdout });
const confirmation = await rl.question("");
rl.close();

const result = await resetAdminPasswordWithConfirmation(accounts, resolved.account.id, confirmation);
if (!result.ok) {
  console.error(result.reason);
  process.exit(1);
}

console.log("Mot de passe réinitialisé.");
console.log("Le changement de mot de passe est obligatoire à la prochaine connexion.");
console.log("La 2FA (secret TOTP et codes de récupération) est inchangée.");
console.log("");
console.log("Mot de passe temporaire (affiché une seule fois) :");
console.log(result.temporaryPassword);
process.exit(0);
