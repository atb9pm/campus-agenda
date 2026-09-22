import assert from "node:assert/strict";
import test from "node:test";

import { AUTH_BODY_MAX_BYTES, readBoundedJson } from "../web/lib/server/read-bounded-json.ts";

function jsonRequest(body: string, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/auth/teacher", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body,
  });
}

test("corps d’auth — JSON normal accepté", async () => {
  const parsed = await readBoundedJson<{ initials: string }>(
    jsonRequest(JSON.stringify({ initials: "ChF", password: "secret" })),
  );
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(parsed.value.initials, "ChF");
});

test("corps d’auth — JSON invalide", async () => {
  const parsed = await readBoundedJson(jsonRequest("{"));
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.equal(parsed.reason, "invalid-json");
});

test("corps d’auth — Content-Length trop grand refuse sans lire", async () => {
  const parsed = await readBoundedJson(
    jsonRequest("{}", { "Content-Length": String(AUTH_BODY_MAX_BYTES + 1) }),
  );
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.equal(parsed.reason, "too-large");
});

test("corps d’auth — flux plus grand que 8 KiB refuse", async () => {
  const payload = JSON.stringify({ padding: "x".repeat(AUTH_BODY_MAX_BYTES) });
  assert.ok(payload.length > AUTH_BODY_MAX_BYTES);
  const parsed = await readBoundedJson(jsonRequest(payload));
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.equal(parsed.reason, "too-large");
});

test("RSC — 19.2.0–19.2.7 refusés, 19.2.8 accepté", async () => {
  const { isVulnerableReactServerDom } = await import("../scripts/check-runtime-security-deps.mjs");
  assert.equal(isVulnerableReactServerDom("19.2.0"), true);
  assert.equal(isVulnerableReactServerDom("19.2.6"), true);
  assert.equal(isVulnerableReactServerDom("19.2.7"), true);
  assert.equal(isVulnerableReactServerDom("19.2.8"), false);
  assert.equal(isVulnerableReactServerDom("19.2.9"), false);
});
