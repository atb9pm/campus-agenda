import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAuthRateLimitKey,
  checkInMemoryRateLimit,
  readClientKey,
  resetInMemoryRateLimits,
  resolveAuthRateLimit,
} from "../src/lib/security/rate-limit.ts";

test("phase 1.0 — clé client et limite mémoire", () => {
  resetInMemoryRateLimits();
  const request = new Request("http://localhost/api/auth/teacher", {
    headers: { "cf-connecting-ip": "203.0.113.10" },
  });

  assert.equal(readClientKey(request), "203.0.113.10");
  const key = buildAuthRateLimitKey("teacher", readClientKey(request));
  assert.equal(key, "auth:teacher:203.0.113.10");

  assert.equal(checkInMemoryRateLimit(key, 2), true);
  assert.equal(checkInMemoryRateLimit(key, 2), true);
  assert.equal(checkInMemoryRateLimit(key, 2), false);
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
