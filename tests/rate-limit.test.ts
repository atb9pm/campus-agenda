import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTH_MFA_LIMIT,
  AUTH_PASSWORD_CHANGE_LIMIT,
  AUTH_STUDENT_LIMIT,
  AUTH_TEACHER_LIMIT,
  STUDENT_UNPARSED_RATE_LIMIT_TARGET,
  authRateLimitTargetFromStudentCode,
  authRateLimitTargetFromTeacherIdentifier,
  buildAuthIpRateLimitKey,
  buildAuthRateLimitKey,
  buildAuthTargetRateLimitKey,
  checkInMemoryRateLimit,
  rateLimitKeyLooksSensitive,
  readClientKey,
  resetInMemoryRateLimits,
  resolveAuthRateLimit,
} from "../src/lib/security/rate-limit.ts";
import { STUDENT_ACCESS_ALPHABET } from "../src/features/student-access/code.ts";

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
  const passwordKey = buildAuthTargetRateLimitKey("teacher-password", "teacher-chf");
  const mfaKey = buildAuthTargetRateLimitKey("teacher-mfa", "teacher-chf");
  const totp = "847291";
  const recovery = "ABCD-EFGH";
  const password = "Atelier-2027";
  for (const key of [studentKey, teacherKey, passwordKey, mfaKey]) {
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
