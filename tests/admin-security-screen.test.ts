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
  hasRecentMfaRecoveryProof,
  MFA_RECOVERY_PROOF_TTL_MS,
  startAdminMfaLostPhoneReconfigure,
  startAdminMfaReconfigureWithPassword,
  verifyAdminMfaChallenge,
} from "../src/features/admin-mfa/index.ts";
import { createSessionToken, parseSessionToken } from "../src/lib/auth/session.ts";
import { recoveryCodeIsValid } from "../src/lib/auth/recovery-codes.ts";
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

  const stillValid = await recoveryCodeIsValid(codes[0]!, (await store.get(TEACHER_CHF_ID))!.recoveryHashes);
  assert.equal(stillValid, true);

  const pending = await store.get(TEACHER_CHF_ID);
  assert.ok(pending?.pendingSecretEncrypted);
  assert.equal(pending.status, "enabled");
  assert.equal(await verifyTotpCode(secret, generateTotpCode(secret)), true);
  assert.equal(await verifyAdminMfaChallenge(store, TEACHER_CHF_ID, generateTotpCode(secret)).then((r) => r.ok), true);
  assert.equal(await recoveryCodeIsValid(codes[0]!, (await store.get(TEACHER_CHF_ID))!.recoveryHashes), true);

  const confirm = await confirmAdminMfaReconfigure(store, TEACHER_CHF_ID, generateTotpCode(start.manualKey));
  assert.equal(confirm.ok, true);
  if (!confirm.ok) throw new Error("lost confirm");
  assert.equal(confirm.recoveryCodes.length, 8);
  assert.equal(await verifyAdminMfaChallenge(store, TEACHER_CHF_ID, generateTotpCode(secret)).then((r) => r.ok), false);
  assert.equal(await verifyAdminMfaChallenge(store, TEACHER_CHF_ID, codes[1]!).then((r) => r.ok), false);
  assert.equal(await verifyAdminMfaChallenge(store, TEACHER_CHF_ID, confirm.recoveryCodes[0]!).then((r) => r.ok), true);
});

test("D — régénération : un seul écran, envoi immédiat password + TOTP", async () => {
  const panel = await readFile(new URL("../web/app/components/admin-security-panel.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(panel, /regenConfirm/);
  assert.match(panel, /ADMIN_SECURITY_REGEN_WARNING/);
  assert.match(panel, /Régénérer les codes/);
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

test("1 — connexion recovery puis reconfiguration : un seul recovery", async () => {
  resetWorld();
  const { secret, codes } = await enrollAdmin();
  const store = getMemoryAdminMfaStore();
  const accounts = getMemoryTeacherAccountStore();
  const used = await verifyAdminMfaChallenge(store, TEACHER_CHF_ID, codes[0]!);
  assert.equal(used.ok, true);
  if (used.ok) assert.equal(used.usedRecovery, true);
  assert.equal(await recoveryCodeIsValid(codes[0]!, (await store.get(TEACHER_CHF_ID))!.recoveryHashes), false);

  const now = Date.now();
  const session = {
    kind: "teacher" as const,
    teacherId: TEACHER_CHF_ID,
    issuedAt: now,
    mfaRecoveryVerifiedAt: now,
  };
  const parsed = await parseSessionToken(await createSessionToken(session));
  assert.equal(parsed?.kind, "teacher");
  if (parsed?.kind === "teacher") {
    assert.equal(hasRecentMfaRecoveryProof(parsed), true);
    assert.equal("recoveryCode" in parsed, false);
    assert.equal(JSON.stringify(parsed).includes(codes[0]!), false);
  }

  const passwordStillRequired = await startAdminMfaLostPhoneReconfigure(
    store, accounts, TEACHER_CHF_ID, "ChF", "mauvais-mot-de-passe-1", "", { recoveryRecentlyVerified: true },
  );
  assert.equal(passwordStillRequired.ok, false);
  if (!passwordStillRequired.ok) assert.equal(passwordStillRequired.reason, MFA_INVALID_PASSWORD_REASON);

  const remainingBefore = (await store.get(TEACHER_CHF_ID))!.recoveryHashes.length;
  const start = await startAdminMfaLostPhoneReconfigure(
    store, accounts, TEACHER_CHF_ID, "ChF", ADMIN_PASSWORD, "", {
      recoveryRecentlyVerified: parsed?.kind === "teacher" && hasRecentMfaRecoveryProof(parsed),
    },
  );
  assert.equal((await store.get(TEACHER_CHF_ID))!.recoveryHashes.length, remainingBefore);
  assert.equal(start.ok, true);
  if (!start.ok) throw new Error("start");
  const confirm = await confirmAdminMfaReconfigure(store, TEACHER_CHF_ID, generateTotpCode(start.manualKey));
  assert.equal(confirm.ok, true);
  if (!confirm.ok) throw new Error("confirm");
  assert.equal(confirm.recoveryCodes.length, 8);
  assert.equal(await verifyAdminMfaChallenge(store, TEACHER_CHF_ID, generateTotpCode(secret)).then((r) => r.ok), false);
  for (const code of codes) {
    assert.equal(await recoveryCodeIsValid(code, (await store.get(TEACHER_CHF_ID))!.recoveryHashes), false);
  }
  assert.equal(await verifyAdminMfaChallenge(store, TEACHER_CHF_ID, confirm.recoveryCodes[0]!).then((r) => r.ok), true);
});

test("2 — preuve recovery expirée : mot de passe seul insuffisant", async () => {
  resetWorld();
  const { codes } = await enrollAdmin();
  const expiredAt = Date.now() - MFA_RECOVERY_PROOF_TTL_MS - 1;
  assert.equal(hasRecentMfaRecoveryProof({ mfaRecoveryVerifiedAt: expiredAt }), false);
  assert.equal(hasRecentMfaRecoveryProof({ mfaRecoveryVerifiedAt: Date.now() + 60_000 }), false);
  assert.equal(MFA_RECOVERY_PROOF_TTL_MS, 10 * 60 * 1000);
  const expiredSession = await parseSessionToken(await createSessionToken({
    kind: "teacher",
    teacherId: TEACHER_CHF_ID,
    issuedAt: expiredAt,
    mfaRecoveryVerifiedAt: expiredAt,
  }));
  assert.equal(expiredSession?.kind, "teacher");
  if (expiredSession?.kind === "teacher") {
    assert.equal(hasRecentMfaRecoveryProof(expiredSession), false);
  }
  const start = await startAdminMfaLostPhoneReconfigure(
    getMemoryAdminMfaStore(),
    getMemoryTeacherAccountStore(),
    TEACHER_CHF_ID,
    "ChF",
    ADMIN_PASSWORD,
    "",
    { recoveryRecentlyVerified: expiredSession?.kind === "teacher" && hasRecentMfaRecoveryProof(expiredSession) },
  );
  assert.equal(start.ok, false);
  const withCode = await startAdminMfaLostPhoneReconfigure(
    getMemoryAdminMfaStore(),
    getMemoryTeacherAccountStore(),
    TEACHER_CHF_ID,
    "ChF",
    ADMIN_PASSWORD,
    codes[1]!,
    { recoveryRecentlyVerified: false },
  );
  assert.equal(withCode.ok, true);
});

test("3 — session normale sans recovery récent : mot de passe seul refusé", async () => {
  resetWorld();
  const { codes } = await enrollAdmin();
  const session = { kind: "teacher" as const, teacherId: TEACHER_CHF_ID, issuedAt: Date.now() };
  const parsed = await parseSessionToken(await createSessionToken(session));
  assert.equal(parsed?.kind, "teacher");
  if (parsed?.kind === "teacher") {
    assert.equal(hasRecentMfaRecoveryProof(parsed), false);
    assert.equal(parsed.mfaRecoveryVerifiedAt, undefined);
  }
  const denied = await startAdminMfaLostPhoneReconfigure(
    getMemoryAdminMfaStore(), getMemoryTeacherAccountStore(), TEACHER_CHF_ID, "ChF", ADMIN_PASSWORD, "",
  );
  assert.equal(denied.ok, false);
  const ok = await startAdminMfaLostPhoneReconfigure(
    getMemoryAdminMfaStore(), getMemoryTeacherAccountStore(), TEACHER_CHF_ID, "ChF", ADMIN_PASSWORD, codes[0]!,
  );
  assert.equal(ok.ok, true);
});

test("4 — abandon après recovery : le dernier code reste utilisable", async () => {
  resetWorld();
  const { codes } = await enrollAdmin();
  const store = getMemoryAdminMfaStore();
  const accounts = getMemoryTeacherAccountStore();
  for (const code of codes.slice(0, 7)) {
    const consumed = await verifyAdminMfaChallenge(store, TEACHER_CHF_ID, code);
    assert.equal(consumed.ok, true);
  }
  const last = codes[7]!;
  const start = await startAdminMfaLostPhoneReconfigure(store, accounts, TEACHER_CHF_ID, "ChF", ADMIN_PASSWORD, last);
  assert.equal(start.ok, true);
  assert.equal(await recoveryCodeIsValid(last, (await store.get(TEACHER_CHF_ID))!.recoveryHashes), true);
  const restart = await startAdminMfaLostPhoneReconfigure(store, accounts, TEACHER_CHF_ID, "ChF", ADMIN_PASSWORD, last);
  assert.equal(restart.ok, true);
  assert.equal(await recoveryCodeIsValid(last, (await store.get(TEACHER_CHF_ID))!.recoveryHashes), true);
});

test("5 — confirmation finale invalide ancien secret et tous les recovery", async () => {
  resetWorld();
  const { secret, codes } = await enrollAdmin();
  const store = getMemoryAdminMfaStore();
  const start = await startAdminMfaLostPhoneReconfigure(
    store, getMemoryTeacherAccountStore(), TEACHER_CHF_ID, "ChF", ADMIN_PASSWORD, codes[0]!,
  );
  assert.equal(start.ok, true);
  if (!start.ok) throw new Error("start");
  const confirm = await confirmAdminMfaReconfigure(store, TEACHER_CHF_ID, generateTotpCode(start.manualKey));
  assert.equal(confirm.ok, true);
  if (!confirm.ok) throw new Error("confirm");
  assert.equal(confirm.recoveryCodes.length, 8);
  assert.equal(await verifyAdminMfaChallenge(store, TEACHER_CHF_ID, generateTotpCode(secret)).then((r) => r.ok), false);
  for (const code of codes) {
    assert.equal(await recoveryCodeIsValid(code, (await store.get(TEACHER_CHF_ID))!.recoveryHashes), false);
  }
});

test("7 — session falsifiée et pas de recovery en clair", async () => {
  resetWorld();
  const { codes } = await enrollAdmin();
  const token = await createSessionToken({
    kind: "teacher",
    teacherId: TEACHER_CHF_ID,
    issuedAt: Date.now(),
    mfaRecoveryVerifiedAt: Date.now(),
  });
  const [payload] = token.split(".");
  const decoded = JSON.parse(Buffer.from(payload!.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
  assert.equal(typeof decoded.mfaRecoveryVerifiedAt, "number");
  assert.equal(JSON.stringify(decoded).includes(codes[0]!), false);
  assert.equal(await parseSessionToken(`${payload}.AAAA`), null);

  const verifyRoute = await readFile(new URL("../web/app/api/auth/teacher/mfa/verify/route.ts", import.meta.url), "utf8");
  assert.match(verifyRoute, /usedRecovery \? \{ mfaRecoveryVerifiedAt: now \}/);
  assert.match(verifyRoute, /enforceAuthRateLimit/);
  assert.match(verifyRoute, /teacher-mfa/);
  const reconfigure = await readFile(new URL("../web/app/api/admin/security/mfa/reconfigure/route.ts", import.meta.url), "utf8");
  assert.match(reconfigure, /hasRecentMfaRecoveryProof\(auth\.session!\)/);
  assert.doesNotMatch(reconfigure, /body\.recoveryRecentlyVerified/);
  assert.match(reconfigure, /teacher-mfa/);
  const service = await readFile(new URL("../src/features/admin-mfa/service.ts", import.meta.url), "utf8");
  assert.match(service, /recoveryCodeIsValid/);
  assert.doesNotMatch(
    service.slice(service.indexOf("export async function startAdminMfaReconfigureWithRecovery"), service.indexOf("export async function confirmAdminMfaReconfigure")),
    /consumeRecoveryCode/,
  );
  const panel = await readFile(new URL("../web/app/components/admin-security-panel.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(panel, /localStorage|sessionStorage/);
  assert.match(panel, /ADMIN_SECURITY_LOST_RECENT_HINT/);
});
