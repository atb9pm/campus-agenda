import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

process.env.CAMPUS_STORE ??= "memory";
process.env.AUTH_SECRET ??= "test-secret-admin-reset-password";
process.env.CAMPUS_ALLOW_DEMO_PASSWORD ??= "1";
process.env.CAMPUS_MFA_ENCRYPTION_KEY ??= "a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff00";

import { APP_VERSION } from "../src/lib/app-version.ts";
import { TEACHER_CHF_ID } from "../src/features/classes/index.ts";
import {
  RESET_PASSWORD_CONFIRM_TOKEN,
  isResetPasswordConfirmToken,
  resetAdminPasswordWithConfirmation,
  resolveAdminAccountForServerReset,
} from "../src/features/teacher-accounts/index.ts";
import {
  confirmAdminMfaEnrollment,
  startAdminMfaEnrollment,
} from "../src/features/admin-mfa/index.ts";
import { generateTotpCode } from "../src/lib/auth/totp.ts";
import { isUsablePasswordHash } from "../src/lib/auth/password.ts";
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

function resetWorld() {
  resetMemoryAdminMfaStore();
  resetMemoryTeacherAccountStore();
  resetStoreFactory();
}

async function enrollAdmin() {
  const store = getMemoryAdminMfaStore();
  const start = await startAdminMfaEnrollment(store, TEACHER_CHF_ID, "ChF");
  assert.equal(start.ok, true);
  if (!start.ok) throw new Error("enroll start");
  const confirm = await confirmAdminMfaEnrollment(store, TEACHER_CHF_ID, generateTotpCode(start.manualKey));
  assert.equal(confirm.ok, true);
  if (!confirm.ok) throw new Error("enroll confirm");
  return { secretEncrypted: (await store.get(TEACHER_CHF_ID))!, codes: confirm.recoveryCodes };
}

test("version 2.53.1 — reset mot de passe admin serveur", () => {
  assert.equal(APP_VERSION, "2.53.1");
  assert.equal(isResetPasswordConfirmToken("reset-password"), false);
  assert.equal(isResetPasswordConfirmToken("RESET-PASSWORD "), true);
  assert.equal(isResetPasswordConfirmToken(RESET_PASSWORD_CONFIRM_TOKEN), true);
  assert.equal(isResetPasswordConfirmToken("RESET-2FA"), false);
});

test("package.json expose admin:reset-password", async () => {
  const pkg = await readFile(new URL("../web/package.json", import.meta.url), "utf8");
  assert.match(pkg, /"admin:reset-password": "node --experimental-strip-types \.\.\/scripts\/reset-admin-password\.ts"/);
});

test("compte inexistant → refus", async () => {
  resetWorld();
  const accounts = getMemoryTeacherAccountStore();
  const resolved = await resolveAdminAccountForServerReset(accounts, "inconnu");
  assert.equal(resolved.ok, false);
  if (!resolved.ok) assert.match(resolved.reason, /introuvable/);
  const reset = await resetAdminPasswordWithConfirmation(accounts, "inconnu", RESET_PASSWORD_CONFIRM_TOKEN);
  assert.equal(reset.ok, false);
});

test("compte non admin → refus", async () => {
  resetWorld();
  const accounts = getMemoryTeacherAccountStore();
  const resolved = await resolveAdminAccountForServerReset(accounts, NON_ADMIN);
  assert.equal(resolved.ok, false);
  if (!resolved.ok) assert.match(resolved.reason, /pas administrateur/);
  const reset = await resetAdminPasswordWithConfirmation(accounts, NON_ADMIN, RESET_PASSWORD_CONFIRM_TOKEN);
  assert.equal(reset.ok, false);
});

test("mauvaise confirmation → aucune modification", async () => {
  resetWorld();
  const accounts = getMemoryTeacherAccountStore();
  const before = await accounts.authenticate("ChF", "campus-demo");
  assert.equal(before.ok, true);
  const reset = await resetAdminPasswordWithConfirmation(accounts, "ChF", "oui");
  assert.equal(reset.ok, false);
  if (!reset.ok) assert.match(reset.reason, /Confirmation invalide/);
  const after = await accounts.authenticate("ChF", "campus-demo");
  assert.equal(after.ok, true);
});

test("bonne confirmation → mot de passe temporaire, ancien refusé, MFA inchangée", async () => {
  resetWorld();
  const accounts = getMemoryTeacherAccountStore();
  const enrolled = await enrollAdmin();
  const mfaBefore = await getMemoryAdminMfaStore().get(TEACHER_CHF_ID);
  assert.ok(mfaBefore);
  assert.equal(mfaBefore.status, "enabled");

  const resolved = await resolveAdminAccountForServerReset(accounts, "ChF");
  assert.equal(resolved.ok, true);

  const reset = await resetAdminPasswordWithConfirmation(accounts, "ChF", RESET_PASSWORD_CONFIRM_TOKEN);
  assert.equal(reset.ok, true);
  if (!reset.ok) throw new Error("reset");
  assert.ok(reset.temporaryPassword.length >= 10);
  assert.equal(reset.account.mustChangePassword, true);
  assert.equal(reset.account.isAdmin, true);

  const hashes = await accounts.exportAllAccounts();
  const adminHash = hashes.find((entry) => entry.id === TEACHER_CHF_ID)?.passwordHash ?? "";
  assert.ok(isUsablePasswordHash(adminHash));
  assert.equal(adminHash.includes(reset.temporaryPassword), false);
  assert.doesNotMatch(adminHash, /[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/);

  const oldPassword = await accounts.authenticate("ChF", "campus-demo");
  assert.equal(oldPassword.ok, false);

  const tempLogin = await accounts.authenticate("ChF", reset.temporaryPassword);
  assert.equal(tempLogin.ok, true);
  assert.equal(tempLogin.mustChangePassword, true);

  const mfaAfter = await getMemoryAdminMfaStore().get(TEACHER_CHF_ID);
  assert.ok(mfaAfter);
  assert.equal(mfaAfter.status, mfaBefore.status);
  assert.equal(mfaAfter.secretEncrypted, mfaBefore.secretEncrypted);
  assert.deepEqual(mfaAfter.recoveryHashes, mfaBefore.recoveryHashes);
  assert.equal(mfaAfter.confirmedAt, mfaBefore.confirmedAt);
  assert.ok(enrolled.codes.length >= 8);
});
