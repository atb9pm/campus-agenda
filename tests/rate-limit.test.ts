import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTH_MFA_LIMIT,
  AUTH_PASSWORD_CHANGE_LIMIT,
  AUTH_STUDENT_LIMIT,
  AUTH_TEACHER_LIMIT,
  buildAuthRateLimitKey,
  checkInMemoryRateLimit,
  readClientKey,
  resetInMemoryRateLimits,
  resolveAuthRateLimit,
} from "../src/lib/security/rate-limit.ts";

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
  const previous = process.env.CAMPUS_AUTH_RATE_LIMIT_TEACHER_MFA;
  process.env.CAMPUS_AUTH_RATE_LIMIT_TEACHER_MFA = "3";
  assert.equal(resolveAuthRateLimit("teacher-mfa"), 3);
  if (previous === undefined) {
    delete process.env.CAMPUS_AUTH_RATE_LIMIT_TEACHER_MFA;
  } else {
    process.env.CAMPUS_AUTH_RATE_LIMIT_TEACHER_MFA = previous;
  }
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
