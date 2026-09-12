import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

process.env.CAMPUS_STORE ??= "memory";
process.env.AUTH_SECRET ??= "test-secret-admin-mfa";
process.env.CAMPUS_ALLOW_DEMO_PASSWORD ??= "1";
process.env.CAMPUS_MFA_ENCRYPTION_KEY ??= "a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff00";

import { APP_VERSION } from "../src/lib/app-version.ts";
import { TEACHER_CHF_ID } from "../src/features/classes/index.ts";
import {
  MFA_INVALID_CODE_REASON,
  MFA_PENDING_REASON,
  MFA_SETUP_REQUIRED_REASON,
  MFA_UNAVAILABLE_REASON,
  RESET_2FA_CONFIRM_TOKEN,
  adminMfaStatusView,
  confirmAdminMfaEnrollment,
  confirmAdminMfaReconfigure,
  describeAdminMfaFlags,
  evaluateAdminMfaAccess,
  isReset2faConfirmToken,
  regenerateAdminRecoveryCodes,
  resetAdminMfa,
  startAdminMfaEnrollment,
  startAdminMfaReconfigure,
  verifyAdminMfaChallenge,
} from "../src/features/admin-mfa/index.ts";
import {
  decryptTotpSecret,
  encryptTotpSecret,
  isMfaEncryptionReady,
  looksLikeEncryptedTotpSecret,
  parseMfaEncryptionKey,
} from "../src/lib/auth/mfa-crypto.ts";
import { generateTotpCode, verifyTotpCode } from "../src/lib/auth/totp.ts";
import { consumeRecoveryCode, parseRecoveryInput } from "../src/lib/auth/recovery-codes.ts";
import { createSessionToken, parseSessionToken } from "../src/lib/auth/session.ts";
import {
  getMemoryAdminMfaStore,
  resetMemoryAdminMfaStore,
} from "../src/lib/persistence/memory-admin-mfa-store.ts";
import {
  getMemoryTeacherAccountStore,
  resetMemoryTeacherAccountStore,
} from "../src/lib/persistence/memory-teacher-account-store.ts";
import { getMemoryAgendaStore, resetMemoryAgendaStore } from "../src/lib/persistence/memory-store.ts";
import { resetStoreFactory } from "../src/lib/persistence/store-factory.ts";
import { exportCampusSnapshot, restoreCampusSnapshot } from "../src/lib/persistence/campus-backup.ts";
import { CAMPUS_BACKUP_INSERT_ORDER } from "../src/lib/persistence/campus-backup-tables.ts";
import { getMemoryTeacherSetupStore, resetMemoryTeacherSetupStore } from "../src/lib/persistence/memory-teacher-setup-store.ts";
import { getMemoryTeacherNotesStore, resetMemoryTeacherNotesStore } from "../src/lib/persistence/memory-teacher-notes-store.ts";
import { getMemorySchoolCatalogStore, resetMemorySchoolCatalogStore } from "../src/lib/persistence/memory-school-catalog-store.ts";
import { MemorySchoolYearStore, resetMemorySchoolYearStore } from "../src/lib/persistence/memory-school-year-store.ts";
import { getMemoryAnnualCourseStore, resetMemoryAnnualCourseStore } from "../src/lib/persistence/memory-annual-course-store.ts";
import { getMemoryCourseScheduleStore, resetMemoryCourseScheduleStore } from "../src/lib/persistence/memory-course-schedule-store.ts";
import { MemoryMembershipStore, resetMemoryMembershipStore } from "../src/lib/persistence/memory-membership-store.ts";
import {
  getMemoryAnnualCourseNotesStore,
  getMemoryPedagogicalPathStore,
  resetMemoryPedagogicalPathStore,
} from "../src/lib/persistence/memory-pedagogical-path-store.ts";
import { getMemoryTemplateStore, resetMemoryTemplateStore } from "../src/lib/persistence/memory-template-store.ts";
import { getMemoryTimetableStore, resetMemoryTimetableStore } from "../src/lib/persistence/memory-timetable-store.ts";
import { createNodeSqliteDatabase } from "../src/lib/persistence/sql/adapters.ts";
import { applyMigrations } from "../src/lib/persistence/sql/migrate.ts";
import { SqlAdminMfaStore } from "../src/lib/persistence/sql/sql-admin-mfa-store.ts";
import { dumpCampusTables, restoreCampusTables, validateCampusTables } from "../src/lib/persistence/sql/sql-campus-backup.ts";
import { seedDemoDatabase } from "../src/lib/persistence/sql/seed.ts";
import {
  checkInMemoryRateLimit,
  resetInMemoryRateLimits,
  resolveAuthRateLimit,
} from "../src/lib/security/rate-limit.ts";

const NON_ADMIN = "teacher-demo-martin";
const MFA_KEY = "a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff00";

function resetWorld() {
  resetMemoryAdminMfaStore();
  resetMemoryTeacherAccountStore();
  resetMemoryAgendaStore();
  resetStoreFactory();
  resetInMemoryRateLimits();
}

async function enrollAdmin(store = getMemoryAdminMfaStore(), teacherId = TEACHER_CHF_ID) {
  const start = await startAdminMfaEnrollment(store, teacherId, "ChF");
  assert.equal(start.ok, true);
  if (!start.ok) return { secret: "", codes: [] as string[] };
  const secret = start.manualKey;
  const confirm = await confirmAdminMfaEnrollment(store, teacherId, generateTotpCode(secret));
  assert.equal(confirm.ok, true);
  if (!confirm.ok) return { secret, codes: [] as string[] };
  return { secret, codes: confirm.recoveryCodes };
}

test("version 2.53.0 — 2FA administrateur TOTP", () => {
  assert.equal(APP_VERSION, "2.53.0");
  assert.ok(CAMPUS_BACKUP_INSERT_ORDER.includes("teacher_mfa"));
  assert.equal(CAMPUS_BACKUP_INSERT_ORDER.length, 30);
  assert.equal(isReset2faConfirmToken("yes"), false);
  assert.equal(isReset2faConfirmToken("reset-2fa"), false);
  assert.equal(isReset2faConfirmToken(RESET_2FA_CONFIRM_TOKEN), true);
});

test("1 — enseignant standard : connexion sans TOTP", async () => {
  resetWorld();
  const accounts = getMemoryTeacherAccountStore();
  const login = await accounts.authenticate(NON_ADMIN, "campus-demo");
  assert.equal(login.ok, true);
  const flags = describeAdminMfaFlags(false, null, false);
  assert.deepEqual(flags, { mfaPending: false, mfaSetupRequired: false, mfaChallengeRequired: false });
});

test("2 — administrateur sans MFA : configuration obligatoire", async () => {
  resetWorld();
  const flags = describeAdminMfaFlags(true, null, true);
  assert.equal(flags.mfaSetupRequired, true);
  assert.equal(flags.mfaChallengeRequired, false);
  const start = await startAdminMfaEnrollment(getMemoryAdminMfaStore(), TEACHER_CHF_ID, "ChF");
  assert.equal(start.ok, true);
  if (!start.ok) return;
  assert.match(start.otpauthUri, /^otpauth:\/\/totp\//);
  const pending = await getMemoryAdminMfaStore().get(TEACHER_CHF_ID);
  assert.ok(pending);
  assert.notEqual(pending.status, "enabled");
});

test("3-6 — mot de passe seul, bon TOTP, mauvais TOTP, MFA_PENDING refuse l'API admin", async () => {
  resetWorld();
  const { secret } = await enrollAdmin();
  const pending = evaluateAdminMfaAccess({
    isAdmin: true,
    mfaPending: true,
    status: "enabled",
  });
  assert.equal(pending.ok, false);
  if (!pending.ok) {
    assert.equal(pending.status, 403);
    assert.equal(pending.reason, MFA_PENDING_REASON);
    assert.equal(pending.mfaPending, true);
  }

  const bad = await verifyAdminMfaChallenge(getMemoryAdminMfaStore(), TEACHER_CHF_ID, "000000");
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.reason, MFA_INVALID_CODE_REASON);

  const good = await verifyAdminMfaChallenge(getMemoryAdminMfaStore(), TEACHER_CHF_ID, generateTotpCode(secret));
  assert.equal(good.ok, true);

  const full = evaluateAdminMfaAccess({ isAdmin: true, mfaPending: false, status: "enabled" });
  assert.equal(full.ok, true);
});

test("7-9 — recovery code unique, réutilisation refusée, régénération invalide les anciens", async () => {
  resetWorld();
  const { secret, codes } = await enrollAdmin();
  assert.equal(codes.length, 8);
  const first = await verifyAdminMfaChallenge(getMemoryAdminMfaStore(), TEACHER_CHF_ID, codes[0]!);
  assert.equal(first.ok, true);
  if (first.ok) assert.equal(first.usedRecovery, true);
  const reuse = await verifyAdminMfaChallenge(getMemoryAdminMfaStore(), TEACHER_CHF_ID, codes[0]!);
  assert.equal(reuse.ok, false);

  const regen = await regenerateAdminRecoveryCodes(
    getMemoryAdminMfaStore(),
    TEACHER_CHF_ID,
    generateTotpCode(secret),
  );
  assert.equal(regen.ok, true);
  if (!regen.ok) return;
  const oldStill = await verifyAdminMfaChallenge(getMemoryAdminMfaStore(), TEACHER_CHF_ID, codes[1]!);
  assert.equal(oldStill.ok, false);
  const fresh = await verifyAdminMfaChallenge(getMemoryAdminMfaStore(), TEACHER_CHF_ID, regen.recoveryCodes[0]!);
  assert.equal(fresh.ok, true);
});

test("10-11 — promotion admin impose la MFA ; rétrogradation conserve l'enseignant", async () => {
  resetWorld();
  const accounts = getMemoryTeacherAccountStore();
  const promoted = await accounts.updateAccount(NON_ADMIN, { isAdmin: true });
  assert.equal(promoted.ok, true);
  const flags = describeAdminMfaFlags(true, null, false);
  assert.equal(flags.mfaSetupRequired, true);
  const denied = evaluateAdminMfaAccess({ isAdmin: true, mfaPending: false, status: null });
  assert.equal(denied.ok, false);
  if (!denied.ok) {
    assert.equal(denied.reason, MFA_SETUP_REQUIRED_REASON);
    assert.equal(denied.mfaSetupRequired, true);
  }

  const demoted = await accounts.updateAccount(NON_ADMIN, { isAdmin: false });
  assert.equal(demoted.ok, true);
  const teacherLogin = await accounts.authenticate(NON_ADMIN, "campus-demo");
  assert.equal(teacherLogin.ok, true);
  const teacherGate = evaluateAdminMfaAccess({ isAdmin: false, mfaPending: false, status: null });
  assert.equal(teacherGate.ok, false);
});

test("12-15 — reset serveur : ancien TOTP/recovery morts, reset_required, API admin refusée", async () => {
  resetWorld();
  const { secret, codes } = await enrollAdmin();
  const reset = await resetAdminMfa(getMemoryAdminMfaStore(), TEACHER_CHF_ID);
  assert.equal(reset.ok, true);
  const record = await getMemoryAdminMfaStore().get(TEACHER_CHF_ID);
  assert.equal(record?.status, "reset_required");
  assert.equal(record?.secretEncrypted, null);
  assert.equal(record?.recoveryHashes.length, 0);
  assert.equal(await verifyTotpCode(secret, generateTotpCode(secret)), true);
  const oldTotp = await verifyAdminMfaChallenge(getMemoryAdminMfaStore(), TEACHER_CHF_ID, generateTotpCode(secret));
  assert.equal(oldTotp.ok, false);
  const oldRecovery = await verifyAdminMfaChallenge(getMemoryAdminMfaStore(), TEACHER_CHF_ID, codes[0]!);
  assert.equal(oldRecovery.ok, false);
  const denied = evaluateAdminMfaAccess({
    isAdmin: true,
    mfaPending: false,
    status: "reset_required",
  });
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.mfaSetupRequired, true);
});

test("16-17 — reconfiguration : nouveau TOTP, ancien invalide", async () => {
  resetWorld();
  const { secret } = await enrollAdmin();
  const start = await startAdminMfaReconfigure(
    getMemoryAdminMfaStore(),
    TEACHER_CHF_ID,
    "ChF",
    generateTotpCode(secret),
  );
  assert.equal(start.ok, true);
  if (!start.ok) return;
  const confirm = await confirmAdminMfaReconfigure(
    getMemoryAdminMfaStore(),
    TEACHER_CHF_ID,
    generateTotpCode(start.manualKey),
  );
  assert.equal(confirm.ok, true);
  const old = await verifyAdminMfaChallenge(getMemoryAdminMfaStore(), TEACHER_CHF_ID, generateTotpCode(secret));
  assert.equal(old.ok, false);
  const next = await verifyAdminMfaChallenge(
    getMemoryAdminMfaStore(),
    TEACHER_CHF_ID,
    generateTotpCode(start.manualKey),
  );
  assert.equal(next.ok, true);
});

test("18 — rate limiting MFA", () => {
  resetInMemoryRateLimits();
  const key = "auth:teacher-mfa:203.0.113.8:teacher-chf";
  assert.equal(resolveAuthRateLimit("teacher-mfa"), 8);
  for (let index = 0; index < 8; index += 1) {
    assert.equal(checkInMemoryRateLimit(key, 8), true);
  }
  assert.equal(checkInMemoryRateLimit(key, 8), false);
});

test("19-20 — secret et recovery jamais en clair", async () => {
  resetWorld();
  const { secret, codes } = await enrollAdmin();
  const record = await getMemoryAdminMfaStore().get(TEACHER_CHF_ID);
  assert.ok(record);
  assert.ok(looksLikeEncryptedTotpSecret(record.secretEncrypted));
  assert.equal(record.secretEncrypted?.includes(secret), false);
  const blob = JSON.stringify(record.recoveryHashes).toUpperCase();
  for (const code of codes) {
    assert.equal(blob.includes(code.replace("-", "")), false);
    assert.equal(blob.includes(code), false);
  }
  assert.ok(parseRecoveryInput(codes[0]!));
});

test("21 — backup/restore mémoire conserve le blob MFA chiffré", async () => {
  resetWorld();
  resetMemoryTeacherSetupStore();
  resetMemoryTeacherNotesStore();
  resetMemorySchoolCatalogStore();
  resetMemorySchoolYearStore();
  resetMemoryAnnualCourseStore();
  resetMemoryCourseScheduleStore();
  resetMemoryMembershipStore();
  resetMemoryPedagogicalPathStore();
  resetMemoryTemplateStore();
  resetMemoryTimetableStore();
  const { secret } = await enrollAdmin();
  const deps = {
    agenda: getMemoryAgendaStore(),
    teacherSetups: getMemoryTeacherSetupStore(),
    teacherNotes: getMemoryTeacherNotesStore(),
    teacherAccounts: getMemoryTeacherAccountStore(),
    catalog: getMemorySchoolCatalogStore(),
    years: new MemorySchoolYearStore(),
    courses: getMemoryAnnualCourseStore(),
    schedules: getMemoryCourseScheduleStore(),
    memberships: new MemoryMembershipStore(),
    paths: getMemoryPedagogicalPathStore(),
    courseNotes: getMemoryAnnualCourseNotesStore(),
    templates: getMemoryTemplateStore(),
    timetable: getMemoryTimetableStore(),
    adminMfa: getMemoryAdminMfaStore(),
    sqlDb: null,
  };
  const snapshot = await exportCampusSnapshot(deps);
  assert.ok(snapshot.tables.teacher_mfa?.length);
  const dumped = snapshot.tables.teacher_mfa![0]!;
  assert.equal(String(dumped.secret_encrypted).includes(secret), false);
  resetMemoryAdminMfaStore();
  const restored = await restoreCampusSnapshot({ ...deps, adminMfa: getMemoryAdminMfaStore() }, snapshot);
  assert.equal(restored.ok, true);
  const again = await verifyAdminMfaChallenge(getMemoryAdminMfaStore(), TEACHER_CHF_ID, generateTotpCode(secret));
  assert.equal(again.ok, true);
});

test("21b — backup/restore SQL teacher_mfa", async () => {
  const db = createNodeSqliteDatabase(":memory:");
  await applyMigrations(db);
  await seedDemoDatabase(db);
  const store = new SqlAdminMfaStore(db);
  const { secret } = await enrollAdmin(store, TEACHER_CHF_ID);
  const dump = await dumpCampusTables(db);
  assert.ok(dump.teacher_mfa?.length);
  const validated = validateCampusTables(dump);
  assert.equal(validated.ok, true);
  if (!validated.ok) return;
  await restoreCampusTables(db, validated.tables);
  const after = await verifyAdminMfaChallenge(store, TEACHER_CHF_ID, generateTotpCode(secret));
  assert.equal(after.ok, true);
});

test("22 — absence de clé : fail closed", async () => {
  const previousKey = process.env.CAMPUS_MFA_ENCRYPTION_KEY;
  const previousRequire = process.env.CAMPUS_MFA_REQUIRE_KEY;
  process.env.CAMPUS_MFA_REQUIRE_KEY = "1";
  delete process.env.CAMPUS_MFA_ENCRYPTION_KEY;
  try {
    assert.equal(isMfaEncryptionReady(), false);
    resetMemoryAdminMfaStore();
    const start = await startAdminMfaEnrollment(getMemoryAdminMfaStore(), TEACHER_CHF_ID, "ChF");
    assert.equal(start.ok, false);
    if (!start.ok) {
      assert.equal(start.reason, MFA_UNAVAILABLE_REASON);
      assert.equal(start.status, 503);
    }
    assert.equal(parseMfaEncryptionKey("too-short"), null);
  } finally {
    if (previousKey === undefined) delete process.env.CAMPUS_MFA_ENCRYPTION_KEY;
    else process.env.CAMPUS_MFA_ENCRYPTION_KEY = previousKey;
    if (previousRequire === undefined) delete process.env.CAMPUS_MFA_REQUIRE_KEY;
    else process.env.CAMPUS_MFA_REQUIRE_KEY = previousRequire;
  }
});

test("22b — requireAdminSession fail closed sans clé", async () => {
  resetWorld();
  await enrollAdmin();
  const previousKey = process.env.CAMPUS_MFA_ENCRYPTION_KEY;
  const previousRequire = process.env.CAMPUS_MFA_REQUIRE_KEY;
  process.env.CAMPUS_MFA_REQUIRE_KEY = "1";
  delete process.env.CAMPUS_MFA_ENCRYPTION_KEY;
  try {
    const denied = evaluateAdminMfaAccess({ isAdmin: true, mfaPending: false, status: "enabled" });
    assert.equal(denied.ok, false);
    if (!denied.ok) assert.equal(denied.status, 503);
  } finally {
    if (previousKey === undefined) delete process.env.CAMPUS_MFA_ENCRYPTION_KEY;
    else process.env.CAMPUS_MFA_ENCRYPTION_KEY = previousKey;
    if (previousRequire === undefined) delete process.env.CAMPUS_MFA_REQUIRE_KEY;
    else process.env.CAMPUS_MFA_REQUIRE_KEY = previousRequire;
  }
});

test("23 — API admin directe sans MFA validée", async () => {
  resetWorld();
  await enrollAdmin();
  const denied = evaluateAdminMfaAccess({ isAdmin: true, mfaPending: true, status: "enabled" });
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.status, 403);
});

test("24 — session enseignant et chiffrement AES-GCM", async () => {
  resetWorld();
  const token = await createSessionToken({
    kind: "teacher",
    teacherId: NON_ADMIN,
    issuedAt: Date.now(),
    mfaPending: true,
  });
  const parsed = await parseSessionToken(token);
  assert.equal(parsed?.kind, "teacher");
  if (parsed?.kind === "teacher") assert.equal(parsed.mfaPending, true);

  const sealed = await encryptTotpSecret("JBSWY3DPEHPK3PXP");
  assert.ok(looksLikeEncryptedTotpSecret(sealed));
  assert.equal(await decryptTotpSecret(sealed), "JBSWY3DPEHPK3PXP");

  const teacherFlags = describeAdminMfaFlags(false, null, true);
  assert.equal(teacherFlags.mfaSetupRequired, false);
  assert.equal(teacherFlags.mfaChallengeRequired, false);
});

test("confirmation reset : uniquement RESET-2FA", () => {
  assert.equal(isReset2faConfirmToken("RESET-2FA "), true);
  assert.equal(isReset2faConfirmToken("RESET 2FA"), false);
  assert.equal(isReset2faConfirmToken("oui"), false);
});

test("routes admin auditées : requireAdminSession sauf catalogue enseignant actif", async () => {
  const files = [
    "web/app/api/admin/backup/route.ts",
    "web/app/api/admin/restore/route.ts",
    "web/app/api/admin/teachers/route.ts",
    "web/app/api/admin/teachers/[id]/route.ts",
    "web/app/api/admin/security/mfa/route.ts",
    "web/app/api/admin/security/mfa/reconfigure/route.ts",
    "web/app/api/admin/security/mfa/recovery/route.ts",
    "web/app/api/admin/school-year/route.ts",
    "web/app/api/admin/annual-courses/route.ts",
    "web/app/api/admin/course-schedule/route.ts",
    "web/app/api/admin/memberships/route.ts",
    "web/app/api/admin/student-access/route.ts",
    "web/app/api/admin/timetable/route.ts",
  ];
  for (const file of files) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(source, /requireAdminSession/, file);
  }
  const catalog = await readFile(new URL("../web/app/api/admin/catalog/route.ts", import.meta.url), "utf8");
  assert.match(catalog, /requireAdminSession/);
  assert.match(catalog, /requireTeacherSession/);
});

test("recovery consume n'accepte pas un hash voisin", async () => {
  const hashes = ["sha256$dGVzdA==$dGVzdA=="];
  const result = await consumeRecoveryCode("AAAA-BBBB", hashes);
  assert.equal(result.ok, false);
});

test("UI sécurité et login exposent les écrans MFA", async () => {
  const admin = await readFile(new URL("../web/app/components/administration-panel.tsx", import.meta.url), "utf8");
  assert.match(admin, /security: "Sécurité"/);
  assert.match(admin, /AdminSecurityPanel/);
  const page = await readFile(new URL("../web/app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /MfaChallengePanel/);
  assert.match(page, /MfaSetupPanel/);
  const challenge = await readFile(new URL("../web/app/components/mfa-challenge-panel.tsx", import.meta.url), "utf8");
  assert.match(challenge, /Utiliser un code de récupération/);
  assert.match(challenge, /one-time-code/);
  const status = adminMfaStatusView(null);
  assert.equal(status.enabled, false);
});
