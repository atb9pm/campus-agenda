import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { APP_VERSION } from "../src/lib/app-version.ts";
import { SQL_MIGRATION_FILES } from "../src/lib/persistence/sql/migrate.ts";
import { createSessionToken, parseSessionToken } from "../src/lib/auth/session.ts";
import { revalidateLiveSession } from "../src/lib/auth/session-live.ts";
import {
  classifyCredentialTimestamp,
  isSessionOlderThanCredential,
} from "../src/lib/auth/session-freshness.ts";
import {
  SECURITY_CSP,
  buildSecurityCsp,
  extractScriptNonceFromCsp,
  securityHeaderEntries,
} from "../src/lib/security/http-headers.ts";
import {
  UNTRUSTED_ORIGIN_REASON,
  isTrustedSensitiveRead,
  isTrustedWriteOrigin,
} from "../src/lib/security/csrf.ts";
import { RESTORE_CONFIRM_REQUIRED_REASON, restoreRequestBody } from "../src/features/admin-backup/index.ts";
import { getMemoryTeacherAccountStore, resetMemoryTeacherAccountStore } from "../src/lib/persistence/memory-teacher-account-store.ts";

test("déconnexion — DELETE /api/auth/session applique Origin / Sec-Fetch-Site", async () => {
  const sessionRoute = await readFile(new URL("../web/app/api/auth/session/route.ts", import.meta.url), "utf8");
  assert.match(sessionRoute, /isTrustedWriteOrigin/);
  assert.match(sessionRoute, /UNTRUSTED_ORIGIN_REASON/);
  assert.match(sessionRoute, /export async function DELETE\(request: Request\)/);
});

test("version 2.61.8 — durcissement MFA, sessions, restore, en-têtes, pas de migration", async () => {
  assert.equal(APP_VERSION, "2.61.8");
  assert.equal(SQL_MIGRATION_FILES.at(-1), "0030_agenda_student_visible.sql");

  const api = await readFile(new URL("../web/lib/server/api.ts", import.meta.url), "utf8");
  assert.match(api, /rejectIncompleteAdminMfa/);
  assert.match(api, /evaluateAdminMfaAccess/);
  assert.match(api, /findMfaConfirmedAt/);

  const restore = await readFile(new URL("../web/app/api/admin/restore/route.ts", import.meta.url), "utf8");
  assert.match(restore, /isRestoreConfirmToken/);
  assert.match(restore, /RESTORE_CONFIRM_REQUIRED_REASON/);

  const password = await readFile(new URL("../web/app/api/auth/teacher/password/route.ts", import.meta.url), "utf8");
  assert.match(password, /jsonWithSession/);
  assert.match(password, /issuedAt: Date.now\(\)/);
  assert.match(password, /layer: "ip"/);
  assert.match(password, /layer: "target"/);

  const teacherLogin = await readFile(new URL("../web/app/api/auth/teacher/route.ts", import.meta.url), "utf8");
  assert.match(teacherLogin, /resolveTeacherAuthRateLimitTarget/);
  assert.match(teacherLogin, /layer: "ip"/);
  assert.match(teacherLogin, /layer: "target"/);
  assert.match(teacherLogin, /TEACHER_LOGIN_INVALID_REASON/);
  assert.match(teacherLogin, /readBoundedJson/);
  const teacherPost = teacherLogin.slice(teacherLogin.indexOf("export async function POST"));
  assert.ok(teacherPost.indexOf('layer: "ip"') < teacherPost.indexOf("readBoundedJson"));

  const studentLogin = await readFile(new URL("../web/app/api/auth/student/route.ts", import.meta.url), "utf8");
  assert.match(studentLogin, /readBoundedJson/);
  const studentPost = studentLogin.slice(studentLogin.indexOf("export async function POST"));
  assert.ok(studentPost.indexOf('layer: "ip"') < studentPost.indexOf("readBoundedJson"));

  for (const relative of [
    "../web/app/api/admin/security/mfa/reconfigure/route.ts",
    "../web/app/api/admin/security/mfa/reconfigure/confirm/route.ts",
    "../web/app/api/admin/security/mfa/recovery/route.ts",
  ]) {
    const source = await readFile(new URL(relative, import.meta.url), "utf8");
    assert.match(source, /readBoundedJson/, relative);
    assert.doesNotMatch(source, /request\.json\(/, relative);
    const post = source.slice(source.indexOf("export async function POST"));
    assert.ok(post.indexOf("enforceAuthRateLimit") < post.indexOf("readBoundedJson"), relative);
  }

  const ci = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  assert.match(ci, /check-runtime-security-deps\.mjs/);
  assert.match(ci, /npm audit --omit=dev --audit-level=high/);

  const rateLimit = await readFile(new URL("../src/lib/security/rate-limit.ts", import.meta.url), "utf8");
  assert.match(rateLimit, /buildAuthIpRateLimitKey/);
  assert.match(rateLimit, /buildAuthTargetRateLimitKey/);
  assert.match(rateLimit, /authRateLimitTargetFromStudentCode/);
  assert.match(rateLimit, /MEMORY_RATE_LIMIT_MAX_BUCKETS/);
  assert.match(rateLimit, /cleanupExpiredRateLimitBuckets/);
  assert.match(rateLimit, /canAllocateNewMemoryBucket/);
  assert.match(rateLimit, /isAuthRateLimitBypassAllowed/);
  assert.doesNotMatch(rateLimit, /evictClosestToExpiration/);
  assert.doesNotMatch(rateLimit, /IP:compte/);
  assert.doesNotMatch(rateLimit, /console\.(log|info|debug|warn)/);

  const operations = await readFile(new URL("../docs/OPERATIONS.md", import.meta.url), "utf8");
  assert.match(operations, /mémoire par processus/);
  assert.match(operations, /préfixe de classe/);
  assert.match(operations, /32 octets/);
  assert.match(operations, /teacherId` interne canonique/);
  assert.match(operations, /Rate limiter mémoire/);
  assert.match(operations, /8000/);
  assert.match(operations, /ignorée/);
  assert.match(operations, /révoque les sessions enseignant/);
  assert.match(operations, /8 KiB/);

  const envExample = await readFile(new URL("../.env.example", import.meta.url), "utf8");
  assert.match(envExample, /CAMPUS_MFA_ENCRYPTION_KEY=/);
  assert.match(envExample, /32 octets/);

  const sqlAccounts = await readFile(new URL("../src/lib/persistence/sql/sql-teacher-account-store.ts", import.meta.url), "utf8");
  assert.match(sqlAccounts, /passwordUpdatedAt = new Date\(\)\.toISOString\(\)/);
  assert.doesNotMatch(sqlAccounts, /password_updated_at = datetime\('now'\)/);

  const bootstrap = await readFile(new URL("../src/lib/persistence/teacher-account-bootstrap.ts", import.meta.url), "utf8");
  assert.match(bootstrap, /needs-admin-password/);

  const branches = await readFile(new URL("../web/app/api/timetable/branches/route.ts", import.meta.url), "utf8");
  assert.match(branches, /listAccessibleRuntimeClassroomsForTeacher/);
  assert.match(branches, /checkClassroomExists/);
  assert.doesNotMatch(branches, /resolveDemoTeacherCode/);

  const passwordHash = await readFile(new URL("../src/lib/auth/password.ts", import.meta.url), "utf8");
  assert.match(passwordHash, /DEFAULT_PBKDF2_ITERATIONS = 600_000/);

  const worker = await readFile(new URL("../web/worker/index.ts", import.meta.url), "utf8");
  assert.match(worker, /withSecurityHeaders/);
  assert.match(worker, /createRequestNonce/);

  const proxy = await readFile(new URL("../web/proxy.ts", import.meta.url), "utf8");
  assert.match(proxy, /createRequestNonce/);
  assert.match(proxy, /buildSecurityCsp/);

  const body = restoreRequestBody({ version: 4 });
  assert.equal(body.confirmation, "RESTAURER");
  assert.equal(RESTORE_CONFIRM_REQUIRED_REASON.includes("RESTAURER"), true);

  assert.match(SECURITY_CSP, /frame-ancestors 'none'/);
  assert.match(SECURITY_CSP, /fonts\.googleapis\.com/);
  assert.doesNotMatch(SECURITY_CSP, /script-src[^;]*unsafe-inline/);
  assert.doesNotMatch(SECURITY_CSP, /unsafe-eval/);
  const names = securityHeaderEntries().map(([name]) => name);
  assert.ok(names.includes("Content-Security-Policy"));
  assert.ok(names.includes("X-Frame-Options"));
  assert.ok(names.includes("X-Content-Type-Options"));
  assert.ok(names.includes("Referrer-Policy"));
});

test("CSP — nonce script-src sans unsafe-inline ni unsafe-eval", () => {
  const csp = buildSecurityCsp({ scriptNonce: "abc123def456" });
  assert.match(csp, /script-src 'self' 'nonce-abc123def456' 'strict-dynamic'/);
  assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/);
  assert.doesNotMatch(csp, /unsafe-eval/);
  assert.match(csp, /style-src 'self' 'unsafe-inline' https:\/\/fonts\.googleapis\.com/);
  assert.equal(extractScriptNonceFromCsp(csp), "abc123def456");
});

test("CSRF — Origin / Host et Sec-Fetch-Site", () => {
  const sameHostWrite = new Request("https://campusagenda.ch/api/teacher/notes", {
    method: "PUT",
    headers: { origin: "https://campusagenda.ch", host: "campusagenda.ch" },
  });
  assert.equal(isTrustedWriteOrigin(sameHostWrite), true);

  const evilWrite = new Request("https://campusagenda.ch/api/admin/restore", {
    method: "POST",
    headers: { origin: "https://evil.example", host: "campusagenda.ch" },
  });
  assert.equal(isTrustedWriteOrigin(evilWrite), false);

  const missingOrigin = new Request("https://campusagenda.ch/api/teacher/notes", {
    method: "PUT",
    headers: { host: "campusagenda.ch" },
  });
  assert.equal(isTrustedWriteOrigin(missingOrigin), true);

  const crossSiteGet = new Request("https://campusagenda.ch/api/admin/backup", {
    method: "GET",
    headers: { host: "campusagenda.ch", "sec-fetch-site": "cross-site" },
  });
  assert.equal(isTrustedSensitiveRead(crossSiteGet), false);

  const sameSiteGet = new Request("https://campusagenda.ch/api/admin/backup", {
    method: "GET",
    headers: { host: "campusagenda.ch", "sec-fetch-site": "same-origin" },
  });
  assert.equal(isTrustedSensitiveRead(sameSiteGet), true);

  const logoutCross = new Request("https://campusagenda.ch/api/auth/session", {
    method: "DELETE",
    headers: { origin: "https://evil.example", host: "campusagenda.ch" },
  });
  assert.equal(isTrustedWriteOrigin(logoutCross), false);
  const logoutSame = new Request("https://campusagenda.ch/api/auth/session", {
    method: "DELETE",
    headers: { origin: "https://campusagenda.ch", host: "campusagenda.ch" },
  });
  assert.equal(isTrustedWriteOrigin(logoutSame), true);
  assert.equal(UNTRUSTED_ORIGIN_REASON.includes("Origine"), true);
});

test("session enseignant morte après changement de mot de passe", async () => {
  resetMemoryTeacherAccountStore();
  const accounts = getMemoryTeacherAccountStore();
  const created = await accounts.createAccount({
    displayName: "Session Test",
    initials: "ST",
    teachingType: "TECHNICAL",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const session = await parseSessionToken(await createSessionToken({
    kind: "teacher",
    teacherId: created.account.id,
    issuedAt: Date.now(),
  }));
  assert.ok(session);

  const lookup = {
    findAccount: (id: string) => accounts.findAccount(id),
  };
  assert.ok(await revalidateLiveSession(session!, lookup));

  await new Promise((resolve) => setTimeout(resolve, 15));
  await accounts.setPassword(created.account.id, "Atelier-2027", false);
  assert.equal(await revalidateLiveSession(session!, lookup), null);
});

test("horodatage d’identifiants — fail closed sur date présente mais invalide", () => {
  const issuedAt = Date.parse("2026-09-01T10:00:00.000Z");
  assert.equal(classifyCredentialTimestamp(null).kind, "absent");
  assert.equal(classifyCredentialTimestamp(undefined).kind, "absent");
  assert.equal(classifyCredentialTimestamp("").kind, "invalid");
  assert.equal(classifyCredentialTimestamp("   ").kind, "invalid");
  assert.equal(classifyCredentialTimestamp("2026-09-21T12:00:00.000Z").kind, "valid");
  assert.equal(classifyCredentialTimestamp("2026-09-21 12:00:00").kind, "valid");
  assert.equal(classifyCredentialTimestamp("not-a-date").kind, "invalid");
  assert.equal(classifyCredentialTimestamp("%%%corrompu%%%").kind, "invalid");
  assert.equal(classifyCredentialTimestamp("2026-99-99").kind, "invalid");

  assert.equal(isSessionOlderThanCredential(issuedAt, "2026-08-01T12:00:00.000Z"), false);
  assert.equal(isSessionOlderThanCredential(issuedAt, "2026-09-21T12:00:00.000Z"), true);
  assert.equal(isSessionOlderThanCredential(issuedAt, null), false);
  assert.equal(isSessionOlderThanCredential(issuedAt, undefined), false);
  assert.equal(isSessionOlderThanCredential(issuedAt, "2026-09-21 12:00:00"), true);
  assert.equal(isSessionOlderThanCredential(issuedAt, "not-a-date"), true);
  assert.equal(isSessionOlderThanCredential(issuedAt, "%%%corrompu%%%"), true);
  assert.equal(isSessionOlderThanCredential(issuedAt, "2026-99-99"), true);
  assert.equal(isSessionOlderThanCredential(issuedAt, ""), true);
  assert.equal(isSessionOlderThanCredential(issuedAt, "   "), true);

  const sameSecondIssued = Date.parse("2026-09-22T10:00:00.700Z");
  // A. issuedAt puis passwordUpdatedAt 1 ms plus tard → session refusée.
  assert.equal(isSessionOlderThanCredential(sameSecondIssued, "2026-09-22T10:00:00.701Z"), true);
  // B. même seconde civile, horodatage ISO avec millisecondes → session refusée.
  assert.equal(isSessionOlderThanCredential(sameSecondIssued, "2026-09-22T10:00:00.850Z"), true);
  // C. timestamp SQLite historique YYYY-MM-DD HH:MM:SS toujours interprété.
  assert.equal(classifyCredentialTimestamp("2026-09-22 10:00:00").kind, "valid");
  assert.equal(classifyCredentialTimestamp("2026-09-22 10:00:00").ts, Date.parse("2026-09-22T10:00:00Z"));
  assert.equal(isSessionOlderThanCredential(Date.parse("2026-09-22T09:59:59.000Z"), "2026-09-22 10:00:00"), true);
  // D. les nouveaux writes SQL sont ISO UTC avec millisecondes (source + createAccount).
  assert.match(new Date().toISOString(), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

test("session enseignant refusée si passwordUpdatedAt est corrompu", async () => {
  resetMemoryTeacherAccountStore();
  const accounts = getMemoryTeacherAccountStore();
  const created = await accounts.createAccount({
    displayName: "Date Corrompue",
    initials: "DC",
    teachingType: "TECHNICAL",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const session = await parseSessionToken(await createSessionToken({
    kind: "teacher",
    teacherId: created.account.id,
    issuedAt: Date.now(),
  }));
  assert.ok(session);

  const valid = await revalidateLiveSession(session!, {
    findAccount: (id: string) => accounts.findAccount(id),
  });
  assert.ok(valid);

  const corrupted = await revalidateLiveSession(session!, {
    findAccount: async (id: string) => {
      const account = await accounts.findAccount(id);
      return account ? { ...account, passwordUpdatedAt: "pas-une-date" } : null;
    },
  });
  assert.equal(corrupted, null);

  const emptyStamp = await revalidateLiveSession(session!, {
    findAccount: async (id: string) => {
      const account = await accounts.findAccount(id);
      return account ? { ...account, passwordUpdatedAt: "" } : null;
    },
  });
  assert.equal(emptyStamp, null);

  const blankStamp = await revalidateLiveSession(session!, {
    findAccount: async (id: string) => {
      const account = await accounts.findAccount(id);
      return account ? { ...account, passwordUpdatedAt: "   " } : null;
    },
  });
  assert.equal(blankStamp, null);

  const badMfa = await revalidateLiveSession(session!, {
    findAccount: (id: string) => accounts.findAccount(id),
    findMfaConfirmedAt: async () => "%%%",
  });
  assert.equal(badMfa, null);
});
