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
  assert.equal(classifyCredentialTimestamp("").kind, "absent");
  assert.equal(classifyCredentialTimestamp("   ").kind, "absent");
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

  const badMfa = await revalidateLiveSession(session!, {
    findAccount: (id: string) => accounts.findAccount(id),
    findMfaConfirmedAt: async () => "%%%",
  });
  assert.equal(badMfa, null);
});
