import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTH_MFA_LIMIT,
  AUTH_PASSWORD_CHANGE_LIMIT,
  AUTH_STUDENT_LIMIT,
  AUTH_TEACHER_LIMIT,
  MEMORY_RATE_LIMIT_MAX_BUCKETS,
  STUDENT_UNPARSED_RATE_LIMIT_TARGET,
  authRateLimitTargetFromStudentCode,
  authRateLimitTargetFromTeacherIdentifier,
  authRateLimitTargetFromUnknownTeacherIdentifier,
  buildAuthIpRateLimitKey,
  buildAuthRateLimitKey,
  buildAuthTargetRateLimitKey,
  checkInMemoryRateLimit,
  cleanupExpiredRateLimitBuckets,
  countInMemoryRateLimitBuckets,
  rateLimitKeyLooksSensitive,
  readClientKey,
  resetInMemoryRateLimits,
  resolveAuthRateLimit,
  resolveTeacherAuthRateLimitTarget,
  sanitizeRateLimitTarget,
} from "../src/lib/security/rate-limit.ts";
import { STUDENT_ACCESS_ALPHABET } from "../src/features/student-access/code.ts";
import { initialsKey } from "../src/features/teacher-accounts/rules.ts";

test("phase 1.0 — clé client et limite mémoire", () => {
  resetInMemoryRateLimits();
  const request = new Request("http://localhost/api/auth/teacher", {
    headers: { "cf-connecting-ip": "203.0.113.10", "cf-ray": "test-ray" },
  });

  assert.equal(readClientKey(request), "203.0.113.10");
  const key = buildAuthRateLimitKey("teacher", readClientKey(request));
  assert.equal(key, "auth:teacher:203.0.113.10");

  assert.equal(checkInMemoryRateLimit(key, 2), true);
  assert.equal(checkInMemoryRateLimit(key, 2), true);
  assert.equal(checkInMemoryRateLimit(key, 2), false);
});

test("rate limit — spoof cf-connecting-ip sans cf-ray ignoré", () => {
  resetInMemoryRateLimits();
  const spoofed = new Request("http://localhost/api/auth/student", {
    headers: { "cf-connecting-ip": "198.51.100.1" },
  });
  assert.equal(readClientKey(spoofed), "unknown");

  const real = new Request("http://localhost/api/auth/student", {
    headers: { "x-real-ip": "203.0.113.44" },
  });
  assert.equal(readClientKey(real), "203.0.113.44");

  const forgedXff = new Request("http://localhost/api/auth/student", {
    headers: { "x-forwarded-for": "198.51.100.9, 203.0.113.20" },
  });
  assert.equal(readClientKey(forgedXff), "203.0.113.20");

  const garbage = new Request("http://localhost/api/auth/student", {
    headers: { "x-forwarded-for": "not-an-ip", "x-real-ip": "nope" },
  });
  assert.equal(readClientKey(garbage), "unknown");
});

test("rate limit — élève 20/min, MFA 8/min, mot de passe 10/min", () => {
  resetInMemoryRateLimits();
  assert.equal(resolveAuthRateLimit("student"), AUTH_STUDENT_LIMIT);
  assert.equal(resolveAuthRateLimit("teacher-mfa"), AUTH_MFA_LIMIT);
  assert.equal(resolveAuthRateLimit("teacher-password"), AUTH_PASSWORD_CHANGE_LIMIT);
  assert.equal(resolveAuthRateLimit("teacher"), AUTH_TEACHER_LIMIT);

  const studentKey = buildAuthRateLimitKey("student", "unknown");
  for (let i = 0; i < AUTH_STUDENT_LIMIT; i += 1) {
    assert.equal(checkInMemoryRateLimit(studentKey, AUTH_STUDENT_LIMIT), true);
  }
  assert.equal(checkInMemoryRateLimit(studentKey, AUTH_STUDENT_LIMIT), false);
});

test("2.53.0 — portée MFA limitée et configurable", () => {
  resetInMemoryRateLimits();
  assert.equal(buildAuthRateLimitKey("teacher-mfa", "203.0.113.10"), "auth:teacher-mfa:203.0.113.10");
  assert.equal(buildAuthIpRateLimitKey("teacher-mfa", "203.0.113.10"), "auth:teacher-mfa:ip:203.0.113.10");
  assert.equal(buildAuthTargetRateLimitKey("teacher-mfa", "teacher-chf"), "auth:teacher-mfa:target:TEACHER-CHF");
  const previous = process.env.CAMPUS_AUTH_RATE_LIMIT_TEACHER_MFA;
  process.env.CAMPUS_AUTH_RATE_LIMIT_TEACHER_MFA = "3";
  assert.equal(resolveAuthRateLimit("teacher-mfa"), 3);
  if (previous === undefined) {
    delete process.env.CAMPUS_AUTH_RATE_LIMIT_TEACHER_MFA;
  } else {
    process.env.CAMPUS_AUTH_RATE_LIMIT_TEACHER_MFA = previous;
  }
});

test("rate limit — changer d’IP n’annule pas la limite d’un même compte", () => {
  resetInMemoryRateLimits();
  const target = buildAuthTargetRateLimitKey("teacher", "chf");
  const ipA = buildAuthIpRateLimitKey("teacher", "203.0.113.1");
  const ipB = buildAuthIpRateLimitKey("teacher", "198.51.100.2");
  const limit = 3;
  for (let index = 0; index < limit; index += 1) {
    assert.equal(checkInMemoryRateLimit(ipA, 50), true);
    assert.equal(checkInMemoryRateLimit(target, limit), true);
  }
  assert.equal(checkInMemoryRateLimit(target, limit), false);
  assert.equal(checkInMemoryRateLimit(ipB, 50), true);
  assert.equal(checkInMemoryRateLimit(target, limit), false);
});

test("rate limit — changer d’IP n’annule pas la limite d’une même classe", () => {
  resetInMemoryRateLimits();
  const target = buildAuthTargetRateLimitKey("student", authRateLimitTargetFromStudentCode("MA2-K7M4-R2P8"));
  const ipA = buildAuthIpRateLimitKey("student", "203.0.113.10");
  const ipB = buildAuthIpRateLimitKey("student", "198.51.100.11");
  const limit = 3;
  for (let index = 0; index < limit; index += 1) {
    assert.equal(checkInMemoryRateLimit(ipA, 50), true);
    assert.equal(checkInMemoryRateLimit(target, limit), true);
  }
  assert.equal(checkInMemoryRateLimit(target, limit), false);
  assert.equal(checkInMemoryRateLimit(ipB, 50), true);
  assert.equal(checkInMemoryRateLimit(target, limit), false);
});

test("rate limit — plusieurs comptes légitimes derrière la même IP restent utilisables", () => {
  resetInMemoryRateLimits();
  const sharedIp = buildAuthIpRateLimitKey("teacher", "203.0.113.40");
  const accountA = buildAuthTargetRateLimitKey("teacher", "chf");
  const accountB = buildAuthTargetRateLimitKey("teacher", "demo-current");
  const ipLimit = 20;
  const accountLimit = 3;
  for (let index = 0; index < accountLimit; index += 1) {
    assert.equal(checkInMemoryRateLimit(sharedIp, ipLimit), true);
    assert.equal(checkInMemoryRateLimit(accountA, accountLimit), true);
  }
  assert.equal(checkInMemoryRateLimit(accountA, accountLimit), false);
  assert.equal(checkInMemoryRateLimit(sharedIp, ipLimit), true);
  assert.equal(checkInMemoryRateLimit(accountB, accountLimit), true);
});

test("rate limit — clés sans mot de passe, TOTP, recovery ni code élève complet", () => {
  const fullStudent = "MEC-AUTO-3A-K7M4-R2P8";
  const studentTarget = authRateLimitTargetFromStudentCode(fullStudent);
  const studentKey = buildAuthTargetRateLimitKey("student", studentTarget);
  assert.equal(studentTarget, "MEC-AUTO-3A");
  assert.equal(studentKey.includes("K7M4"), false);
  assert.equal(studentKey.includes("R2P8"), false);
  assert.equal(studentKey.includes(fullStudent), false);
  assert.equal(authRateLimitTargetFromStudentCode("pas-un-code"), STUDENT_UNPARSED_RATE_LIMIT_TARGET);
  assert.equal(authRateLimitTargetFromStudentCode(""), STUDENT_UNPARSED_RATE_LIMIT_TARGET);

  const teacherKey = buildAuthTargetRateLimitKey("teacher", authRateLimitTargetFromTeacherIdentifier("ChF"));
  const canonicalTeacherKey = buildAuthTargetRateLimitKey("teacher", "teacher-123");
  const passwordKey = buildAuthTargetRateLimitKey("teacher-password", "teacher-chf");
  const mfaKey = buildAuthTargetRateLimitKey("teacher-mfa", "teacher-chf");
  const totp = "847291";
  const recovery = "ABCD-EFGH";
  const password = "Atelier-2027";
  for (const key of [studentKey, teacherKey, canonicalTeacherKey, passwordKey, mfaKey]) {
    assert.equal(key.includes(totp), false);
    assert.equal(key.includes(recovery), false);
    assert.equal(key.includes(password), false);
    assert.equal(key.includes("campus-demo"), false);
    assert.equal(rateLimitKeyLooksSensitive(key), false);
  }
  assert.equal(STUDENT_ACCESS_ALPHABET.length, 32);
  assert.equal(STUDENT_ACCESS_ALPHABET, "ABCDEFGHJKLMNPQRSTUVWXYZ23456789");
  assert.equal(rateLimitKeyLooksSensitive(`auth:student:target:${fullStudent}`), true);
  assert.equal(rateLimitKeyLooksSensitive("auth:teacher-mfa:target:847291"), true);
});

function teacherLookup(account: { id: string; initials: string }) {
  return {
    async findAccount(teacherId: string) {
      return teacherId === account.id ? account : null;
    },
    async findAccountByInitials(initials: string) {
      return initialsKey(initials) === initialsKey(account.initials) ? account : null;
    },
  };
}

test("rate limit enseignant — initiales et teacherId du même compte partagent le teacherId canonique", async () => {
  const account = { id: "teacher-123", initials: "ChF" };
  const lookup = teacherLookup(account);
  const fromInitials = await resolveTeacherAuthRateLimitTarget("ChF", lookup);
  const fromId = await resolveTeacherAuthRateLimitTarget("teacher-123", lookup);
  const fromUpperId = await resolveTeacherAuthRateLimitTarget("TEACHER-123", lookup);
  assert.equal(fromInitials, "teacher-123");
  assert.equal(fromId, "teacher-123");
  assert.equal(fromUpperId, "teacher-123");
  assert.equal(
    buildAuthTargetRateLimitKey("teacher", fromInitials),
    buildAuthTargetRateLimitKey("teacher", fromId),
  );
  assert.equal(
    buildAuthTargetRateLimitKey("teacher", fromInitials),
    `auth:teacher:target:${sanitizeRateLimitTarget("teacher-123")}`,
  );
});

test("rate limit enseignant — ChF / CHF / chf convergent vers la même cible", async () => {
  const account = { id: "teacher-123", initials: "ChF" };
  const lookup = teacherLookup(account);
  const targets = await Promise.all([
    resolveTeacherAuthRateLimitTarget("ChF", lookup),
    resolveTeacherAuthRateLimitTarget("CHF", lookup),
    resolveTeacherAuthRateLimitTarget("chf", lookup),
    resolveTeacherAuthRateLimitTarget("  chf  ", lookup),
  ]);
  assert.ok(targets.every((target) => target === "teacher-123"));
});

test("rate limit enseignant — changer d’IP ne dépasse pas le plafond du teacherId canonique", async () => {
  resetInMemoryRateLimits();
  const target = buildAuthTargetRateLimitKey("teacher", "teacher-123");
  const ipA = buildAuthIpRateLimitKey("teacher", "203.0.113.1");
  const ipB = buildAuthIpRateLimitKey("teacher", "198.51.100.2");
  const limit = 3;
  for (let index = 0; index < limit; index += 1) {
    assert.equal(checkInMemoryRateLimit(ipA, 50), true);
    assert.equal(checkInMemoryRateLimit(target, limit), true);
  }
  assert.equal(checkInMemoryRateLimit(target, limit), false);
  assert.equal(checkInMemoryRateLimit(ipB, 50), true);
  assert.equal(checkInMemoryRateLimit(target, limit), false);
});

test("rate limit enseignant — identifiant inexistant limité, casse et espaces sans bypass", async () => {
  const lookup = teacherLookup({ id: "teacher-123", initials: "ChF" });
  const variants = ["ZzQ", "zzq", "ZZQ", "  zzq  ", "z-zq"];
  const targets = await Promise.all(
    variants.map((value) => resolveTeacherAuthRateLimitTarget(value, lookup)),
  );
  assert.ok(targets.every((target) => target === targets[0]));
  assert.notEqual(targets[0], "teacher-123");
  assert.equal(targets[0], authRateLimitTargetFromUnknownTeacherIdentifier("ZzQ"));

  resetInMemoryRateLimits();
  const unknownKey = buildAuthTargetRateLimitKey("teacher", targets[0]!);
  const limit = 2;
  assert.equal(checkInMemoryRateLimit(unknownKey, limit), true);
  assert.equal(checkInMemoryRateLimit(unknownKey, limit), true);
  assert.equal(checkInMemoryRateLimit(unknownKey, limit), false);
  const sameAfterCase = buildAuthTargetRateLimitKey(
    "teacher",
    await resolveTeacherAuthRateLimitTarget("zzq", lookup),
  );
  assert.equal(sameAfterCase, unknownKey);
  assert.equal(checkInMemoryRateLimit(sameAfterCase, limit), false);
});

test("rate limiter mémoire — un seau actif survit au cleanup", () => {
  resetInMemoryRateLimits();
  const now = 1_700_000_000_000;
  const key = buildAuthTargetRateLimitKey("teacher", "teacher-chf");
  assert.equal(checkInMemoryRateLimit(key, 2, 60_000, now), true);
  assert.equal(checkInMemoryRateLimit(key, 2, 60_000, now), true);
  assert.equal(checkInMemoryRateLimit(key, 2, 60_000, now), false);
  assert.equal(countInMemoryRateLimitBuckets(), 1);
  assert.equal(cleanupExpiredRateLimitBuckets(now + 1_000), 0);
  assert.equal(countInMemoryRateLimitBuckets(), 1);
  assert.equal(checkInMemoryRateLimit(key, 2, 60_000, now + 1_000), false);
});

test("rate limiter mémoire — un seau expiré est retiré par le cleanup", () => {
  resetInMemoryRateLimits();
  const now = 1_700_000_000_000;
  const key = buildAuthIpRateLimitKey("teacher", "203.0.113.9");
  assert.equal(checkInMemoryRateLimit(key, 5, 1_000, now), true);
  assert.equal(countInMemoryRateLimitBuckets(), 1);
  assert.equal(cleanupExpiredRateLimitBuckets(now + 1_000), 1);
  assert.equal(countInMemoryRateLimitBuckets(), 0);
});

test("rate limiter mémoire — milliers de seaux expirés libérés, taille retombe à zéro", () => {
  resetInMemoryRateLimits();
  const now = 1_700_000_000_000;
  const flood = 2_400;
  for (let index = 0; index < flood; index += 1) {
    assert.equal(checkInMemoryRateLimit(`auth:teacher:target:PROBE${index}`, 10, 500, now), true);
  }
  assert.equal(countInMemoryRateLimitBuckets(), flood);
  assert.equal(cleanupExpiredRateLimitBuckets(now + 500), flood);
  assert.equal(countInMemoryRateLimitBuckets(), 0);
});

test("rate limiter mémoire — la Map ne dépasse jamais le plafond", () => {
  resetInMemoryRateLimits();
  const now = 1_700_000_000_000;
  for (let index = 0; index < MEMORY_RATE_LIMIT_MAX_BUCKETS + 80; index += 1) {
    checkInMemoryRateLimit(`auth:teacher:target:FLOOD${index}`, 10, 60_000, now);
    assert.ok(countInMemoryRateLimitBuckets() <= MEMORY_RATE_LIMIT_MAX_BUCKETS);
  }
  assert.equal(countInMemoryRateLimitBuckets(), MEMORY_RATE_LIMIT_MAX_BUCKETS);
});

test("rate limiter mémoire — éviction préfère les expirés, seau actif inchangé", () => {
  resetInMemoryRateLimits();
  const now = 1_700_000_000_000;
  const sensitive = buildAuthTargetRateLimitKey("teacher", "teacher-chf");
  const student = buildAuthTargetRateLimitKey("student", authRateLimitTargetFromStudentCode("MA2-K7M4-R2P8"));
  const mfa = buildAuthTargetRateLimitKey("teacher-mfa", "teacher-chf");
  const password = buildAuthTargetRateLimitKey("teacher-password", "teacher-chf");
  const ip = buildAuthIpRateLimitKey("teacher", "203.0.113.40");

  assert.equal(checkInMemoryRateLimit(sensitive, 2, 60_000, now), true);
  assert.equal(checkInMemoryRateLimit(sensitive, 2, 60_000, now), true);
  assert.equal(checkInMemoryRateLimit(sensitive, 2, 60_000, now), false);
  assert.equal(checkInMemoryRateLimit(student, 2, 60_000, now), true);
  assert.equal(checkInMemoryRateLimit(student, 2, 60_000, now), true);
  assert.equal(checkInMemoryRateLimit(student, 2, 60_000, now), false);
  assert.equal(checkInMemoryRateLimit(mfa, 2, 60_000, now), true);
  assert.equal(checkInMemoryRateLimit(mfa, 2, 60_000, now), true);
  assert.equal(checkInMemoryRateLimit(mfa, 2, 60_000, now), false);
  assert.equal(checkInMemoryRateLimit(password, 2, 60_000, now), true);
  assert.equal(checkInMemoryRateLimit(password, 2, 60_000, now), true);
  assert.equal(checkInMemoryRateLimit(password, 2, 60_000, now), false);
  assert.equal(checkInMemoryRateLimit(ip, 2, 60_000, now), true);
  assert.equal(checkInMemoryRateLimit(ip, 2, 60_000, now), true);
  assert.equal(checkInMemoryRateLimit(ip, 2, 60_000, now), false);

  const junkNow = now - 5_000;
  const junkCount = MEMORY_RATE_LIMIT_MAX_BUCKETS - 5;
  for (let index = 0; index < junkCount; index += 1) {
    checkInMemoryRateLimit(`auth:teacher:target:EXPIRED${index}`, 10, 1, junkNow);
  }
  assert.equal(countInMemoryRateLimitBuckets(), MEMORY_RATE_LIMIT_MAX_BUCKETS);

  assert.equal(checkInMemoryRateLimit("auth:teacher:target:NEWONE", 10, 60_000, now), true);
  assert.ok(countInMemoryRateLimitBuckets() <= MEMORY_RATE_LIMIT_MAX_BUCKETS);
  assert.equal(checkInMemoryRateLimit(sensitive, 2, 60_000, now), false);
  assert.equal(checkInMemoryRateLimit(student, 2, 60_000, now), false);
  assert.equal(checkInMemoryRateLimit(mfa, 2, 60_000, now), false);
  assert.equal(checkInMemoryRateLimit(password, 2, 60_000, now), false);
  assert.equal(checkInMemoryRateLimit(ip, 2, 60_000, now), false);
});

test("phase 1.0 — limites configurables via variables d'environnement", () => {
  const previous = process.env.CAMPUS_AUTH_RATE_LIMIT_TEACHER;
  process.env.CAMPUS_AUTH_RATE_LIMIT_TEACHER = "5";
  assert.equal(resolveAuthRateLimit("teacher"), 5);
  if (previous === undefined) {
    delete process.env.CAMPUS_AUTH_RATE_LIMIT_TEACHER;
  } else {
    process.env.CAMPUS_AUTH_RATE_LIMIT_TEACHER = previous;
  }
});
