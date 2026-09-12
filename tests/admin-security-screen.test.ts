import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

process.env.CAMPUS_STORE ??= "memory";
process.env.AUTH_SECRET ??= "test-secret-admin-security-screen";
process.env.CAMPUS_ALLOW_DEMO_PASSWORD ??= "1";
process.env.CAMPUS_MFA_ENCRYPTION_KEY ??= "a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff00";

import { APP_VERSION } from "../src/lib/app-version.ts";
import { TEACHER_CHF_ID } from "../src/features/classes/index.ts";
import {
  ADMIN_SECURITY_ACK_CODES,
  ADMIN_SECURITY_HELP_TITLE,
  ADMIN_SECURITY_LOST_TITLE,
  ADMIN_SECURITY_RECONFIGURE_TITLE,
  ADMIN_SECURITY_REGEN_TITLE,
  MFA_INVALID_CODE_REASON,
  MFA_INVALID_PASSWORD_REASON,
  confirmAdminMfaReconfigure,
  regenerateAdminRecoveryCodesWithPassword,
  resetAdminMfa,
  startAdminMfaEnrollment,
  confirmAdminMfaEnrollment,
  startAdminMfaLostPhoneReconfigure,
  startAdminMfaReconfigureWithPassword,
  verifyAdminMfaChallenge,
} from "../src/features/admin-mfa/index.ts";
import { resetAdminPasswordWithConfirmation, RESET_PASSWORD_CONFIRM_TOKEN } from "../src/features/teacher-accounts/index.ts";
import { generateTotpCode, verifyTotpCode } from "../src/lib/auth/totp.ts";
import {
  getMemoryAdminMfaStore,
  resetMemoryAdminMfaStore,
} from "../src/lib/persistence/memory-admin-mfa-store.ts";
import {
  getMemoryTeacherAccountStore,
  resetMemoryTeacherAccountStore,
} from "../src/lib/persistence/memory-teacher-account-store.ts";
import { resetStoreFactory } from "../src/lib/persistence/store-factory.ts";

const NON_ADMIN = "teacher-demo-martin";
const ADMIN_PASSWORD = "campus-demo";

function resetWorld() {
  resetMemoryAdminMfaStore();
  resetMemoryTeacherAccountStore();
  resetStoreFactory();
}

async function enrollAdmin() {
  const store = getMemoryAdminMfaStore();
  const start = await startAdminMfaEnrollment(store, TEACHER_CHF_ID, "ChF");
  assert.equal(start.ok, true);
  if (!start.ok) throw new Error("enroll");
  const confirm = await confirmAdminMfaEnrollment(store, TEACHER_CHF_ID, generateTotpCode(start.manualKey));
  assert.equal(confirm.ok, true);
  if (!confirm.ok) throw new Error("confirm");
  return { secret: start.manualKey, codes: confirm.recoveryCodes };
}

test("version 2.54.0 — écran Sécurité administrateur", () => {
  assert.equal(APP_VERSION, "2.54.0");
});

test("A — écran principal : trois actions, pas de TOTP par défaut", async () => {
  const panel = await readFile(new URL("../web/app/components/admin-security-panel.tsx", import.meta.url), "utf8");
  const main = panel.slice(panel.lastIndexOf("return ("));
  assert.doesNotMatch(main, /Code TOTP actuel/);
  assert.doesNotMatch(main, /totp-code-input/);
  assert.match(main, /ADMIN_SECURITY_RECONFIGURE_TITLE/);
  assert.match(main, /ADMIN_SECURITY_LOST_TITLE/);
  assert.match(main, /ADMIN_SECURITY_REGEN_TITLE/);
  assert.match(main, /ADMIN_SECURITY_RECONFIGURE_BUTTON/);
  assert.match(main, /ADMIN_SECURITY_LOST_BUTTON/);
  assert.match(main, /ADMIN_SECURITY_REGEN_BUTTON/);
  assert.match(main, /codes disponibles/);
  assert.match(main, /ADMIN_SECURITY_HELP_TITLE/);
  assert.match(panel, /ADMIN_SECURITY_ACK_CODES/);
  assert.equal(ADMIN_SECURITY_RECONFIGURE_TITLE, "Reconfigurer la double authentification");
  assert.equal(ADMIN_SECURITY_LOST_TITLE, "J’ai perdu l’accès à mon téléphone");
  assert.equal(ADMIN_SECURITY_REGEN_TITLE, "Régénérer les codes de récupération");
  assert.equal(ADMIN_SECURITY_ACK_CODES, "J’ai enregistré ces codes");
  assert.equal(ADMIN_SECURITY_HELP_TITLE, "Plus aucun moyen de récupération ?");
  assert.doesNotMatch(panel, /localStorage|sessionStorage/);
  assert.doesNotMatch(panel, /désactiver la 2FA|mot de passe oublié/i);
});

test("A — API sensibles exigent mot de passe et n'exposent pas otpauthUri", async () => {
  const reconfigure = await readFile(new URL("../web/app/api/admin/security/mfa/reconfigure/route.ts", import.meta.url), "utf8");
  const recovery = await readFile(new URL("../web/app/api/admin/security/mfa/recovery/route.ts", import.meta.url), "utf8");
  assert.match(reconfigure, /requireAdminSession/);
  assert.match(reconfigure, /startAdminMfaReconfigureWithPassword/);
  assert.match(reconfigure, /startAdminMfaLostPhoneReconfigure/);
  assert.match(reconfigure, /enforceAuthRateLimit/);
  assert.doesNotMatch(reconfigure, /otpauthUri/);
  assert.match(recovery, /requireAdminSession/);
  assert.match(recovery, /regenerateAdminRecoveryCodesWithPassword/);
  assert.match(recovery, /enforceAuthRateLimit/);
});

test("B — reconfiguration volontaire : mot de passe + TOTP, pending anti-lockout", async () => {
  resetWorld();
  const { secret, codes } = await enrollAdmin();
  const store = getMemoryAdminMfaStore();
  const accounts = getMemoryTeacherAccountStore();

  const badPassword = await startAdminMfaReconfigureWithPassword(
    store, accounts, TEACHER_CHF_ID, "ChF", "mauvais-mot-de-passe-1", generateTotpCode(secret),
  );
  assert.equal(badPassword.ok, false);
  if (!badPassword.ok) assert.equal(badPassword.reason, MFA_INVALID_PASSWORD_REASON);

  const badTotp = await startAdminMfaReconfigureWithPassword(
    store, accounts, TEACHER_CHF_ID, "ChF", ADMIN_PASSWORD, "000000",
  );
  assert.equal(badTotp.ok, false);
  if (!badTotp.ok) assert.equal(badTotp.reason, MFA_INVALID_CODE_REASON);

  const recoveryAsTotp = await startAdminMfaReconfigureWithPassword(
    store, accounts, TEACHER_CHF_ID, "ChF", ADMIN_PASSWORD, codes[0]!,
  );
  assert.equal(recoveryAsTotp.ok, false);

  const start = await startAdminMfaReconfigureWithPassword(
    store, accounts, TEACHER_CHF_ID, "ChF", ADMIN_PASSWORD, generateTotpCode(secret),
  );
  assert.equal(start.ok, true);
  if (!start.ok) throw new Error("start");
  const pending = await store.get(TEACHER_CHF_ID);
  assert.ok(pending?.pendingSecretEncrypted);
  assert.equal(pending.status, "enabled");
  const oldStillWorks = await verifyAdminMfaChallenge(store, TEACHER_CHF_ID, generateTotpCode(secret));
  assert.equal(oldStillWorks.ok, true);

  const confirm = await confirmAdminMfaReconfigure(store, TEACHER_CHF_ID, generateTotpCode(start.manualKey));
  assert.equal(confirm.ok, true);
  if (!confirm.ok) throw new Error("confirm");
  assert.equal(confirm.recoveryCodes.length, 8);
  assert.equal(await verifyAdminMfaChallenge(store, TEACHER_CHF_ID, generateTotpCode(secret)).then((r) => r.ok), false);
  assert.equal(await verifyAdminMfaChallenge(store, TEACHER_CHF_ID, generateTotpCode(start.manualKey)).then((r) => r.ok), true);
  assert.equal(await verifyAdminMfaChallenge(store, TEACHER_CHF_ID, codes[0]!).then((r) => r.ok), false);
  assert.equal(await verifyAdminMfaChallenge(store, TEACHER_CHF_ID, confirm.recoveryCodes[0]!).then((r) => r.ok), true);
});

test("C — téléphone perdu : mot de passe + recovery, abandon sans lockout", async () => {
  resetWorld();
  const { secret, codes } = await enrollAdmin();
  const store = getMemoryAdminMfaStore();
  const accounts = getMemoryTeacherAccountStore();

  const badPassword = await startAdminMfaLostPhoneReconfigure(
    store, accounts, TEACHER_CHF_ID, "ChF", "mauvais-mot-de-passe-1", codes[0]!,
  );
  assert.equal(badPassword.ok, false);
  if (!badPassword.ok) assert.equal(badPassword.reason, MFA_INVALID_PASSWORD_REASON);

  const badRecovery = await startAdminMfaLostPhoneReconfigure(
    store, accounts, TEACHER_CHF_ID, "ChF", ADMIN_PASSWORD, "ZZZZ-ZZZZ",
  );
  assert.equal(badRecovery.ok, false);

  const start = await startAdminMfaLostPhoneReconfigure(
    store, accounts, TEACHER_CHF_ID, "ChF", ADMIN_PASSWORD, codes[0]!,
  );
  assert.equal(start.ok, true);
  if (!start.ok) throw new Error("lost start");

  const reused = await startAdminMfaLostPhoneReconfigure(
    store, accounts, TEACHER_CHF_ID, "ChF", ADMIN_PASSWORD, codes[0]!,
  );
  assert.equal(reused.ok, false);

  const pending = await store.get(TEACHER_CHF_ID);
  assert.ok(pending?.pendingSecretEncrypted);
  assert.equal(pending.status, "enabled");
  assert.equal(await verifyTotpCode(secret, generateTotpCode(secret)), true);
  assert.equal(await verifyAdminMfaChallenge(store, TEACHER_CHF_ID, generateTotpCode(secret)).then((r) => r.ok), true);
  assert.equal(await verifyAdminMfaChallenge(store, TEACHER_CHF_ID, codes[1]!).then((r) => r.ok), true);

  const confirm = await confirmAdminMfaReconfigure(store, TEACHER_CHF_ID, generateTotpCode(start.manualKey));
  assert.equal(confirm.ok, true);
  if (!confirm.ok) throw new Error("lost confirm");
  assert.equal(confirm.recoveryCodes.length, 8);
  assert.equal(await verifyAdminMfaChallenge(store, TEACHER_CHF_ID, generateTotpCode(secret)).then((r) => r.ok), false);
  assert.equal(await verifyAdminMfaChallenge(store, TEACHER_CHF_ID, codes[1]!).then((r) => r.ok), false);
  assert.equal(await verifyAdminMfaChallenge(store, TEACHER_CHF_ID, confirm.recoveryCodes[0]!).then((r) => r.ok), true);
});

test("D — régénération recovery : mot de passe + TOTP", async () => {
  resetWorld();
  const { secret, codes } = await enrollAdmin();
  const store = getMemoryAdminMfaStore();
  const accounts = getMemoryTeacherAccountStore();

  const badPassword = await regenerateAdminRecoveryCodesWithPassword(
    store, accounts, TEACHER_CHF_ID, "mauvais-mot-de-passe-1", generateTotpCode(secret),
  );
  assert.equal(badPassword.ok, false);

  const regen = await regenerateAdminRecoveryCodesWithPassword(
    store, accounts, TEACHER_CHF_ID, ADMIN_PASSWORD, generateTotpCode(secret),
  );
  assert.equal(regen.ok, true);
  if (!regen.ok) throw new Error("regen");
  assert.equal(regen.recoveryCodes.length, 8);
  assert.equal(await verifyAdminMfaChallenge(store, TEACHER_CHF_ID, codes[0]!).then((r) => r.ok), false);
  assert.equal(await verifyAdminMfaChallenge(store, TEACHER_CHF_ID, regen.recoveryCodes[0]!).then((r) => r.ok), true);
});

test("E — enseignant non admin : verifyCredentials ok mais MFA absente", async () => {
  resetWorld();
  const accounts = getMemoryTeacherAccountStore();
  assert.equal(await accounts.verifyCredentials(NON_ADMIN, ADMIN_PASSWORD), true);
  const denied = await startAdminMfaReconfigureWithPassword(
    getMemoryAdminMfaStore(), accounts, NON_ADMIN, "MM", ADMIN_PASSWORD, "123456",
  );
  assert.equal(denied.ok, false);
});

test("F — régression login, reset-2fa, reset-password", async () => {
  resetWorld();
  const { secret, codes } = await enrollAdmin();
  const accounts = getMemoryTeacherAccountStore();
  const teacher = await accounts.authenticate(NON_ADMIN, ADMIN_PASSWORD);
  assert.equal(teacher.ok, true);
  const admin = await accounts.authenticate("ChF", ADMIN_PASSWORD);
  assert.equal(admin.ok, true);
  assert.equal(await verifyAdminMfaChallenge(getMemoryAdminMfaStore(), TEACHER_CHF_ID, generateTotpCode(secret)).then((r) => r.ok), true);
  assert.equal(await verifyAdminMfaChallenge(getMemoryAdminMfaStore(), TEACHER_CHF_ID, codes[0]!).then((r) => r.ok), true);

  const reset2fa = await resetAdminMfa(getMemoryAdminMfaStore(), TEACHER_CHF_ID);
  assert.equal(reset2fa.ok, true);
  const afterReset = await getMemoryAdminMfaStore().get(TEACHER_CHF_ID);
  assert.equal(afterReset?.status, "reset_required");

  resetWorld();
  await enrollAdmin();
  const freshAccounts = getMemoryTeacherAccountStore();
  const mfaBefore = await getMemoryAdminMfaStore().get(TEACHER_CHF_ID);
  const pwd = await resetAdminPasswordWithConfirmation(freshAccounts, "ChF", RESET_PASSWORD_CONFIRM_TOKEN);
  assert.equal(pwd.ok, true);
  const mfaAfter = await getMemoryAdminMfaStore().get(TEACHER_CHF_ID);
  assert.equal(mfaAfter?.secretEncrypted, mfaBefore?.secretEncrypted);
  assert.deepEqual(mfaAfter?.recoveryHashes, mfaBefore?.recoveryHashes);
});
